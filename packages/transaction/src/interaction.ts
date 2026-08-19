/**
 * The six ways an agent may interrupt a person, and the only vocabulary it has for doing so.
 *
 * "Stop and ask the human" is one phrase for six different situations, and collapsing them is how
 * an assistant ends up handing the browser back for a question that could have been a sentence.
 * The distinction that matters is not what the agent wants to know — it is **where the person has
 * to act, and what happens to the agent's control of the browser while they do**:
 *
 * | kind | Where the person acts | The agent's browser control |
 * | --- | --- | --- |
 * | `info_request` | a card in the conversation | unchanged |
 * | `selection` | a card | unchanged |
 * | `commitment_confirmation` | a card | unchanged |
 * | `secret_entry` | a card's secure field | **suspended** (`secret_phase`, see `handover.ts`) |
 * | `human_challenge` | the page itself | handed over, briefly |
 * | `browser_takeover` | the page itself | handed over, **last resort** |
 *
 * The first three leave the agent working. That is the point of the whole design: the
 * default used to be "give the user the browser", and everything here exists to make that the
 * exception. `browser_takeover` therefore carries a mandatory `reason` — not as bureaucracy, but
 * so that falling back to "you do it" is a decision somebody can read afterwards and argue with,
 * rather than a convenient default nobody ever sees.
 *
 * Two rules are enforced here rather than left to callers, because both are the kind of thing that
 * is remembered until the one time it is not:
 *
 * - **A payment confirmation names the whole purchase.** All seven fields of the purchase summary, or the
 *   interaction is not built. A card missing its cancellation terms is a card that got the user to
 *   agree to something they were not shown.
 * - **A secret interaction never carries a secret.** The request says which field is wanted and
 *   why; the value travels a different way and never through this object, which is serialized into
 *   SSE, replayed from a ring buffer on reconnect, and written to traces.
 */

import type { EscalationKind, EscalationOption, TimeoutPolicy } from "./escalation.js";

/** The six interaction kinds. */
export type InteractionKind =
  | "info_request"
  | "selection"
  | "commitment_confirmation"
  | "secret_entry"
  | "human_challenge"
  | "browser_takeover";

/** The kinds that take the browser away from the agent, in one place so callers can ask. */
const BROWSER_KINDS: ReadonlySet<InteractionKind> = new Set<InteractionKind>([
  "human_challenge",
  "browser_takeover",
]);

/** Whether this kind is answered **in the page** rather than in a card. */
export function touchesBrowser(kind: InteractionKind): boolean {
  return BROWSER_KINDS.has(kind);
}

/**
 * What the person is being asked to type, for `secret_entry`.
 *
 * A closed set, because two members of it are never fillable by the app under any flag: a payment
 * password and a passkey are human-only by construction, and naming them here is what
 * lets that be checked rather than remembered.
 */
export type SecretField =
  "cvv" | "otp" | "three_d_secure" | "card_number" | "payment_password" | "passkey";

/** Secret fields the app must never fill, whatever the flags say. */
const NEVER_FILLABLE: ReadonlySet<SecretField> = new Set<SecretField>([
  "payment_password",
  "passkey",
]);

export function isNeverFillable(field: SecretField): boolean {
  return NEVER_FILLABLE.has(field);
}

/**
 * The purchase, exactly as the person is shown it.
 *
 * Every field is required. `merchant.domain` is the eTLD+1 and is the *judging* field — the display
 * name is what a phishing page controls, the domain is what it cannot fake — and `amount.currency`
 * is an ISO 4217 code so "1280" can never be read as the wrong money.
 */
export interface PaymentSummary {
  merchant: { name: string; domain: string };
  /** Flight number + date + cabin, or hotel + room + dates + nights. One line a person can check. */
  item: string;
  amount: { value: number; currency: string };
  /** The site's own cancellation terms, quoted, with a link back to where they were read. */
  cancellation: { summary: string; url?: string };
  /** Alias, brand and last four — never a token, never a card number. */
  paymentMethod: { alias: string; brand?: string; last4?: string };
  /** When this confirmation stops meaning anything. Default ten minutes; the card shows it. */
  expiresAt: string;
  /** The turn this purchase belongs to. A confirmation is never reusable by a later turn. */
  taskId: string;
}

