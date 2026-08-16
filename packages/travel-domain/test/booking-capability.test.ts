/**
 * The fifth check: a purchase may only be paid for with a permission somebody actually issued.
 *
 * design/003 §10.2 puts the capability gate *before* the four checks that were already here, and
 * §10.3 takes the execution itself away from the agent. What that means in practice is tested from
 * the outside in: for every way a permission can fail to authorise this payment, `submit` must not
 * run — and for the one case where a payment is interrupted, it must run exactly once across the
 * restart, never twice.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitmentFromConfirmation,
  consumePaymentCapability,
  issuePaymentCapability,
  openJournal,
  planFromSummary,
  type Journal,
  type PaymentCapability,
  type PaymentSummary,
} from "@travel-agent/transaction";
import { submitBooking } from "../src/index.js";

const TASK = "task-1755000000000-aaaa1111";
const ISSUED_AT = new Date("2026-08-16T10:00:00.000Z");
const PAYING_AT = new Date("2026-08-16T10:05:00.000Z");

let root: string;
let journal: Journal;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "booking-cap-"));
  journal = await openJournal(path.join(root, "journal.jsonl"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function summaryOf(overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    merchant: { name: "携程", domain: "ctrip.com" },
    item: "MU5137 2026-09-02 经济舱 1 成人",
    amount: { value: 1280, currency: "CNY" },
    cancellation: { summary: "起飞前 24 小时可退" },
    paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
    expiresAt: "2026-08-16T10:10:00.000Z",
    taskId: TASK,
    ...overrides,
  };
}

function confirmed(input: { summary?: PaymentSummary; tolerance?: number } = {}) {
  const summary = input.summary ?? summaryOf();
  const approvedTolerance = input.tolerance ? { amountIncrease: input.tolerance } : undefined;
  const commitment = commitmentFromConfirmation({
    summary,
    ...(approvedTolerance ? { approvedTolerance } : {}),
    channel: "card",
    approvedAt: ISSUED_AT.toISOString(),
  });
  const capability = issuePaymentCapability(
    {
      summary,
      commitment,
      paymentMethodRef: "pv:grant-7c1f:payment_token",
      approvedVia: "card",
      ...(approvedTolerance ? { approvedTolerance } : {}),
      auditRef: "audit-1",
    },
    { now: () => ISSUED_AT, capabilityId: "cap-1" },
  );
  return { summary, commitment, capability };
}

/** A payment attempt through the guarded path, with the page saying whatever the test says. */
async function pay(input: {
  capability?: PaymentCapability;
  commitment?: ReturnType<typeof confirmed>["commitment"];
  page?: Record<string, unknown>;
  submit: () => Promise<unknown>;
  requireCapability?: boolean;
  taskId?: string | null;
  now?: Date;
  journal?: Journal;
}) {
  const base = confirmed();
  return submitBooking({
    journal: input.journal ?? journal,
    commitment: input.commitment ?? base.commitment,
    actualPlan: input.page ?? planFromSummary(summaryOf()),
    requiredCeiling: "pay",
    action: "ctrip.payFlightOrder",
    submit: input.submit,
    ...(input.capability ? { capability: input.capability } : {}),
    ...(input.taskId === null ? {} : { taskId: input.taskId ?? TASK }),
    ...(input.requireCapability ? { requireCapability: true } : {}),
    now: input.now ?? PAYING_AT,
  });
}

