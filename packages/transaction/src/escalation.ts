/**
 * Escalation: the typed channel from an agent back to the person who is not watching.
 *
 * "Stop and ask" collapses four different interruptions into one, and they need different
 * handling:
 *
 * | Kind | Example | What it needs |
 * | --- | --- | --- |
 * | `capability_gap` | slider captcha, SMS code | a **handoff** — the human acts in the browser |
 * | `authority_gap` | price drifted past tolerance | an **authorisation** — approve or refuse |
 * | `knowledge_gap` | two rooms, ¥80 apart | a **decision** — pick one |
 *
 * There is deliberately no `recovery_gap`. A stale page, a timeout, a sold-out room are for the
 * agent to re-plan around; routing them here produces an assistant that stops every two minutes
 * and is worse than useless.
 *
 * Two fields carry more weight than they look:
 *
 * - **`ask`** is imperative — what the person should *do*, not a description of the situation.
 *   A notification that explains a problem without naming the action is a notification people
 *   put off.
 * - **`onTimeout`** is required. Without a defined lapse behaviour an unanswered escalation is
 *   a task that dies silently, which is the worst outcome of the three: the human believes it is
 *   still working. The default everywhere in this project is `suspend` — keep the checkpoint,
 *   resume when they come back.
 */

export type EscalationKind = "capability_gap" | "authority_gap" | "knowledge_gap";

/** What happens when nobody answers in time. */
export type TimeoutPolicy = "suspend" | "abort" | "proceed_with_default";

/** One option in a `knowledge_gap` — a representative, with the reason it is on the card. */
export interface EscalationOption {
  id: string;
  /** One line naming the option itself. */
  label: string;
  /**
   * Why *this* one is being shown — "唯一直飞", "最便宜，省 400". Required, and not decoration:
   * a person scanning a phone decides from these, not by comparing six attributes. An option
   * whose reason cannot be stated in one line does not belong on the card.
   */
  rationale: string;
  /** The structured plan behind the option; becomes `Commitment.approved` when picked. */
  plan: Record<string, unknown>;
}

export interface Escalation {
  id: string;
  kind: EscalationKind;
  /** Imperative. What the human should do. */
  ask: string;
  context: {
    summary: string;
    screenshotPath?: string;
    /** Present for `knowledge_gap`; 3–4 entries, each with its rationale. */
    options?: EscalationOption[];
  };
  timeoutMs: number;
  onTimeout: TimeoutPolicy;
  /** Set when `onTimeout` is `proceed_with_default`; the option id to take. */
  defaultOptionId?: string;
  createdAt: string;
}

export type EscalationOutcome =
  | { status: "answered"; optionId?: string; approved?: boolean; message?: string }
  | { status: "timeout"; policy: TimeoutPolicy }
  | { status: "aborted" };

/**
 * A way to reach the human and hear back.
 *
 * Deliberately transport-agnostic: an interactive card in a messaging app, a CLI prompt, an
 * in-browser overlay. Implementations live in `channel/`; nothing in this package knows which
 * one is in use.
 */
export interface EscalationChannel {
  readonly name: string;
  /** Delivers the escalation and waits. Must resolve on timeout rather than reject. */
  send(escalation: Escalation, signal?: AbortSignal): Promise<EscalationOutcome>;
}

let counter = 0;

export function newEscalationId(prefix = "esc"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

/** Builds an escalation with the project's defaults (suspend on lapse, two-minute budget). */
export function escalation(input: {
  kind: EscalationKind;
  ask: string;
  summary: string;
  screenshotPath?: string;
  options?: EscalationOption[];
  timeoutMs?: number;
  onTimeout?: TimeoutPolicy;
  defaultOptionId?: string;
}): Escalation {
  if (input.onTimeout === "proceed_with_default" && !input.defaultOptionId) {
    throw new Error("onTimeout 'proceed_with_default' requires defaultOptionId.");
  }
  if (input.options) {
    for (const option of input.options) {
      if (!option.rationale.trim()) {
        throw new Error(
          `Option "${option.id}" has no rationale. Every option must state why it is on the ` +
            `card; one that cannot be justified in a line should not be shown.`,
        );
      }
    }
  }
  return {
    id: newEscalationId(),
    kind: input.kind,
    ask: input.ask,
    context: {
      summary: input.summary,
      screenshotPath: input.screenshotPath,
      options: input.options,
    },
    timeoutMs: input.timeoutMs ?? 120_000,
    onTimeout: input.onTimeout ?? "suspend",
    defaultOptionId: input.defaultOptionId,
    createdAt: new Date().toISOString(),
  };
}
