/**
 * The guarded path to an irreversible action.
 *
 * Everything the transaction layer provides is only worth having if it is impossible to bypass.
 * A journal that some code paths use and others do not is not a safety property — it is a habit,
 * and habits break under a deadline. So submitting an order goes through here or it does not
 * happen, and the four checks run in a fixed order with no way to skip one:
 *
 * ```
 *   authority   is this even allowed at the agreed ceiling?
 *   drift       is what I am about to buy still what they agreed to?
 *   journal     has this already happened, in a previous life of this process?
 *   submit      …only now, bracketed by write-ahead records
 * ```
 *
 * The order is not arbitrary. Authority is cheapest and rejects hardest. Drift needs the live
 * plan, so it comes after the page has been read but before anything is written down. The journal
 * check must be last of the three, because it is the only one that can discover the action
 * *already ran* — and asking that question before knowing the action is permitted would be asking
 * about something that should never have been attempted.
 */
import {
  checkDrift,
  describeDrift,
  permits,
  type AuthorityCeiling,
  type Commitment,
  type Journal,
} from "@travel-agent/transaction";

/** Why a booking did not go through. Every one of these is a normal outcome, not an error. */
export type RefusalReason =
  "ceiling_too_low" | "plan_drifted" | "escalation_declined" | "escalation_lapsed";

export type BookingResult<T> =
  | { status: "submitted"; outcome: T; replayed: boolean }
  | { status: "refused"; reason: RefusalReason; detail: string[] };

export interface SubmitBookingOptions<T> {
  /** Write-ahead journal for this task. The only thing that may run `submit`. */
  journal: Journal;
  /** What the human agreed to, and how far reality may drift from it. */
  commitment: Commitment;
  /** The plan as it stands *now*, read from the page immediately before submitting. */
  actualPlan: Record<string, unknown>;
  /** What this action needs — `submit_order` to place it, `pay` to also pay. */
  requiredCeiling: AuthorityCeiling;
  /** Stable action name for the journal, e.g. `ctrip.submitHotelOrder`. */
  action: string;
  /** The irreversible act itself. Called at most once, ever. */
  submit: () => Promise<T>;
  /**
   * Asks the human about drift. Returning false refuses the booking; the caller decides how to
   * present it (an interactive card, a CLI prompt). Absent, any drift refuses outright — the
   * safe default, since silence must never be read as consent.
   */
  confirmDrift?: (drifts: string[]) => Promise<boolean>;
  /**
   * Determines what actually happened when recovery finds an action that started and never
   * finished. Must ask the booking system, never repeat the action.
   */
  reconcile?: () => Promise<T>;
}

/**
 * Books, or refuses and says why.
 *
 * Refusals are values rather than exceptions: "the price moved and they said no" is an ordinary
 * outcome the task has to report, and throwing would push it into a catch block alongside genuine
 * faults, where the distinction gets lost.
 */
export async function submitBooking<T>(
  options: SubmitBookingOptions<T>,
): Promise<BookingResult<T>> {
  const { journal, commitment, actualPlan, requiredCeiling, action, submit } = options;

  if (!permits(commitment, requiredCeiling)) {
    return {
      status: "refused",
      reason: "ceiling_too_low",
      detail: [
        `本次授权到 ${commitment.ceiling}，而这一步需要 ${requiredCeiling}。` +
          `先回到用户那里把授权提上去，不要绕过。`,
      ],
    };
  }

  const drift = checkDrift(commitment, actualPlan);
  if (!drift.withinCommitment) {
    const lines = describeDrift(drift.drifts);
    // No confirm path means no consent. Proceeding here would be the exact failure the whole
    // commitment model exists to prevent: buying something other than what was agreed.
    if (!options.confirmDrift) {
      return { status: "refused", reason: "plan_drifted", detail: lines };
    }
    const approved = await options.confirmDrift(lines);
    if (!approved) {
      return { status: "refused", reason: "escalation_declined", detail: lines };
    }
  }

  // Was this already done? Only the journal knows, and only it may run the action.
  const before = journal.danglingIntents().some((entry) => entry.action === action);
  const outcome = await journal.replay(
    { action, params: commitment.approved },
    submit,
    options.reconcile ? { reconcile: options.reconcile } : {},
  );

  return { status: "submitted", outcome, replayed: before };
}
