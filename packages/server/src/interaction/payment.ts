/**
 * The payment guard: what stands between a confirmed card and an irreversible act.
 *
 * The agent never holds the decision. It reads the payment page, reports what it sees, and asks;
 * the answer comes from here, from a comparison against what the person actually agreed to. Five
 * refusals in a fixed order, and the ordering is the design:
 *
 * ```
 *   confirmed?     is there a confirmation for this turn at all?
 *   still valid?   has it expired, or was it already used?
 *   same merchant? a payment page on another domain has no re-confirmation path
 *   authority + drift + journal   ← transaction/booking.ts, unchanged
 *   allowed to press pay?         ← payments.agent_click_pay, off in this phase
 * ```
 *
 * The last one is deliberately last. Everything above it is the *decision* — is this purchase the
 * one that was agreed to — and it is worth computing, and testing, even in a build where the answer
 * to "may the agent press the button" is always no. Phase 3 ships with that flag off and its
 * dependencies unreachable, so the shipped behaviour is: the agent stops at the payment
 * page, the person completes it. That is not a stub; it is the phase's terminal state (004 Phase 3).
 *
 * **The journal brackets the authorization, not the click**, and the seam is where it has to be.
 * `submitBooking`'s `submit` callback resolves only when the agent reports back what happened, so
 * the write-ahead intent is fsynced *before* the go-ahead leaves this process and the result is
 * written when the outcome is known. A crash in between leaves a dangling intent, and the next
 * attempt for the same purchase is refused with "go and find out what happened" rather than
 * retried — the one behaviour that keeps a double charge impossible (transaction/journal.ts).
 */
import {
  checkDrift,
  classifyDrift,
  commitmentFromConfirmation,
  describeDrift,
  paymentSummaryDigest,
  planFromSummary,
  DanglingIntentError,
  type ApprovedTolerance,
  type Commitment,
  type Journal,
  type PaymentSummary,
} from "@travel-agent/transaction";
import { submitBooking } from "@travel-agent/transaction";
import type { FeatureFlagsShape } from "./transaction-imports.js";

/** Why a payment was refused. Every one of these is an ordinary outcome the agent must report. */
export type PaymentRefusal =
  /** No confirmation card was answered for this turn. */
  | "not_confirmed"
  /** The confirmation lapsed (default: ten minutes). */
  | "confirmation_expired"
  /** The page is on a different merchant domain — no re-confirmation offered. */
  | "merchant_mismatch"
  /** Price, dates, terms or a new fee moved outside what was approved. */
  | "plan_drifted"
  /** The confirmation authorised less than paying. */
  | "ceiling_too_low"
  /** This build does not let the agent press "pay" (004 Phase 3; `payments.agent_click_pay`). */
  | "agent_pay_disabled"
  /** A previous attempt was cleared and never reported. Reconcile before anything else. */
  | "dangling_intent"
  /** The same purchase is already being authorised right now. */
  | "in_flight";

export interface PaymentAuthorization {
  authorizationId: string;
  taskId: string;
  /** Echoed so the agent can prove which purchase it is reporting on. */
  digest: string;
}

export type PaymentDecision =
  | { status: "authorized"; authorization: PaymentAuthorization }
  | { status: "refused"; reason: PaymentRefusal; detail: string[] };

/** What the person confirmed, kept for the turn that asked. */
export interface ConfirmedPurchase {
  taskId: string;
  summary: PaymentSummary;
  digest: string;
  commitment: Commitment;
  approvedTolerance?: ApprovedTolerance;
  /** Which channel carried the confirmation: the card, or a message the judge accepted. */
  channel: string;
  /** Set when a natural-language reply was accepted: the message that did it. */
  confirmingMessageId?: string;
  confirmedAt: string;
}

export interface PaymentGuardDeps {
  /** The Session's write-ahead journal. Opened by the host; the guard never creates one. */
  journal: Journal;
  /** Effective feature flags for this run. */
  flags: FeatureFlagsShape;
  /** Injected for tests. */
  now?: () => Date;
  log?: (line: string) => void;
}

interface InFlight {
  authorization: PaymentAuthorization;
  /** Resolves when the agent reports what the click did; drives `submitBooking`'s `submit`. */
  report: (outcome: Record<string, unknown>) => void;
  fail: (error: Error) => void;
}

