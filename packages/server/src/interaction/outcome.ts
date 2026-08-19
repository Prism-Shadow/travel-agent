/**
 * What an answer is allowed to say, given the question it answers.
 *
 * The card and the answer travel separately: the card is published over SSE, and the answer comes
 * back as a small JSON object over the ordinary cookie surface. Nothing in that round trip forces
 * the two to agree — a body naming an option that is not on the card, or approving a purchase on a
 * question that was never a purchase, is well-formed JSON and would previously have been recorded.
 *
 * The checks run before the resolution is published, so an invalid answer leaves the card exactly
 * where it was: still pending, still answerable, with a 400 explaining what was wrong.
 *
 * Two rules are worth stating in words, because they are the ones that look like pedantry until
 * they are not:
 *
 * - **A payment handoff is accepted explicitly or not at all.** `answered` with `approved` missing
 *   or false is refused rather than read as a "no", because a refusal has its own status
 *   (`declined`). This records whether the person is ready to take over; it never authorizes the
 *   agent to press a payment control.
 * - **A secret card carries nothing back.** Not a value, not a note. In this phase the person types
 *   the code into the site's own field and the card only tells us they did; anything else in the
 *   body is either a secret in transit or a place for one to hide, and both are refused before the
 *   outcome is published over SSE and replayed from a ring buffer.
 */
import type { InteractionOutcome, UserInteraction } from "../api/types.js";

/** An answer that does not match the question. The card stays pending; the caller gets a 400. */
export class InvalidOutcomeError extends Error {
  override readonly name = "InvalidOutcomeError";
}

/** Everything a person's answer may carry, in the order a message names them. */
const PAYLOAD_KEYS = ["value", "values", "optionId", "approved", "message"] as const;

type PayloadKey = (typeof PAYLOAD_KEYS)[number];

/** Which payload fields are actually present (an explicit `undefined` is not present). */
function carried(outcome: InteractionOutcome): PayloadKey[] {
  const record = outcome as Record<string, unknown>;
  return PAYLOAD_KEYS.filter((key) => record[key] !== undefined);
}

function refuseExcept(outcome: InteractionOutcome, allowed: PayloadKey[], what: string): void {
  const extra = carried(outcome).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new InvalidOutcomeError(
      `${what} does not carry ${extra.join(", ")}. An answer is read by the kind of card it ` +
        `answers, and a field that card never offered is either a mistake or somebody else's ` +
        `answer.`,
    );
  }
}

/**
 * Checks an answer against the card it claims to answer, throwing {@link InvalidOutcomeError}.
 *
 * `timeout` and `aborted` are ours rather than the person's — the registry writes them when a clock
 * runs out or a turn ends — so they are not checked here; there is no caller who could get them
 * wrong.
 */
export function assertOutcomeMatches(
  interaction: UserInteraction,
  outcome: InteractionOutcome,
): void {
  if (outcome.status !== "answered" && outcome.status !== "declined") return;

  // First, and regardless of status: a secret card's answer is the fact that it was answered.
  if (interaction.kind === "secret_entry") {
    refuseExcept(
      outcome,
      [],
      "A secret_entry answer carries nothing back — this application never receives the code, and " +
        "an outcome is published over SSE and replayed on reconnect. It",
    );
    return;
  }

  if (outcome.status === "declined") {
    refuseExcept(outcome, ["message"], "A decline says no, and may leave a note. It");
    return;
  }

  switch (interaction.kind) {
    case "selection": {
      refuseExcept(outcome, ["optionId", "message"], "A selection answer picks an option. It");
      const chosen = outcome.optionId;
      if (typeof chosen !== "string" || chosen.trim() === "") {
        throw new InvalidOutcomeError(
          "A selection is answered by choosing one of its options; an answer with no optionId " +
            "leaves the agent to guess which one, which is the decision the card exists to take " +
            "away from it.",
        );
      }
      if (!interaction.options.some((option) => option.id === chosen)) {
        throw new InvalidOutcomeError(
          `"${chosen}" is not one of the options on that card (${interaction.options
            .map((option) => option.id)
            .join(", ")}). The agent would act on a plan nobody was shown.`,
        );
      }
      return;
    }

    case "commitment_confirmation": {
      refuseExcept(outcome, ["approved", "message"], "A payment handoff is a yes or a decline. It");
      if (outcome.approved !== true) {
        throw new InvalidOutcomeError(
          "A payment handoff is accepted explicitly: send `approved: true`, or send `declined` " +
            "for a no. This answer only records that the person is ready to complete payment on " +
            "the merchant page; it does not authorize an agent payment.",
        );
      }
      return;
    }

    case "info_request": {
      if (interaction.answerShape === "decision") {
        refuseExcept(outcome, ["approved", "message"], "A yes/no answer is a boolean. It");
        if (typeof outcome.approved !== "boolean") {
          throw new InvalidOutcomeError(
            "That card asked a yes/no question; its answer is `approved: true` or `approved: " +
              "false` (or `declined`).",
          );
        }
        return;
      }
      refuseExcept(outcome, ["value", "values", "message"], "A question's answer is text. It");
      const hasText = typeof outcome.value === "string" && outcome.value.trim() !== "";
      const hasFields = !!outcome.values && Object.keys(outcome.values).length > 0;
      if (!hasText && !hasFields) {
        throw new InvalidOutcomeError(
          "That card asked for an answer and none arrived. An empty answer would be recorded as " +
            "though the person had said something.",
        );
      }
      return;
    }

    default:
      // `human_challenge` and `browser_takeover`: the person acted in the page. All that comes
      // back is that they finished, and whatever they wanted to tell the agent while they were
      // there — which is steering, and is forwarded as such.
      refuseExcept(
        outcome,
        ["message"],
        "The answer to something done in the page is that it was done, plus an optional note. It",
      );
      return;
  }
}
