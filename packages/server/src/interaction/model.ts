/**
 * Runtime construction and validation for interaction cards.
 *
 * The public shape lives in `api/types.ts` because the server and Web render the same contract.
 * This module owns only the checks required before that contract is published or replayed.
 */
import type {
  InteractionInput,
  PaymentSummary,
  SecretField,
  UserInteraction,
} from "../api/types.js";

export const DEFAULT_INTERACTION_TIMEOUT_MS = 120_000;
export const DEFAULT_CONFIRMATION_TTL_MS = 10 * 60_000;

const NEVER_FILLABLE: ReadonlySet<SecretField> = new Set<SecretField>([
  "payment_password",
  "passkey",
]);

export function isNeverFillable(field: SecretField): boolean {
  return NEVER_FILLABLE.has(field);
}

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

/** Builds a card, rejecting incomplete or unsafe requests before they reach the event stream. */
export function buildInteraction(
  input: InteractionInput,
  options: { now?: () => Date } = {},
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
  } as const;

  switch (input.kind) {
    case "info_request":
      return {
        ...base,
        kind: "info_request",
        ...(input.fields ? { fields: input.fields } : {}),
        ...(input.answerShape ? { answerShape: input.answerShape } : {}),
      };

    case "selection": {
      if (input.options.length < 2) {
        throw new Error(
          "A selection needs at least two options; with one there is nothing to decide and the " +
            "agent should simply proceed.",
        );
      }
      for (const option of input.options) {
        if (!option.rationale.trim()) {
          throw new Error(
            `Option "${option.id}" has no rationale. A person scanning a card decides from those ` +
              "lines, not by comparing six attributes.",
          );
        }
      }
      return {
        ...base,
        kind: "selection",
        options: input.options,
        ...(input.defaultOptionId ? { defaultOptionId: input.defaultOptionId } : {}),
      };
    }

    case "commitment_confirmation":
      return {
        ...base,
        kind: "commitment_confirmation",
        payment: assertCompleteSummary(input.payment),
      };

    case "secret_entry": {
      const live = input.live === true;
      if (live && isNeverFillable(input.field)) {
        throw new Error(
          `A ${input.field} is never filled by this application, under any flag: it is entered by ` +
            "the person, in the site's own field or their bank's app.",
        );
      }
      assertCarriesNoValue(input as unknown as Record<string, unknown>);
      return {
        ...base,
        kind: "secret_entry",
        field: input.field,
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

const VALUE_KEYS = ["value", "secret", "code", "otp", "cvv", "password", "token", "pan"];

/** Refuses a secret request that carries anything shaped like the requested value. */
export function assertCarriesNoValue(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (VALUE_KEYS.includes(key.toLowerCase())) {
      throw new Error(
        `A secret_entry request must not carry "${key}". The request says which field is wanted ` +
          "and why; the value never travels through an object that is published over SSE or " +
          "replayed on reconnect.",
      );
    }
  }
}

/** Checks all seven fields in the payment summary shown before handoff. */
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