describe("the capability gate", () => {
  it("pays once when the permission, the plan and the page all agree", async () => {
    const { capability } = confirmed();
    const submit = vi.fn(async () => ({ orderId: "E123456" }));
    const result = await pay({ capability, submit, requireCapability: true });
    expect(result).toMatchObject({ status: "submitted", outcome: { orderId: "E123456" } });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("refuses a payment with no permission at all, and journals nothing", async () => {
    // 003 §10.3: there is no way to authorise a payment from inside the agent's own run.
    const submit = vi.fn(async () => "should not run");
    const result = await pay({ submit, requireCapability: true });
    expect(result).toMatchObject({ status: "refused", reason: "capability_missing" });
    expect(submit).not.toHaveBeenCalled();
    expect(journal.inspect()).toEqual([]);
  });

  it("still books an order that needs no payment credential", async () => {
    // Pay-at-the-counter is the residual case 003 §10.3 names: the same guarded path, no money
    // moving through us, so no permission to demand.
    const submit = vi.fn(async () => ({ orderId: "ORD-9" }));
    const result = await pay({ submit });
    expect(result).toMatchObject({ status: "submitted" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("refuses a permission issued for another turn", async () => {
    const { capability } = confirmed();
    const submit = vi.fn(async () => "no");
    const result = await pay({ capability, submit, taskId: "task-1755000000001-bbbb2222" });
    expect(result).toMatchObject({ status: "refused", reason: "capability_invalid" });
    expect(submit).not.toHaveBeenCalled();
    expect(journal.inspect()).toEqual([]);
  });

  it("refuses a permission handed over without saying who is spending it", async () => {
    const { capability } = confirmed();
    const submit = vi.fn(async () => "no");
    const result = await pay({ capability, submit, taskId: null });
    expect(result).toMatchObject({ status: "refused", reason: "capability_invalid" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses an expired permission rather than paying on a stale confirmation", async () => {
    const { capability } = confirmed();
    const submit = vi.fn(async () => "no");
    const result = await pay({
      capability,
      submit,
      now: new Date("2026-08-16T10:30:00.000Z"),
    });
    expect(result).toMatchObject({ status: "refused", reason: "capability_expired" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a permission that was already spent", async () => {
    const { capability } = confirmed();
    const submit = vi.fn(async () => "no");
    const result = await pay({
      capability: consumePaymentCapability(capability, PAYING_AT),
      submit,
    });
    expect(result).toMatchObject({ status: "refused", reason: "capability_used" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses outright when the payment page has moved domain", async () => {
    // Checked before the page's contents are given any weight — and with no re-confirmation path.
    const { capability } = confirmed();
    const submit = vi.fn(async () => "no");
    const result = await pay({
      capability,
      submit,
      page: { ...planFromSummary(summaryOf()), merchantDomain: "ctrip-secure-pay.example.com" },
    });
    expect(result).toMatchObject({ status: "refused", reason: "merchant_mismatch" });
    expect(submit).not.toHaveBeenCalled();
    expect(journal.inspect()).toEqual([]);
  });

  it("refuses a rise nobody approved, even when a drift confirmation is on offer", async () => {
    // The capability gate runs before drift, so the "ask them about it" path is never reached:
    // 003 §8.5 makes the exact amount the ceiling, and raising it is a new confirmation.
    const { capability } = confirmed();
    const submit = vi.fn(async () => "no");
    const confirmDrift = vi.fn(async () => true);
    const result = await submitBooking({
      journal,
      commitment: capability.commitment,
      actualPlan: { ...planFromSummary(summaryOf()), amount: 1340 },
      requiredCeiling: "pay",
      action: "ctrip.payFlightOrder",
      submit,
      capability,
      taskId: TASK,
      confirmDrift,
      now: PAYING_AT,
    });
    expect(result).toMatchObject({ status: "refused", reason: "tolerance_not_approved" });
    expect(confirmDrift).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("pays a rise that stays within slack the person ticked", async () => {
    const { capability, commitment } = confirmed({ tolerance: 100 });
    const submit = vi.fn(async () => ({ orderId: "E7" }));
    const result = await pay({
      capability,
      commitment,
      submit,
      page: { ...planFromSummary(summaryOf()), amount: 1330 },
    });
    expect(result).toMatchObject({ status: "submitted" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("refuses a rise past the ceiling that slack was already folded into", async () => {
    const { capability, commitment } = confirmed({ tolerance: 100 });
    const submit = vi.fn(async () => "no");
    const result = await pay({
      capability,
      commitment,
      submit,
      page: { ...planFromSummary(summaryOf()), amount: 1500 },
    });
    expect(result).toMatchObject({ status: "refused", reason: "amount_over_max" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses when the permission authorises a different plan than the one being executed", async () => {
    const { capability } = confirmed();
    const otherCommitment = commitmentFromConfirmation({
      summary: summaryOf({ item: "CA1234 2026-09-02 经济舱 1 成人" }),
      channel: "card",
    });
    const submit = vi.fn(async () => "no");
    const result = await pay({ capability, commitment: otherCommitment, submit });
    expect(result).toMatchObject({ status: "refused", reason: "capability_invalid" });
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("paying at most once, across a restart", () => {
  it("returns the recorded outcome instead of paying again", async () => {
    const { capability } = confirmed();
    const submit = vi.fn(async () => ({ orderId: "E123456" }));
    await pay({ capability, submit });

    // A second life of the process, same journal file.
    const reopened = await openJournal(journal.filePath);
    const again = vi.fn(async () => ({ orderId: "SHOULD-NOT-HAPPEN" }));
    const result = await pay({ capability, submit: again, journal: reopened });

    expect(result).toMatchObject({ status: "submitted", outcome: { orderId: "E123456" } });
    expect(again).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("will not let a reissued permission pay for the same purchase twice", async () => {
    // The journal key names the *purchase* — the turn and the digest of what was displayed — so a
    // second permission for the same summary lands on the first one's entry.
    const first = confirmed();
    const submit = vi.fn(async () => ({ orderId: "E123456" }));
    await pay({ capability: first.capability, submit });

    const reissued = issuePaymentCapability(
      {
        summary: first.summary,
        commitment: first.commitment,
        paymentMethodRef: "wallet:Apple Pay",
        approvedVia: "card",
        auditRef: "audit-2",
      },
      { now: () => PAYING_AT, capabilityId: "cap-2" },
    );
    const again = vi.fn(async () => ({ orderId: "DOUBLE-CHARGE" }));
    const result = await pay({ capability: reissued, submit: again });

    expect(result).toMatchObject({ status: "submitted", outcome: { orderId: "E123456" } });
    expect(again).not.toHaveBeenCalled();
  });

  it("treats a payment killed mid-flight as dangling: one side effect, and no retry", async () => {
    // The SIGKILL row of 003 §12's P4 matrix, without a real signal: the intent is fsynced before
    // the action runs, so a process that dies inside `submit` leaves exactly that on disk. The
    // count that matters is the number of times the outside world was touched — one.
    const { capability } = confirmed();
    let sideEffects = 0;
    const killed = vi.fn(async () => {
      sideEffects += 1;
      throw new Error("SIGKILL");
    });
    await expect(pay({ capability, submit: killed })).rejects.toThrow("SIGKILL");
    expect(sideEffects).toBe(1);

    const reopened = await openJournal(journal.filePath);
    expect(reopened.danglingIntents()).toHaveLength(1);

    // No reconcile function: the next attempt refuses rather than repeating the payment.
    const retry = vi.fn(async () => {
      sideEffects += 1;
      return { orderId: "DOUBLE-CHARGE" };
    });
    await expect(pay({ capability, submit: retry, journal: reopened })).rejects.toThrow(
      /DanglingIntent|do not retry/i,
    );
    expect(retry).not.toHaveBeenCalled();
    expect(sideEffects).toBe(1);

    // With one, the answer comes from the merchant and is recorded as the outcome.
    const settled = await submitBooking({
      journal: reopened,
      commitment: capability.commitment,
      actualPlan: planFromSummary(summaryOf()),
      requiredCeiling: "pay",
      action: "ctrip.payFlightOrder",
      capability,
      taskId: TASK,
      now: PAYING_AT,
      submit: async () => {
        sideEffects += 1;
        return { orderId: "DOUBLE-CHARGE" };
      },
      reconcile: async () => ({ orderId: "E123456", reconciled: true }),
    });
    expect(settled).toMatchObject({ status: "submitted", outcome: { orderId: "E123456" } });
    expect(sideEffects).toBe(1);
  });
});
