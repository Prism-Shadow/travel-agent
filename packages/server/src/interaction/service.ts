/**
 * One place that owns everything a conversation needs to ask its person something.
 *
 * Per Session, and lazily: a chat that never books anything never opens a journal file. What it
 * holds is small and each piece is here for a reason the others cannot serve:
 *
 * | Held | Why it is per Session |
 * | --- | --- |
 * | {@link InteractionRegistry} | pending questions, replayed to a subscriber that just connected |
 * | {@link SessionPaymentGuard} | a confirmation belongs to one conversation's turn, and to its journal |
 * | `Journal` | the write-ahead log lives in *this* Session's scratchpad; a key from another conversation must never satisfy its replay check |
 * | `CheckpointStore` | where this task got to, so a lapsed card resumes instead of re-searching |
 *
 * Two behaviours are worth stating because they are what make the cards trustworthy rather than
 * decorative:
 *
 * **A card never outlives its turn.** When the turn ends — finished, aborted, interrupted — every
 * pending question is settled and the turn's confirmation is forgotten. A card left on screen with
 * nothing behind it would be answered into a void, and a confirmation that survived its turn would
 * be consent the person gave to something else.
 *
 * **A card that matters writes a checkpoint.** The selection and the payment confirmation are the
 * two points where a task's progress is worth more than the conversation: if nobody answers and the
 * turn lapses, the checkpoint is what lets the next turn resume from "we were at the payment page"
 * rather than re-running the search (001 §4.4, 004 Phase 3).
 */
import path from "node:path";
import {
  buildInteraction,
  openJournal,
  paymentSummaryDigest,
  CheckpointStore,
  DEFAULT_CONFIRMATION_TTL_MS,
  type Escalation,
  type EscalationChannel,
  type EscalationOutcome,
  type FeatureFlagsShape,
  type InteractionInput,
  type InteractionOutcome,
  type Journal,
  type TaskStage,
  type UserInteraction,
} from "./transaction-imports.js";
import { assertOutcomeMatches } from "./outcome.js";
import { InteractionRegistry } from "./registry.js";
import { SessionPaymentGuard } from "./payment.js";

/** What the host must tell the service about a Session to open its files. */
export interface SessionLocator {
  sessionId: string;
  projectId: string;
  agentId: string;
}

export interface InteractionServiceDeps {
  /** App data root; the Session's scratchpad is derived from it. */
  root: string;
  /** Effective feature flags for this run. */
  flags: FeatureFlagsShape;
  /** Publishes a server event on the Session's channel. */
  publish: (sessionId: string, event: InteractionServerEvent) => void;
  /** Resolves a Session's scratchpad directory (injected so tests need no app data root). */
  scratchpadDir: (locator: SessionLocator) => string;
  /**
   * Observability hook (003 §13): told the kind of every card raised, so the takeover and
   * secret-phase rates have a denominator. Optional — absent in tests that do not care.
   */
  onInteractionRaised?: (kind: string) => void;
  now?: () => Date;
  log?: (line: string) => void;
}

/** The two events this service publishes. Mirrored in `api/types.ts`; kept structural here. */
export type InteractionServerEvent =
  | { type: "interaction_request"; interaction: UserInteraction }
  | { type: "interaction_resolved"; interactionId: string; outcome: InteractionOutcome };

interface SessionState {
  locator: SessionLocator;
  registry: InteractionRegistry;
  checkpoints: CheckpointStore;
  journal?: Journal;
  guard?: SessionPaymentGuard;
}

/** Which stage a card being raised means the task has reached. */
function stageFor(interaction: UserInteraction): TaskStage | null {
  switch (interaction.kind) {
    case "selection":
      return "awaiting_choice";
    case "commitment_confirmation":
    case "secret_entry":
      // A secret card only ever appears at the payment step, and that is the stage worth resuming
      // from: "we were at the payment page waiting for a code", not "we were filling a form".
      return "awaiting_confirmation";
    case "human_challenge":
    case "browser_takeover":
      return "filling";
    default:
      // An information request does not move the task; checkpointing it would overwrite a
      // meaningful stage with a meaningless one.
      return null;
  }
}

export class InteractionService {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly deps: InteractionServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private state(locator: SessionLocator): SessionState {
    const existing = this.sessions.get(locator.sessionId);
    if (existing) return existing;
    const dir = this.deps.scratchpadDir(locator);
    const created: SessionState = {
      locator,
      registry: new InteractionRegistry(),
      checkpoints: new CheckpointStore(path.join(dir, "task-checkpoint.json")),
    };
    this.sessions.set(locator.sessionId, created);
    return created;
  }

  /** The pending questions of a Session, for SSE replay. Empty for a Session with none. */
  pending(sessionId: string): UserInteraction[] {
    return this.sessions.get(sessionId)?.registry.list() ?? [];
  }

  registry(locator: SessionLocator): InteractionRegistry {
    return this.state(locator).registry;
  }

  checkpoints(locator: SessionLocator): CheckpointStore {
    return this.state(locator).checkpoints;
  }