/** Slack the person explicitly approved on the card. Absent means **none**. */
export interface ApprovedTolerance {
  /** How far the price may rise before the confirmation is void, in the same currency. */
  amountIncrease: number;
}

export interface InteractionBase {
  id: string;
  kind: InteractionKind;
  /** Imperative: what the person should *do*. Same rule as `Escalation.ask`. */
  ask: string;
  /** One line of context: where the agent is, what it found. Never a value. */
  summary: string;
  /** The turn that asked. Present whenever the host knows it; audits and cards key on it. */
  taskId?: string;
  timeoutMs: number;
  onTimeout: TimeoutPolicy;
  createdAt: string;
}

export interface InfoRequestInteraction extends InteractionBase {
  kind: "info_request";
  /** Optional shape for the answer; free text when absent. */
  fields?: Array<{ name: string; label: string; placeholder?: string }>;
  /**
   * What kind of answer the card should collect.
   *
   * `"decision"` is a yes/no — "the price moved, still go ahead?" — and it exists because the
   * transaction layer's `authority_gap` is exactly that question without being a payment
   * confirmation: it has no purchase summary of its own, and pretending it did would mean building
   * a seven-field card out of four fields we do not have. Defaults to free text.
   */
  answerShape?: "text" | "decision";
}

export interface SelectionInteraction extends InteractionBase {
  kind: "selection";
  /** The representative set. Same rule as escalations: every option states why it is here. */
  options: EscalationOption[];
  defaultOptionId?: string;
}

export interface CommitmentConfirmationInteraction extends InteractionBase {
  kind: "commitment_confirmation";
  payment: PaymentSummary;
  /**
   * Canonical hash of `payment`, computed when the card is built.
   *
   * The anchor for everything downstream: what the person was shown, in a form that a later
   * natural-language "yes, that one" can be tied to, and that a drift check can be compared
   * against. Phase 4 embeds it in a payment capability; it is computed here because the only
   * moment it is knowable is the moment the summary is finalized.
   */
  digest: string;
  /** Offered on the card as an explicit choice. Absent = the exact amount is the hard ceiling. */
  offeredTolerance?: ApprovedTolerance;
}

export interface SecretEntryInteraction extends InteractionBase {
  kind: "secret_entry";
  field: SecretField;
  /** Why this is needed, in the person's words, for the card and the audit. */
  purpose: string;
  /**
   * Whether the app will fill the value, or the person types it into the page themselves.
   *
   * False is the shipped behaviour: the card explains what is needed and the person completes it
   * in the site's own field or their bank's app, with the agent paused. True requires
   * `secret_entry.live`, which requires the scoped secret phase — the detach, the
   * proof the field was cleared, and the three exits. Building this with `live: true` for a field
   * that is never fillable is refused outright.
   */
  live: boolean;
}

export interface HumanChallengeInteraction extends InteractionBase {
  kind: "human_challenge";
  /** CSS selector to highlight in the page. Best-effort; the person is looking at the page. */
  targetSelector?: string;
}

export interface BrowserTakeoverInteraction extends InteractionBase {
  kind: "browser_takeover";
  /**
   * Why the other five kinds were not enough. Required and non-empty.
   *
   * This is the whole difference between a last resort and a habit: a takeover with no stated
   * reason cannot be reviewed, and the observability design asks for the trigger rate precisely because a high
   * one means the design is failing somewhere upstream.
   */
  reason: string;
  targetSelector?: string;
}

export type UserInteraction =
  | InfoRequestInteraction
  | SelectionInteraction
  | CommitmentConfirmationInteraction
  | SecretEntryInteraction
  | HumanChallengeInteraction
  | BrowserTakeoverInteraction;

/**
 * What came back.
 *
 * `declined` is a first-class answer, not a failure: "no, do not pay that" is the outcome the
 * confirmation exists to be able to receive, and an agent that treats it as an error will retry.
 */
