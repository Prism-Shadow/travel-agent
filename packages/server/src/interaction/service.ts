/**
 * One place that owns everything a conversation needs to ask its person something.
 *
 * Per Session, and lazily: it holds pending questions and the recently settled outcomes needed by
 * a reconnecting agent command. It does not own payment execution; the agent stops at the payment
 * page and the person completes the irreversible action in the browser.
 *
 * A card never outlives its turn. When the turn ends — finished, aborted, interrupted — every
 * pending question is settled. A card left on screen with nothing behind it would be answered into
 * a void.
 */
import type { InteractionInput, InteractionOutcome, UserInteraction } from "../api/types.js";
import { buildInteraction, DEFAULT_CONFIRMATION_TTL_MS } from "./model.js";
import { assertOutcomeMatches } from "./outcome.js";
import { InteractionRegistry } from "./registry.js";

/** The Session whose conversation owns the card. */
export interface SessionLocator {
  sessionId: string;
}

export interface InteractionServiceDeps {
  /** Publishes a server event on the Session's channel. */
  publish: (sessionId: string, event: InteractionServerEvent) => void;
  /**
   * Observability hook: told the kind of every card raised, so the takeover and
   * secret-phase rates have a denominator. Optional — absent in tests that do not care.
   */
  onInteractionRaised?: (kind: string) => void;
  now?: () => Date;
}

/** The two events this service publishes. Mirrored in `api/types.ts`; kept structural here. */
export type InteractionServerEvent =
  | { type: "interaction_request"; interaction: UserInteraction }
  | { type: "interaction_resolved"; interactionId: string; outcome: InteractionOutcome };

interface SessionState {
  registry: InteractionRegistry;
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
    const created: SessionState = { registry: new InteractionRegistry() };
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

  /**
   * Raises a card and publishes it.
   *
   * Returns the built interaction so the caller can hand its id back to the agent; the answer is
   * awaited separately, because the connection that asked may not be the one that hears.
   */
  request(locator: SessionLocator, input: InteractionInput): UserInteraction {
    const state = this.state(locator);
    const interaction = buildInteraction(input, { now: () => this.now() });
    state.registry.create(interaction);
    this.deps.onInteractionRaised?.(interaction.kind);
    this.deps.publish(locator.sessionId, { type: "interaction_request", interaction });
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
   * The answer is checked against the card before it is published. An answer that does not match
   * throws {@link InvalidOutcomeError} and leaves the card pending so it can be answered again.
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
   * Everything pending is settled as aborted: a card with no turn behind it cannot be answered
   * usefully.
   */
  endTask(sessionId: string): void {
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
  }

  /** Drops a Session's state entirely (the runtime entry was evicted or the Session deleted). */
  forgetSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.registry.settleAll({ status: "aborted" });
    this.sessions.delete(sessionId);
  }

  /** The confirmation ttl a card gets when the caller does not set one. */
  defaultConfirmationExpiry(): string {
    return this.confirmationExpiry();
  }

  /**
   * The expiry a confirmation card will carry, given what the agent asked for.
   *
   * The agent may ask for a **shorter** window than the product's — a card raised seconds before a
   * fare hold lapses should say so — but never a longer one: the ten-minute default is a
   * ceiling, and a review that stayed valid for a day could describe a purchase whose page nobody
   * has looked at since. So the requested value is clamped rather than trusted.
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