/**
 * One Session's confirmations and the guard over them.
 *
 * Per Session rather than global because the journal is: a payment belongs to one conversation's
 * scratchpad, and a key derived in one conversation must never satisfy another's replay check.
 */
export class SessionPaymentGuard {
  private readonly confirmations = new Map<string, ConfirmedPurchase>();
  private readonly inFlight = new Map<string, InFlight>();

  constructor(private readonly deps: PaymentGuardDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * Records what the person agreed to.
   *
   * The digest is recomputed here from the summary rather than trusted from the caller: it is the
   * anchor everything downstream compares against, and a digest that did not come from the object
   * it claims to describe would make every later check vacuous.
   */
  confirm(input: {
    taskId: string;
    summary: PaymentSummary;
    approvedTolerance?: ApprovedTolerance;
    channel: string;
    confirmingMessageId?: string;
  }): ConfirmedPurchase {
    const digest = paymentSummaryDigest(input.summary);
    const confirmed: ConfirmedPurchase = {
      taskId: input.taskId,
      summary: input.summary,
      digest,
      commitment: commitmentFromConfirmation({
        summary: input.summary,
        ...(input.approvedTolerance ? { approvedTolerance: input.approvedTolerance } : {}),
        channel: input.channel,
        approvedAt: this.now().toISOString(),
      }),
      ...(input.approvedTolerance ? { approvedTolerance: input.approvedTolerance } : {}),
      channel: input.channel,
      ...(input.confirmingMessageId ? { confirmingMessageId: input.confirmingMessageId } : {}),
      confirmedAt: this.now().toISOString(),
    };
    this.confirmations.set(input.taskId, confirmed);
    return confirmed;
  }

  /** What this turn confirmed, if anything. */
  confirmationFor(taskId: string): ConfirmedPurchase | null {
    return this.confirmations.get(taskId) ?? null;
  }

  /** Forgets a turn's confirmation. Called when the turn ends: consent does not outlive it. */
  forget(taskId: string): void {
    this.confirmations.delete(taskId);
    for (const [id, entry] of [...this.inFlight]) {
      if (entry.authorization.taskId !== taskId) continue;
      this.inFlight.delete(id);
      entry.fail(new Error("The turn ended before the payment outcome was reported."));
    }
  }

  /**
   * Asks whether this payment may proceed, and — if it may — writes the intent before saying so.
   *
   * `actualPlan` is what the agent reads off the payment page *now*, in the shape
   * `planFromSummary` produces. Anything else it contains counts as drift: a booking page that grew
   * a seat fee between the card and the click is exactly the case `checkDrift`'s `added` branch is
   * there to catch.
   */
  async authorize(input: {
    taskId: string;
    /** The plan as the page states it at this moment. */
    actualPlan: Record<string, unknown>;
    /** Stable action name for the journal, e.g. `ctrip.payFlightOrder`. */
    action: string;
  }): Promise<PaymentDecision> {
    const confirmed = this.confirmations.get(input.taskId);
    if (!confirmed) {
      return {
        status: "refused",
        reason: "not_confirmed",
        detail: [
          "Nobody has confirmed this purchase. Show a commitment_confirmation card with the " +
            "seven fields and wait for an answer before coming back here.",
        ],
      };
    }

    if (Date.parse(confirmed.summary.expiresAt) <= this.now().getTime()) {
      return {
        status: "refused",
        reason: "confirmation_expired",
        detail: [`The confirmation expired at ${confirmed.summary.expiresAt}. Ask again.`],
      };
    }

    for (const entry of this.inFlight.values()) {
      if (entry.authorization.taskId === input.taskId) {
        return {
          status: "refused",
          reason: "in_flight",
          detail: ["This purchase is already authorised and waiting for its outcome."],
        };
      }
    }

    // Merchant first, and separately from the rest of drift: the others are "ask again", this one
    // is "stop". A payment page that moved to another domain is the shape of a hijack, and the
    // re-confirmation dialog would be the thing walking into it.
    const drift = checkDrift(confirmed.commitment, input.actualPlan);
    const verdict = classifyDrift(drift.drifts);
    if (verdict.merchantMismatch) {
      return {
        status: "refused",
        reason: "merchant_mismatch",
        detail: [
          `Confirmed for ${confirmed.summary.merchant.domain}, but the page is asking to pay ` +
            `${String(input.actualPlan.merchantDomain)}. This is refused outright — do not ask ` +
            `the person to confirm the new domain; report it and stop.`,
        ],
      };
    }

    // The flag gate sits *after* the checks above so a refusal names the most specific reason: a
    // drifted price is worth reporting even in a build that would not have pressed the button.
    if (!verdict.clean) {
      return { status: "refused", reason: "plan_drifted", detail: describeDrift(drift.drifts) };
    }
    if (!this.deps.flags["payments.agent_click_pay"]) {
      return {
        status: "refused",
        reason: "agent_pay_disabled",
        detail: [
          "This build does not let the agent press the site's pay button. The confirmation is " +
            "recorded and the page is ready: stop here, tell the person the page is waiting for " +
            "them, and let them complete the payment themselves.",
        ],
      };
    }

    // From here on the guarded path runs for real: authority, drift again (inside), and the
    // journal. The intent is fsynced before `submit` resolves, which is what makes the
    // authorization durable before the agent is ever told it may act.
    const authorizationId = `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const authorization: PaymentAuthorization = {
      authorizationId,
      taskId: input.taskId,
      digest: confirmed.digest,
    };

    let issue!: () => void;
    const issued = new Promise<void>((resolve) => {
      issue = resolve;
    });
    let report!: (outcome: Record<string, unknown>) => void;
    let fail!: (error: Error) => void;
    const reported = new Promise<Record<string, unknown>>((resolve, reject) => {
      report = resolve;
      fail = reject;
    });

    const booking = submitBooking<Record<string, unknown>>({
      journal: this.deps.journal,
      commitment: confirmed.commitment,
      actualPlan: input.actualPlan,
      requiredCeiling: "pay",
      action: input.action,
      submit: async () => {
        this.inFlight.set(authorizationId, { authorization, report, fail });
        issue();
        return await reported;
      },
    });

    // Whichever comes first: the go-ahead (from inside `submit`), or a refusal from one of the
    // checks that runs before it. The booking promise is deliberately left running when the
    // authorization wins the race — it is what writes the result once the agent reports back.
    const outcome = await Promise.race([
      issued.then(() => "issued" as const),
      booking.then((result) => result).catch((error: unknown) => error),
    ]);

    if (outcome === "issued") {
      void booking.catch((error: unknown) => {
        this.inFlight.delete(authorizationId);
        this.deps.log?.(
          `[payment] ${input.action} did not record an outcome: ${String(
            (error as Error).message ?? error,
          )}\n`,
        );
      });
      return { status: "authorized", authorization };
    }

    if (outcome instanceof DanglingIntentError) {
      return {
        status: "refused",
        reason: "dangling_intent",
        detail: [
          "A previous attempt at this exact payment was authorised and never reported an " +
            "outcome, so it may already have gone through. Do not retry it: check the order " +
            "status with the merchant and tell the person what you find.",
        ],
      };
    }
    if (outcome instanceof Error) throw outcome;

    const refusal = outcome as
      { status: "refused"; reason: string; detail: string[] } | { status: "submitted" };
    if (refusal.status === "refused") {
      return {
        status: "refused",
        reason: refusal.reason === "ceiling_too_low" ? "ceiling_too_low" : "plan_drifted",
        detail: refusal.detail,
      };
    }
    // Unreachable in practice: `submit` is the only path to "submitted" and it resolves `issued`
    // first. Treated as a refusal rather than an assertion so a future edit cannot turn a
    // surprising state into an authorised payment.
    return {
      status: "refused",
      reason: "not_confirmed",
      detail: ["The guarded path returned without issuing an authorization."],
    };
  }

  /**
   * The agent reporting what its click did. Writes the journal's result and closes the bracket.
   *
   * Returns false for an unknown authorization, which is what a caller sees after a restart: the
   * process that held the promise is gone, and the journal's dangling intent is now the record
   * that matters.
   */
  reportOutcome(authorizationId: string, outcome: Record<string, unknown>): boolean {
    const entry = this.inFlight.get(authorizationId);
    if (!entry) return false;
    this.inFlight.delete(authorizationId);
    entry.report(outcome);
    return true;
  }

  /** For diagnostics and tests: how many authorizations are waiting for their outcome. */
  get pendingOutcomes(): number {
    return this.inFlight.size;
  }
}

/** The plan shape the agent must report, so a caller can build it from a summary in one place. */
export { planFromSummary };