export type InteractionOutcome =
  | {
      status: "answered";
      /** `info_request`: free text, or one entry per requested field. */
      value?: string;
      values?: Record<string, string>;
      /** `selection`: which option. */
      optionId?: string;
      /** `commitment_confirmation`: true only when the person confirmed the purchase. */
      approved?: boolean;
      /** Set only when the person explicitly accepted the offered slack on the card. */
      toleranceApproved?: ApprovedTolerance;
      /** Free text the person left; the host forwards it as steering. */
      message?: string;
    }
  | { status: "declined"; message?: string }
  | { status: "timeout"; policy: TimeoutPolicy }
  | { status: "aborted" };

/** The six kinds are a refinement of the transaction layer's three gaps. */
export function escalationKindFor(kind: InteractionKind): EscalationKind {
  switch (kind) {
    case "info_request":
    case "selection":
      return "knowledge_gap";
    case "commitment_confirmation":
      return "authority_gap";
    default:
      return "capability_gap";
  }
}

/** Default budget for an interaction: long enough to read a card and answer it. */
export const DEFAULT_INTERACTION_TIMEOUT_MS = 120_000;

/** What a payment confirmation is worth after this long. Ten minutes. */
export const DEFAULT_CONFIRMATION_TTL_MS = 10 * 60_000;

let counter = 0;

