/**
 * Where a payment is actually authorised and executed.
 *
 * This is the piece that takes the execution away from the agent. The agent can ask — it calls
 * `execute_payment` with a capability id and the plan it can see — but the capability, the
 * credential and the journal all live here, in the main process, and the five checks run here too.
 * On the paths that use a merchant token or a wallet, **the agent never holds anything that could
 * pay for something**, which is a structural property rather than a rule it is asked to follow.
 *
 * The order of operations is the part worth reading twice:
 *
 * ```
 * flags          is this build allowed to pay at all?      → payments_disabled
 * capability     one-shot permission, still valid, this turn, this domain, this price
 * credential     resolved from the vault *here*, never handed out
 * submitBooking  authority → drift → journal → the irreversible call
 * consume        mark used, record what happened
 * ```
 *
 * A refusal is a value at every step. The one thing that is *not* a value is a dangling intent: if
 * the process died between the journal's intent record and its result, `submitBooking` throws
 * `DanglingIntentError`, and this class deliberately does not swallow it. Retrying would be the
 * one action that can charge somebody twice.
 */
import {
  checkPaymentCapability,
  consumePaymentCapability,
  issuePaymentCapability,
  type ApprovedTolerance,
  type Commitment,
  type IssueCapabilityInput,
  type PaymentCapability,
  type PaymentSummary,
} from "@travel-agent/transaction";
import {
  submitBooking,
  type BookingResult,
  type Journal,
  type RefusalReason,
} from "@travel-agent/transaction";

import type { VaultAudit } from "./audit.js";
import { parseHandle } from "./grants.js";
import type { ProfileVault } from "./store.js";

export interface PaymentFlags {
  /** Off until the vault holds real L2 material on an isolated runtime. */
  "payments.execute": boolean;
}

/** What the outcome of a real payment looks like. Whatever the merchant path returns. */
export type PaymentOutcome = Record<string, unknown>;

/**
 * The thing that actually moves money, injected.
 *
 * A port rather than an implementation because the merchant side differs per site and per
 * credential type (a saved token, a wallet sheet, a hosted field), and because it is the one call
 * that must be impossible to reach by accident. `notConfiguredPaymentPort` is what this build
 * ships: `payments.execute` is off, so a configured port would be code nobody can run.
 */
export interface PaymentPort {
  pay(input: {
    capability: PaymentCapability;
    /** The credential, resolved from the vault. Present only for `pv:` references. */
    credential: string | null;
    actualPlan: Record<string, unknown>;
    action: string;
  }): Promise<PaymentOutcome>;
  /** Asks the merchant what happened, for a payment whose outcome was never recorded. */
  reconcile?(input: { capability: PaymentCapability; action: string }): Promise<PaymentOutcome>;
}

export function notConfiguredPaymentPort(): PaymentPort {
  return {
    async pay() {
      throw new Error(
        "This build has no payment executor wired: `payments.execute` is off, and the merchant " +
          "side of the payment is Phase 5 work. The agent stops at the payment page and the " +
          "person completes it.",
      );
    },
  };
}

export type ExecuteRefusal =
  RefusalReason | "payments_disabled" | "unknown_capability" | "credential_unavailable";

export type ExecuteResult =
  | { status: "paid"; outcome: PaymentOutcome; replayed: boolean; capabilityId: string }
  | { status: "refused"; reason: ExecuteRefusal; detail: string[] };

export interface PaymentAuthorityDeps {
  vault: ProfileVault;
  flags: PaymentFlags;
  /** The write-ahead journal for this conversation. One per session, as in Phase 3. */
  journalFor: (sessionId: string) => Promise<Journal>;
  port?: PaymentPort;
  audit?: VaultAudit | null;
  now?: () => Date;
}

export class PaymentAuthority {
  private readonly capabilities = new Map<string, PaymentCapability>();
  private readonly now: () => Date;

