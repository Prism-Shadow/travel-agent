/**
 * The guarded path to an irreversible action.
 *
 * Named for booking because that is the case that motivated it, but nothing here is about travel:
 * it takes an action name and a callback, and guards a refund or a file deletion identically. It
 * lived in a travel-domain package until that package was removed — the two things beside it there,
 * choosing which options to show and deciding whether two listings are the same product, were
 * judgements a model makes better than a rule table, and were deleted rather than maintained. This
 * one stayed because it is not a judgement at all: it is the enforcement that has to hold *even
 * when the agent is wrong*, which is a different job and the only kind that earns code.
 *
 * Everything the transaction layer provides is only worth having if it is impossible to bypass.
 * A journal that some code paths use and others do not is not a safety property — it is a habit,
 * and habits break under a deadline. So submitting an order goes through here or it does not
 * happen, and the five checks run in a fixed order with no way to skip one:
 *
 * ```
 *   capability  is there a one-shot permission for *this* purchase, still valid, on this domain?
 *   authority   is this even allowed at the agreed ceiling?
 *   drift       is what I am about to buy still what they agreed to?
 *   journal     has this already happened, in a previous life of this process?
 *   submit      …only now, bracketed by write-ahead records
 * ```
 *
 * The order is not arbitrary. The capability is first (design/003 §10.2) because it is the only
 * check that can say "nobody authorised this at all", and because it is the one that catches a
 * payment page that has moved domain — a question worth answering before reading anything else on
 * it. Authority is next: cheap, and it rejects hardest. Drift needs the live plan, so it comes
 * after the page has been read but before anything is written down. The journal check must be last
 * of the four, because it is the only one that can discover the action *already ran* — and asking
 * that before knowing the action is permitted would be asking about something that should never
 * have been attempted.
 *
 * The capability check is skipped when no capability is supplied, unless `requireCapability` is
 * set. That is deliberate rather than lax: an order that needs no payment credential (pay at the
 * counter) is still submitted through this path, and the execute path in the desktop main process
 * — the only caller that actually moves money — sets the flag, so the permission is mandatory
 * exactly where 003 §10.3 requires it.
 */
import { checkPaymentCapability, type PaymentCapability } from "./capability.js";
import {
  checkDrift,
  describeDrift,
  permits,
  type AuthorityCeiling,
  type Commitment,
} from "./commitment.js";
import { type Journal } from "./journal.js";

/**
 * Why a booking did not go through. Every one of these is a normal outcome, not an error.
 *
 * The last six come from the capability gate. 003 §10.2 names four of them; `capability_used` and
 * `amount_over_max` are split out rather than folded into `capability_invalid` because they are
 * the two a person can act on differently — one means "ask the merchant what happened, do not pay
 * again", the other means "the price is above what was authorised".
 */
export type RefusalReason =
  | "ceiling_too_low"
  | "plan_drifted"
  | "escalation_declined"
  | "escalation_lapsed"
  | "capability_missing"
  | "capability_invalid"
  | "capability_expired"
  | "capability_used"
  | "merchant_mismatch"
  | "amount_over_max"
  | "tolerance_not_approved";

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
  /**
   * The one-shot permission for this purchase (003 §8.2), when there is one.
   *
   * Supplying it also pins the journal key to the *purchase* rather than to the action and its
   * params, so a capability reissued for the same displayed summary cannot pay twice.
   */
  capability?: PaymentCapability;
  /**
   * The turn asking to book. Required alongside `capability`: a permission from another turn is
   * refused rather than repaired.
   */
  taskId?: string;
  /**
   * Whether a capability is mandatory. Set by the execute path, which is the only caller that
   * moves money; left off for orders that need no payment credential (003 §10.3's residual case).
   */
  requireCapability?: boolean;
  /** Injected in tests; the capability checks are the only clock-dependent part of this path. */
  now?: Date;
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

  // 1 · Capability. First, because it is the only check that can say nobody authorised this at
  // all, and because a payment page that has moved domain should be caught before its contents
  // are given any weight.
  if (options.capability) {
    if (!options.taskId) {
      return {
        status: "refused",
        reason: "capability_invalid",
        detail: [
          "A capability was supplied without saying which turn is spending it. A permission is " +
            "bound to one turn, and an unnamed caller cannot be the one it was issued to.",
        ],
      };
    }
    const verdict = checkPaymentCapability({
      capability: options.capability,
      taskId: options.taskId,
      actualPlan,
      commitment,
      ...(options.now ? { now: options.now } : {}),
    });
    if (!verdict.ok) {
      return { status: "refused", reason: verdict.reason, detail: verdict.detail };
    }
  } else if (options.requireCapability) {
    return {
      status: "refused",
      reason: "capability_missing",
      detail: [
        "This path may only be taken with a one-shot permission issued from a confirmation the " +
          "person actually saw (003 §8.2). There is no way to authorise a payment from inside " +
          "the agent's own run.",
      ],
    };
  }

  // 2 · Authority.
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

  // 3 · Drift.
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

  // 4 · Journal. Was this already done? Only it knows, and only it may run the action.
  //
  // With a capability, the key comes from the capability rather than from the action and params:
  // it names the turn and the digest of the summary the person saw, so a permission reissued for
  // that same summary — after a lapse, after a dropped connection — lands on the *same* journal
  // entry and returns the first attempt's outcome instead of paying a second time.
  const op = {
    action,
    params: commitment.approved,
    ...(options.capability ? { key: options.capability.idempotencyKey } : {}),
  };
  const before = journal.danglingIntents().some((entry) => entry.action === action);
  const outcome = await journal.replay(
    op,
    submit,
    options.reconcile ? { reconcile: options.reconcile } : {},
  );

  return { status: "submitted", outcome, replayed: before };
}