export function newInteractionId(prefix = "int"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${what} is required and must not be empty.`);
  }
  return value;
}

/** Input to {@link buildInteraction}: the kind-specific parts, minus what this module fills in. */
export type InteractionInput = {
  taskId?: string;
  timeoutMs?: number;
  onTimeout?: TimeoutPolicy;
} & (
  | Omit<InfoRequestInteraction, "id" | "createdAt" | "timeoutMs" | "onTimeout">
  | Omit<SelectionInteraction, "id" | "createdAt" | "timeoutMs" | "onTimeout">
  | (Omit<
      CommitmentConfirmationInteraction,
      "id" | "createdAt" | "timeoutMs" | "onTimeout" | "digest"
    > & {
      digest?: string;
    })
  | Omit<SecretEntryInteraction, "id" | "createdAt" | "timeoutMs" | "onTimeout">
  | Omit<HumanChallengeInteraction, "id" | "createdAt" | "timeoutMs" | "onTimeout">
  | Omit<BrowserTakeoverInteraction, "id" | "createdAt" | "timeoutMs" | "onTimeout">
);

/**
 * Builds an interaction, refusing the ones that would be dishonest to show.
 *
 * Every check here is a card that must not reach a person: an option with no reason to be on it, a
 * purchase with no cancellation terms, a takeover with no justification, a secret request carrying
 * a secret. They throw rather than degrade, because each one is a programming error on the way to
 * asking somebody to agree to something.
 *
 * `now` and `computeDigest` are injected so the same input produces the same object in a test.
 */
export function buildInteraction(
  input: InteractionInput,
  options: { now?: () => Date; computeDigest?: (summary: PaymentSummary) => string } = {},
): UserInteraction {
  const now = options.now?.() ?? new Date();
  const base = {
    id: newInteractionId(),
    ask: requireText(input.ask, "ask"),
    summary: typeof input.summary === "string" ? input.summary : "",
    ...(input.taskId !== undefined ? { taskId: requireText(input.taskId, "taskId") } : {}),
    timeoutMs: input.timeoutMs ?? DEFAULT_INTERACTION_TIMEOUT_MS,
    onTimeout: input.onTimeout ?? "suspend",
    createdAt: now.toISOString(),
  };

  switch (input.kind) {
    case "info_request":
      return {
        ...base,
        kind: "info_request",
        ...(input.fields ? { fields: input.fields } : {}),
        ...(input.answerShape ? { answerShape: input.answerShape } : {}),
      };

    case "selection": {
      const options_ = input.options ?? [];
      if (options_.length < 2) {
        throw new Error(
          "A selection needs at least two options; with one there is nothing to decide and the " +
            "agent should simply proceed.",
        );
      }
      for (const option of options_) {
        if (!option.rationale.trim()) {
          throw new Error(
            `Option "${option.id}" has no rationale. A person scanning a card decides from those ` +
              `lines, not by comparing six attributes.`,
          );
        }
      }
      return {
        ...base,
        kind: "selection",
        options: options_,
        ...(input.defaultOptionId ? { defaultOptionId: input.defaultOptionId } : {}),
      };
    }

    case "commitment_confirmation": {
      const payment = assertCompleteSummary(input.payment);
      const digest = input.digest ?? options.computeDigest?.(payment);
      if (!digest) {
        throw new Error(
          "A payment confirmation needs a digest of the summary being shown. It is the only thing " +
            "a later confirmation can be tied back to.",
        );
      }
      return {
        ...base,
        kind: "commitment_confirmation",
        payment,
        digest,
        ...(input.offeredTolerance ? { offeredTolerance: input.offeredTolerance } : {}),
      };
    }

    case "secret_entry": {
      const field = input.field;
      const live = input.live === true;
      if (live && isNeverFillable(field)) {
        throw new Error(
          `A ${field} is never filled by this application, under any flag: it is entered by the ` +
            `person, in the site's own field or their bank's app.`,
        );
      }
      // The request describes a want. Anything that looks like an answer is refused here rather
      // than filtered later: this object is published over SSE, replayed on reconnect and written
      // to traces, and "we strip it downstream" is a promise made in four places.
      assertCarriesNoValue(input as unknown as Record<string, unknown>);
      return {
        ...base,
        kind: "secret_entry",
        field,
        purpose: requireText(input.purpose, "purpose"),
        live,
      };
    }

    case "human_challenge":
      return {
        ...base,
        kind: "human_challenge",
        ...(input.targetSelector ? { targetSelector: input.targetSelector } : {}),
      };

    case "browser_takeover":
      return {
        ...base,
        kind: "browser_takeover",
        reason: requireText(
          input.reason,
          "A browser takeover needs a reason: it is the last resort, and an unexplained one",
        ),
        ...(input.targetSelector ? { targetSelector: input.targetSelector } : {}),
      };
  }
}

/** Field names that would mean a secret travelled inside the request. */
const VALUE_KEYS = ["value", "secret", "code", "otp", "cvv", "password", "token", "pan"];

/**
 * Refuses a request object that carries anything shaped like the answer.
 *
 * Name-based, and deliberately so: this is a contract check on a small, closed object built by our
 * own code, not a content filter on arbitrary data. It exists to fail a wrong call at the point of
 * the call, where the stack still says who made it.
 */
export function assertCarriesNoValue(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (VALUE_KEYS.includes(key.toLowerCase())) {
      throw new Error(
        `A secret_entry request must not carry "${key}". The request says which field is wanted ` +
          `and why; the value never travels through an object that is published over SSE, ` +
          `replayed on reconnect and written to traces.`,
      );
    }
  }
}

/** Checks all seven fields, naming the one that is missing. */
export function assertCompleteSummary(summary: PaymentSummary | undefined): PaymentSummary {
  if (!summary) throw new Error("A payment confirmation needs a summary of what is being bought.");
  requireText(summary.merchant?.name, "merchant.name");
  requireText(summary.merchant?.domain, "merchant.domain (the eTLD+1 — the field that judges)");
  requireText(summary.item, "item (what is being bought, in one checkable line)");
  if (typeof summary.amount?.value !== "number" || !Number.isFinite(summary.amount.value)) {
    throw new Error("amount.value is required and must be a finite number.");
  }
  requireText(summary.amount?.currency, "amount.currency (ISO 4217)");
  requireText(
    summary.cancellation?.summary,
    "cancellation.summary — a purchase shown without its cancellation terms is one the person " +
      "was not really shown",
  );
  requireText(summary.paymentMethod?.alias, "paymentMethod.alias");
  requireText(summary.expiresAt, "expiresAt");
  requireText(summary.taskId, "taskId");
  if (summary.paymentMethod && "token" in summary.paymentMethod) {
    throw new Error(
      "paymentMethod must carry only an alias, brand and last four. A token may itself be able " +
        "to charge the card and never appears on a card or in an event.",
    );
  }
  return summary;
}