  constructor(private readonly deps: PaymentAuthorityDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Issues a capability from a confirmation the person actually saw.
   *
   * Called from the confirmation path, never from anything the agent can reach: the agent learns
   * the capability's **id**, and an id is not a permission — every check happens here, at spend
   * time, against the object this map holds.
   */
  async issue(
    input: Omit<IssueCapabilityInput, "auditRef"> & { sessionId: string },
  ): Promise<PaymentCapability> {
    const entry = await this.deps.audit?.append("capability_issued", {
      sessionId: input.sessionId,
      taskId: input.summary.taskId,
      domain: input.summary.merchant.domain,
      reason: input.approvedVia,
    });
    const capability = issuePaymentCapability(
      { ...input, auditRef: entry ? `audit:${entry.seq}` : "audit:none" },
      { now: this.now },
    );
    this.capabilities.set(capability.capabilityId, capability);
    return capability;
  }

  /** Convenience for the confirmation path: summary + commitment in, capability out. */
  async issueFromConfirmation(input: {
    sessionId: string;
    summary: PaymentSummary;
    commitment: Commitment;
    paymentMethodRef: string;
    approvedVia: "card" | "natural_language";
    confirmingMessageId?: string;
    approvedTolerance?: ApprovedTolerance;
  }): Promise<PaymentCapability> {
    return this.issue(input);
  }

  get(capabilityId: string): PaymentCapability | undefined {
    return this.capabilities.get(capabilityId);
  }

  /** Drops a turn's capabilities. Called when the turn ends, like every other consent. */
  forgetTask(taskId: string): number {
    let dropped = 0;
    for (const [id, capability] of this.capabilities) {
      if (capability.taskId !== taskId) continue;
      this.capabilities.delete(id);
      dropped += 1;
    }
    return dropped;
  }

  /**
   * Spends a capability, or refuses.
   *
   * `domain` is main's own view of the page, not the agent's claim about it — the caller reads it
   * from the browser pane. That is what makes the merchant check meaningful.
   */
  async execute(input: {
    capabilityId: string;
    taskId: string;
    sessionId: string;
    domain: string;
    action: string;
    actualPlan: Record<string, unknown>;
  }): Promise<ExecuteResult> {
    if (!this.deps.flags["payments.execute"]) {
      const detail = [
        "Paying from inside a turn is off in this build (payments.execute). The page is ready; " +
          "the person completes the payment themselves.",
      ];
      await this.refused(input, "payments_disabled", detail[0]!);
      return { status: "refused", reason: "payments_disabled", detail };
    }

    const capability = this.capabilities.get(input.capabilityId);
    if (!capability) {
      const detail = [
        `No capability ${input.capabilityId} is held for this run. A confirmation produces one, ` +
          `and it does not survive the turn it was issued in.`,
      ];
      await this.refused(input, "unknown_capability", detail[0]!);
      return { status: "refused", reason: "unknown_capability", detail };
    }

    // Checked here as well as inside `submitBooking`, because the domain main sees is the one that
    // matters and the booking path only knows what it is handed.
    const verdict = checkPaymentCapability({
      capability,
      taskId: input.taskId,
      actualPlan: { ...input.actualPlan, merchantDomain: input.domain },
      now: this.now(),
    });
    if (!verdict.ok) {
      await this.refused(input, verdict.reason, verdict.detail.join(" "));
      return { status: "refused", reason: verdict.reason, detail: verdict.detail };
    }

    let credential: string | null = null;
    const handle = parseHandle(capability.paymentMethodRef);
    if (handle) {
      if (!this.deps.vault.unlocked || !this.deps.vault.has(handle.field)) {
        const detail = [
          `The stored payment credential for this capability is not available (${handle.field}). ` +
            `Nothing was attempted.`,
        ];
        await this.refused(input, "credential_unavailable", detail[0]!);
        return { status: "refused", reason: "credential_unavailable", detail };
      }
      credential = await this.deps.vault.reveal(handle.field, {
        reason: "payment",
        grantId: handle.grantId,
      });
    }

    const port = this.deps.port ?? notConfiguredPaymentPort();
    const journal = await this.deps.journalFor(input.sessionId);
    let result: BookingResult<PaymentOutcome>;
    try {
      result = await submitBooking<PaymentOutcome>({
        journal,
        commitment: capability.commitment,
        actualPlan: input.actualPlan,
        requiredCeiling: "pay",
        action: input.action,
        capability,
        taskId: input.taskId,
        requireCapability: true,
        now: this.now(),
        submit: () =>
          port.pay({ capability, credential, actualPlan: input.actualPlan, action: input.action }),
        ...(port.reconcile
          ? { reconcile: () => port.reconcile!({ capability, action: input.action }) }
          : {}),
      });
    } finally {
      // The credential's life in this process ends with the call it was resolved for.
      credential = null;
    }

    if (result.status === "refused") {
      await this.refused(input, result.reason, result.detail.join(" "));
      return { status: "refused", reason: result.reason, detail: result.detail };
    }

    const spent = consumePaymentCapability(capability, this.now());
    this.capabilities.set(spent.capabilityId, spent);
    await this.deps.audit?.append("capability_consumed", {
      sessionId: input.sessionId,
      taskId: input.taskId,
      domain: input.domain,
      capabilityId: capability.capabilityId,
      outcome: result.replayed ? "replayed" : "paid",
    });
    return {
      status: "paid",
      outcome: result.outcome,
      replayed: result.replayed,
      capabilityId: capability.capabilityId,
    };
  }

  private async refused(
    input: { capabilityId: string; taskId: string; sessionId: string; domain: string },
    reason: string,
    detail: string,
  ): Promise<void> {
    await this.deps.audit?.append("capability_refused", {
      sessionId: input.sessionId,
      taskId: input.taskId,
      domain: input.domain,
      capabilityId: input.capabilityId,
      reason,
      outcome: detail.slice(0, 200),
    });
  }
}