  /**
   * The Session's write-ahead journal, opened on first use.
   *
   * Loaded rather than merely constructed: `replay` refuses to run against a journal that has not
   * read what is already on disk, which is precisely the guarantee that stops a restarted process
   * from paying twice.
   */
  async journal(locator: SessionLocator): Promise<Journal> {
    const state = this.state(locator);
    if (!state.journal) {
      const dir = this.deps.scratchpadDir(locator);
      state.journal = await openJournal(path.join(dir, "payments.jsonl"));
    }
    return state.journal;
  }

  async paymentGuard(locator: SessionLocator): Promise<SessionPaymentGuard> {
    const state = this.state(locator);
    if (!state.guard) {
      state.guard = new SessionPaymentGuard({
        journal: await this.journal(locator),
        flags: this.deps.flags,
        ...(this.deps.now ? { now: this.deps.now } : {}),
        ...(this.deps.log ? { log: this.deps.log } : {}),
      });
    }
    return state.guard;
  }

  /**
   * Raises a card and publishes it.
   *
   * Returns the built interaction so the caller can hand its id back to the agent; the answer is
   * awaited separately, because the connection that asked may not be the one that hears.
   */
  async request(locator: SessionLocator, input: InteractionInput): Promise<UserInteraction> {
    const state = this.state(locator);
    const interaction = buildInteraction(input, {
      now: () => this.now(),
      computeDigest: paymentSummaryDigest,
    });
    state.registry.create(interaction);
    this.deps.onInteractionRaised?.(interaction.kind);
    this.deps.publish(locator.sessionId, { type: "interaction_request", interaction });

    const stage = stageFor(interaction);
    if (stage) {
      // Best-effort: a task whose checkpoint could not be written is still a task waiting for an
      // answer, and failing the card because a file did not open would be the wrong trade.
      await state.checkpoints
        .write(stage, {
          interactionId: interaction.id,
          kind: interaction.kind,
          ask: interaction.ask,
          ...(interaction.taskId ? { taskId: interaction.taskId } : {}),
          ...(interaction.kind === "commitment_confirmation"
            ? { payment: interaction.payment, digest: interaction.digest }
            : {}),
        })
        .catch((error: unknown) => {
          this.deps.log?.(
            `[interaction] could not write a checkpoint for ${interaction.id}: ${
              (error as Error).message
            }\n`,
          );
        });
    }
    return interaction;
  }

  /** Waits for the person's answer. Safe to call again after a dropped connection. */
  awaitOutcome(
    locator: SessionLocator,
    interactionId: string,
    signal?: AbortSignal,
  ): Promise<InteractionOutcome> {
    return this.state(locator).registry.await(interactionId, signal);
  }

  /**
   * The person answered.
   *
   * A confirmed payment is recorded here rather than by the caller: this is the one moment the
   * summary the person saw, the slack they chose and the turn they were in are all in hand, and
   * recording it anywhere else would mean passing them around to be recombined.
   *
   * Which is also why the answer is checked against the card *first*, before the guard is told
   * anything and before anything is published: consent assembled from an unchecked body is not
   * consent. An answer that does not match throws {@link InvalidOutcomeError} and the card is left
   * pending, so the person can simply answer it again.
   */
  async resolve(
    locator: SessionLocator,
    interactionId: string,
    outcome: InteractionOutcome,
  ): Promise<boolean> {
    const state = this.state(locator);
    const interaction = state.registry.get(interactionId);
    if (!interaction) return false;
    assertOutcomeMatches(interaction, outcome);

    if (
      interaction.kind === "commitment_confirmation" &&
      outcome.status === "answered" &&
      outcome.approved === true &&
      interaction.taskId
    ) {
      const guard = await this.paymentGuard(locator);
      guard.confirm({
        taskId: interaction.taskId,
        summary: interaction.payment,
        ...(outcome.toleranceApproved ? { approvedTolerance: outcome.toleranceApproved } : {}),
        channel: "card",
      });
    }

    const resolved = state.registry.resolve(interactionId, outcome);
    if (resolved) {
      this.deps.publish(locator.sessionId, {
        type: "interaction_resolved",
        interactionId,
        outcome,
      });
    }
    return resolved;
  }

