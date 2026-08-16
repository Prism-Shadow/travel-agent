/**
 * The payment guard (src/interaction/payment.ts) — the deterministic half of "did they agree to
 * this?".
 *
 * This is 003 §12's P4 matrix, run against what Phase 3 actually ships. Two properties are the
 * point of the whole file:
 *
 * - **Nothing is authorised that was not confirmed, unchanged, and still valid.** Every refusal
 *   below is a specific way a purchase can stop being the one the person saw.
 * - **A payment that was cleared and never reported is never retried.** The journal's dangling
 *   intent survives the process, and the next attempt is refused with "go and check", which is the
 *   only answer that cannot charge somebody twice.
 *
 * The default build refuses everything at the last gate (`payments.agent_click_pay` is off, and its
 * dependencies are unreachable in this phase), so the tests that exercise the guarded path turn it
 * on explicitly. That is the honest shape: the decision is computed and tested; pressing the button
 * is Phase 4's.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openJournal, planFromSummary, type PaymentSummary } from "@travel-agent/transaction";
import { SessionPaymentGuard } from "../src/interaction/payment.js";
import type { FeatureFlagsShape } from "../src/interaction/transaction-imports.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await fs.rm(dirs.pop()!, { recursive: true, force: true });
});

async function journalPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pay-guard-"));
  dirs.push(dir);
  return path.join(dir, "payments.jsonl");
}

const flags = (clickPay: boolean): FeatureFlagsShape => ({
  "payments.agent_click_pay": clickPay,
  "secret_entry.contract": false,
  "secret_entry.live": false,
});

const TASK = "task-1755000000000-aaaa1111";

function summary(overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    merchant: { name: "携程", domain: "ctrip.com" },
    item: "MU5137 2026-09-02 经济舱",
    amount: { value: 1280, currency: "CNY" },
    cancellation: { summary: "起飞前 24 小时可退" },
    paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    taskId: TASK,
    ...overrides,
  };
}

async function guardWith(options: { clickPay?: boolean; file?: string } = {}) {
  const file = options.file ?? (await journalPath());
  const guard = new SessionPaymentGuard({
    journal: await openJournal(file),
    flags: flags(options.clickPay ?? false),
  });
  return { guard, file };
}

describe("before anything can be paid", () => {
  it("refuses when nobody confirmed", async () => {
    const { guard } = await guardWith({ clickPay: true });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "not_confirmed" });
  });

  it("refuses a confirmation that has expired", async () => {
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({
      taskId: TASK,
      summary: summary({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      channel: "card",
    });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "confirmation_expired" });
  });

  it("refuses a confirmation from another turn", async () => {
    // Consent belongs to the turn it was given in. A later turn asking about the same purchase is
    // a different question, and the person has not answered it.
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await guard.authorize({
      taskId: "task-1755000000001-bbbb2222",
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "not_confirmed" });
  });

  it("forgets the confirmation when the turn ends", async () => {
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    expect(guard.confirmationFor(TASK)).not.toBeNull();
    guard.forget(TASK);
    expect(guard.confirmationFor(TASK)).toBeNull();
  });
});

describe("what counts as the same purchase", () => {
  it("refuses a different merchant outright, with no way to re-confirm", async () => {
    // 003 §8.3. Everything else on this page may be identical; a payment form that moved to
    // another domain is the shape of a hijack, and offering "confirm the new one?" is the trap.
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: { ...planFromSummary(summary()), merchantDomain: "ctr1p-secure-pay.com" },
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "merchant_mismatch" });
    expect((decision as { detail: string[] }).detail.join(" ")).toMatch(/do not ask/i);
  });

  it("refuses any price rise when no slack was approved", async () => {
    // The default of 003 §8.5: the exact amount is the hard ceiling. One yuan is drift.
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary({ amount: { value: 1281, currency: "CNY" } })),
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "plan_drifted" });
  });

  it("allows a rise inside slack the person actually chose", async () => {
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({
      taskId: TASK,
      summary: summary(),
      approvedTolerance: { amountIncrease: 50 },
      channel: "card",
    });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary({ amount: { value: 1320, currency: "CNY" } })),
      action: "ctrip.pay",
    });
    expect(decision.status).toBe("authorized");
  });

  it("refuses a rise past that slack", async () => {
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({
      taskId: TASK,
      summary: summary(),
      approvedTolerance: { amountIncrease: 50 },
      channel: "card",
    });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary({ amount: { value: 1400, currency: "CNY" } })),
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "plan_drifted" });
  });

  it("refuses a fee that was not on the card", async () => {
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: { ...planFromSummary(summary()), seatFee: 60 },
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "plan_drifted" });
    expect((decision as { detail: string[] }).detail.join(" ")).toContain("seatFee");
  });

  it("refuses cancellation terms that changed", async () => {
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary({ cancellation: { summary: "不可退改" } })),
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "plan_drifted" });
  });
});

describe("the shipped build", () => {
  it("refuses to press pay at all, and writes nothing to the journal", async () => {
    // The Phase 3 terminal state: the confirmation is recorded, the page is ready, and the person
    // completes the payment. Nothing is journalled because nothing was cleared — a write-ahead
    // record for an action that will not happen would be a lie in the one log that must not lie.
    const { guard, file } = await guardWith({ clickPay: false });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "agent_pay_disabled" });
    expect((decision as { detail: string[] }).detail.join(" ")).toMatch(/let them complete/i);
    await expect(fs.readFile(file, "utf8")).rejects.toThrow();
  });

  it("still reports the more specific reason when the purchase also drifted", async () => {
    // A drifted price is worth telling the person about even in a build that would not have
    // pressed the button; "payments are off" would hide it.
    const { guard } = await guardWith({ clickPay: false });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary({ amount: { value: 1999, currency: "CNY" } })),
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "plan_drifted" });
  });
});

describe("the write-ahead bracket", () => {
  it("records the intent before the agent is told it may act", async () => {
    const { guard, file } = await guardWith({ clickPay: true });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });

    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    expect(decision.status).toBe("authorized");

    // Durable already: the go-ahead does not leave this process before the intent is fsynced.
    const afterAuthorize = await fs.readFile(file, "utf8");
    expect(afterAuthorize).toContain('"kind":"intent"');
    expect(afterAuthorize).not.toContain('"kind":"result"');
    expect(guard.pendingOutcomes).toBe(1);
  });

  it("closes the bracket when the agent reports back", async () => {
    const { guard, file } = await guardWith({ clickPay: true });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    const { authorizationId } = (decision as { authorization: { authorizationId: string } })
      .authorization;

    expect(guard.reportOutcome(authorizationId, { orderId: "E123456" })).toBe(true);
    await expectEventually(async () => {
      expect(await fs.readFile(file, "utf8")).toContain('"kind":"result"');
    });
    expect(guard.pendingOutcomes).toBe(0);
  });

  it("refuses a second attempt while the first is still out", async () => {
    const { guard } = await guardWith({ clickPay: true });
    guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    const second = await guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    expect(second).toMatchObject({ status: "refused", reason: "in_flight" });
  });

  it("does not run the same payment twice once it has an outcome", async () => {
    // Replay semantics: a completed operation returns its recorded outcome and never executes
    // again, across process restarts. Here that means the second authorize needs no new
    // authorization at all — there is nothing left to do.
    const file = await journalPath();
    const first = await guardWith({ clickPay: true, file });
    first.guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await first.guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    first.guard.reportOutcome(
      (decision as { authorization: { authorizationId: string } }).authorization.authorizationId,
      { orderId: "E123456" },
    );
    await expectEventually(async () => {
      expect(await fs.readFile(file, "utf8")).toContain('"kind":"result"');
    });

    const restarted = await guardWith({ clickPay: true, file });
    restarted.guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const again = await restarted.guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    // Replayed, not re-run: no new authorization is issued and the journal grew no second intent.
    expect(again.status).toBe("refused");
    const contents = await fs.readFile(file, "utf8");
    expect(contents.split("\n").filter((line) => line.includes('"kind":"intent"'))).toHaveLength(1);
  });

  it("refuses to retry a payment that was cleared and never reported", async () => {
    // The SIGKILL case. An intent with no result means the click may have gone through, and the
    // only safe answer is to go and ask the merchant — never to press again.
    const file = await journalPath();
    const crashed = await guardWith({ clickPay: true, file });
    crashed.guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    await crashed.guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    // …and the process dies here, with the intent on disk and no result.

    const restarted = await guardWith({ clickPay: true, file });
    restarted.guard.confirm({ taskId: TASK, summary: summary(), channel: "card" });
    const decision = await restarted.guard.authorize({
      taskId: TASK,
      actualPlan: planFromSummary(summary()),
      action: "ctrip.pay",
    });
    expect(decision).toMatchObject({ status: "refused", reason: "dangling_intent" });
    expect((decision as { detail: string[] }).detail.join(" ")).toMatch(/do not retry/i);

    // And the side effect count stays at one: no second intent was written.
    const contents = await fs.readFile(file, "utf8");
    expect(contents.split("\n").filter((line) => line.includes('"kind":"intent"'))).toHaveLength(1);
  });
});

/** Retries a file assertion briefly: the result is fsynced asynchronously after the report. */
async function expectEventually(check: () => Promise<void>, attempts = 40): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await check();
      return;
    } catch (error) {
      if (index === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