  /**
   * The turn ended.
   *
   * Everything pending is settled as aborted and the turn's confirmation is dropped. Both halves
   * matter: a card with no turn behind it cannot be answered usefully, and consent that outlived
   * its turn would authorise a purchase in the next one.
   */
  endTask(sessionId: string, taskId: string | null): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    for (const pending of state.registry.list()) {
      this.deps.publish(sessionId, {
        type: "interaction_resolved",
        interactionId: pending.id,
        outcome: { status: "aborted" },
      });
    }
    state.registry.settleAll({ status: "aborted" });
    if (taskId) state.guard?.forget(taskId);
  }

  /** Drops a Session's state entirely (the runtime entry was evicted or the Session deleted). */
  forgetSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.registry.settleAll({ status: "aborted" });
    this.sessions.delete(sessionId);
  }

  /**
   * The transaction layer's escalation channel, backed by these cards.
   *
   * This is what makes `submitBooking`'s drift question and any future escalation land in the
   * conversation instead of in a messaging app. The mapping is 003 §7.2 read backwards: a
   * knowledge gap is a selection when it carries options and a question when it does not, an
   * authority gap is a yes/no, and a capability gap is something only the person can do in the
   * page.
   */
  escalationChannel(locator: SessionLocator, taskId?: string): EscalationChannel {
    return {
      name: "app-card",
      send: async (escalation: Escalation, signal?: AbortSignal): Promise<EscalationOutcome> => {
        const interaction = await this.request(locator, {
          ...interactionInputForEscalation(escalation),
          ...(taskId ? { taskId } : {}),
          timeoutMs: escalation.timeoutMs,
          onTimeout: escalation.onTimeout,
        });
        const outcome = await this.awaitOutcome(locator, interaction.id, signal);
        return escalationOutcomeFrom(outcome);
      },
    };
  }

  /** The confirmation ttl a card gets when the caller does not set one. */
  defaultConfirmationExpiry(): string {
    return this.confirmationExpiry();
  }

  /**
   * The expiry a confirmation card will carry, given what the agent asked for.
   *
   * The agent may ask for a **shorter** window than the product's — a card raised seconds before a
   * fare hold lapses should say so — but never a longer one: the ten minutes of 003 §8.1 is a
   * ceiling, and a confirmation that stayed valid for a day would be consent to a purchase whose
   * page nobody has looked at since. So the requested value is clamped rather than trusted.
   *
   * Three inputs are refused outright instead of being repaired, because each would put a false
   * statement on the card:
   *
   * - anything that is not an ISO-8601 timestamp **with a zone** (`Z` or `±hh:mm`) — a local-looking
   *   string is ambiguous by exactly the offset between the agent's idea of time and the server's;
   * - a timestamp that does not parse at all, which would otherwise render as a blank line;
   * - one that has already passed, which is a card that is dead the moment it is shown.
   *
   * Silence is the safe default: with nothing requested, the ceiling is used.
   */
  confirmationExpiry(requested?: string): string {
    const now = this.now().getTime();
    const ceiling = now + DEFAULT_CONFIRMATION_TTL_MS;
    if (requested === undefined || requested.trim() === "") {
      return new Date(ceiling).toISOString();
    }
    if (!ISO_TIMESTAMP.test(requested)) {
      throw new InvalidExpiryError(
        `payment.expiresAt must be an ISO-8601 timestamp with a zone, e.g. ` +
          `"${new Date(ceiling).toISOString()}". Got "${requested}".`,
      );
    }
    const at = Date.parse(requested);
    if (!Number.isFinite(at)) {
      throw new InvalidExpiryError(`payment.expiresAt is not a real instant: "${requested}".`);
    }
    if (at <= now) {
      throw new InvalidExpiryError(
        `payment.expiresAt has already passed ("${requested}"). A confirmation that expires before ` +
          `it is shown is a card nobody can act on; raise it with a real window or leave it unset.`,
      );
    }
    return new Date(Math.min(at, ceiling)).toISOString();
  }
}

/** ISO-8601 with an explicit zone. A timestamp without one is ambiguous by an unknown offset. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** What an agent proposed as an expiry, and why the card will not carry it. */
export class InvalidExpiryError extends Error {
  override readonly name = "InvalidExpiryError";
}

/**
 * 003 §7.2, read backwards: which card an escalation becomes.
 *
 * A knowledge gap is a selection when it carries options and a question when it does not. An
 * authority gap is a yes/no — it has no purchase summary of its own, and building a seven-field
 * payment card out of four fields we do not have would be inventing the three that matter. A
 * capability gap is something only the person can do in the page.
 */
function interactionInputForEscalation(escalation: Escalation): InteractionInput {
  if (escalation.kind === "knowledge_gap" && escalation.context.options?.length) {
    return {
      kind: "selection",
      ask: escalation.ask,
      summary: escalation.context.summary,
      options: escalation.context.options,
      ...(escalation.defaultOptionId ? { defaultOptionId: escalation.defaultOptionId } : {}),
    };
  }
  if (escalation.kind === "authority_gap") {
    return {
      kind: "info_request",
      ask: escalation.ask,
      summary: escalation.context.summary,
      answerShape: "decision",
    };
  }
  if (escalation.kind === "capability_gap") {
    return {
      kind: "human_challenge",
      ask: escalation.ask,
      summary: escalation.context.summary,
    };
  }
  return { kind: "info_request", ask: escalation.ask, summary: escalation.context.summary };
}

function escalationOutcomeFrom(outcome: InteractionOutcome): EscalationOutcome {
  switch (outcome.status) {
    case "answered":
      return {
        status: "answered",
        ...(outcome.optionId !== undefined ? { optionId: outcome.optionId } : {}),
        ...(outcome.approved !== undefined ? { approved: outcome.approved } : {}),
        ...(outcome.message !== undefined ? { message: outcome.message } : {}),
      };
    case "declined":
      return {
        status: "answered",
        approved: false,
        ...(outcome.message !== undefined ? { message: outcome.message } : {}),
      };
    case "timeout":
      return { status: "timeout", policy: outcome.policy };
    case "aborted":
      return { status: "aborted" };
  }
}
