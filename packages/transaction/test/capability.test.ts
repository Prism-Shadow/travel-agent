/**
 * The one-shot permission to spend money, and every way it fails to authorise one.
 *
 * This is design/003 §12's P4 matrix as executable rows: expiry, replay, a domain that moved, an
 * amount over the ceiling, a rise nobody approved. Each row is written from the attacker's or the
 * accident's side — what would have to be true for the wrong payment to go through — because a
 * capability that only passes its happy path is a data structure, not a control.
 */
import { describe, expect, it } from "vitest";

import {
  capabilityIdempotencyKey,
  checkPaymentCapability,
  commitmentFromConfirmation,
  consumePaymentCapability,
  isOpaqueMethodRef,
  issuePaymentCapability,
  paymentSummaryDigest,
  planFromSummary,
  type PaymentCapability,
  type PaymentSummary,
} from "../src/index.js";

const TASK = "task-1755000000000-aaaa1111";
const NOW = new Date("2026-08-16T10:00:00.000Z");
const LATER = new Date("2026-08-16T10:05:00.000Z");
const AFTER_EXPIRY = new Date("2026-08-16T10:20:00.000Z");

function summaryOf(overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    merchant: { name: "携程", domain: "ctrip.com" },
    item: "MU5137 2026-09-02 经济舱 1 成人",
    amount: { value: 1280, currency: "CNY" },
    cancellation: { summary: "起飞前 24 小时可退，收 200 元手续费" },
    paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
    expiresAt: "2026-08-16T10:10:00.000Z",
    taskId: TASK,
    ...overrides,
  };
}

function issue(input: {
  summary?: PaymentSummary;
  tolerance?: number;
  approvedVia?: "card" | "natural_language";
  confirmingMessageId?: string;
  methodRef?: string;
}): PaymentCapability {
  const summary = input.summary ?? summaryOf();
  const approvedTolerance = input.tolerance ? { amountIncrease: input.tolerance } : undefined;
  return issuePaymentCapability(
    {
      summary,
      commitment: commitmentFromConfirmation({
        summary,
        ...(approvedTolerance ? { approvedTolerance } : {}),
        channel: "card",
        approvedAt: NOW.toISOString(),
      }),
      paymentMethodRef: input.methodRef ?? "pv:grant-7c1f:payment_token",
      approvedVia: input.approvedVia ?? "card",
      ...(input.confirmingMessageId ? { confirmingMessageId: input.confirmingMessageId } : {}),
      ...(approvedTolerance ? { approvedTolerance } : {}),
      auditRef: "audit-42",
    },
    { now: () => NOW, capabilityId: "cap-test-1" },
  );
}

/** The page, read at the payment step, in `planFromSummary`'s shape. */
function pageShowing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...planFromSummary(summaryOf()), ...overrides };
}

describe("what a capability is bound to", () => {
  it("anchors itself to the summary that was displayed", () => {
    // Not a boolean floating free of its subject: the digest is recomputed from the summary here,
    // so a capability cannot exist for a purchase nobody saw.
    const summary = summaryOf();
    const capability = issue({ summary });
    expect(capability.commitmentDigest).toBe(paymentSummaryDigest(summary));
    expect(capability.merchantDomain).toBe("ctrip.com");
    expect(capability.taskId).toBe(TASK);
  });

  it("carries a reference to the payment method, never anything that could charge it", () => {
    expect(isOpaqueMethodRef("pv:grant-7c1f:payment_token")).toBe(true);
    expect(isOpaqueMethodRef("wallet:Apple Pay")).toBe(true);
    // An alias is written by a person, so it is a name in whatever script they use.
    expect(isOpaqueMethodRef("merchant_saved:常用信用卡")).toBe(true);
    expect(isOpaqueMethodRef("merchant_saved:main card")).toBe(true);
    // …but a card number is one whatever prefix is put in front of it.
    expect(isOpaqueMethodRef("merchant_saved:4242 4242 4242 4242")).toBe(false);
    // A merchant token may itself be able to charge the card (003 §9.2), and a PAN certainly can.
    expect(isOpaqueMethodRef("tok_1P4kJ2abcdef")).toBe(false);
    expect(isOpaqueMethodRef("4242424242424242")).toBe(false);
    expect(() => issue({ methodRef: "4242 4242 4242 4242" })).toThrow(/never a\s*token/i);
    expect(() => issue({ methodRef: "pm_1234567890" })).toThrow(/opaque reference/);
  });

  it("keeps no payment credential anywhere in its serialised form", () => {
    // The object crosses a broker call, an audit record and a refusal message.
    const serialised = JSON.stringify(issue({}));
    expect(serialised).not.toMatch(/4242424242424242|tok_|cvv/i);
    expect(serialised).toContain("pv:grant-7c1f:payment_token");
  });

  it("refuses a spoken confirmation that cannot say which message confirmed it", () => {
    expect(() => issue({ approvedVia: "natural_language" })).toThrow(
      /which message|id of the message/i,
    );
    const spoken = issue({ approvedVia: "natural_language", confirmingMessageId: "msg-91" });
    expect(spoken.confirmingMessageId).toBe("msg-91");
  });

  it("refuses to be issued already expired", () => {
    expect(() =>
      issuePaymentCapability(
        {
          summary: summaryOf({ expiresAt: "2026-08-16T09:59:00.000Z" }),
          commitment: commitmentFromConfirmation({
            summary: summaryOf({ expiresAt: "2026-08-16T09:59:00.000Z" }),
            channel: "card",
          }),
          paymentMethodRef: "wallet:Apple Pay",
          approvedVia: "card",
          auditRef: "audit-1",
        },
        { now: () => NOW },
      ),
    ).toThrow(/already expired/);
  });

  it("refuses slack the card did not offer, even when the commitment carries it", () => {
    // The commitment is built by the same layer, so a mismatch here means the two disagree about
    // what the person agreed to — and the safe reading of that is always the smaller one.
    const summary = summaryOf();
    expect(() =>
      issuePaymentCapability(
        {
          summary,
          commitment: commitmentFromConfirmation({
            summary,
            approvedTolerance: { amountIncrease: 100 },
            channel: "card",
          }),
          paymentMethodRef: "wallet:Apple Pay",
          approvedVia: "card",
          auditRef: "audit-1",
        },
        { now: () => NOW },
      ),
    ).toThrow(/unapproved tolerance is zero/);
  });
});

describe("the ceiling", () => {
  it("is the exact amount when no slack was approved", () => {
    const capability = issue({});
    expect(capability.maxAmount).toEqual({ value: 1280, currency: "CNY" });
    expect(capability.toleranceApproved).toBe(false);
  });

  it("folds approved slack in once, and rounds to the cent", () => {
    const capability = issue({ tolerance: 50.1 });
    expect(capability.maxAmount.value).toBe(1330.1);
    expect(capability.toleranceApproved).toBe(true);
  });
});

describe("the journal key", () => {
  it("names the purchase, not the capability", () => {
    // Two capabilities for the same displayed summary in the same turn are the *same payment* — a
    // reissue after a lapse must not be able to pay a second time.
    const first = issue({});
    const second = issuePaymentCapability(
      {
        summary: summaryOf(),
        commitment: commitmentFromConfirmation({ summary: summaryOf(), channel: "card" }),
        paymentMethodRef: "wallet:Apple Pay",
        approvedVia: "card",
        auditRef: "audit-99",
      },
      { now: () => NOW, capabilityId: "cap-test-2" },
    );
    expect(second.capabilityId).not.toBe(first.capabilityId);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("changes when the purchase changes, so a re-confirmation is a new payment", () => {
    const dearer = summaryOf({ amount: { value: 1340, currency: "CNY" } });
    expect(issue({ summary: dearer }).idempotencyKey).not.toBe(issue({}).idempotencyKey);
    expect(capabilityIdempotencyKey({ taskId: TASK, commitmentDigest: "d".repeat(32) })).not.toBe(
      capabilityIdempotencyKey({ taskId: "task-other", commitmentDigest: "d".repeat(32) }),
    );
  });
});

describe("the checks a payment must pass", () => {
  const ok = { taskId: TASK, actualPlan: pageShowing(), now: LATER };

  it("passes when the page still shows what was confirmed", () => {
    expect(checkPaymentCapability({ capability: issue({}), ...ok })).toEqual({ ok: true });
  });

  it("refuses a capability from another turn", () => {
    const verdict = checkPaymentCapability({ capability: issue({}), ...ok, taskId: "task-other" });
    expect(verdict).toMatchObject({ ok: false, reason: "capability_invalid" });
  });

  it("refuses one that has already been spent, and says not to pay again", () => {
    const spent = consumePaymentCapability(issue({}), LATER);
    const verdict = checkPaymentCapability({ capability: spent, ...ok });
    expect(verdict).toMatchObject({ ok: false, reason: "capability_used" });
    expect((verdict as { detail: string[] }).detail.join(" ")).toMatch(/do not pay again/i);
  });

  it("refuses one whose window has closed", () => {
    const verdict = checkPaymentCapability({ capability: issue({}), ...ok, now: AFTER_EXPIRY });
    expect(verdict).toMatchObject({ ok: false, reason: "capability_expired" });
  });

  it("refuses a payment page on another domain, with no way to re-confirm", () => {
    // 003 §8.3: this is the shape of a redirect hijack. The refusal deliberately offers nothing.
    const verdict = checkPaymentCapability({
      capability: issue({}),
      ...ok,
      actualPlan: pageShowing({ merchantDomain: "ctrip-pay.example.com" }),
    });
    expect(verdict).toMatchObject({ ok: false, reason: "merchant_mismatch" });
    expect((verdict as { detail: string[] }).detail.join(" ")).toMatch(/refused outright/i);
    // The verdict carries a refusal and nothing else: there is no field a caller could read as
    // "…but you may offer to confirm the new domain".
    expect(Object.keys(verdict)).toEqual(["ok", "reason", "detail"]);
  });

  it("refuses a rise over an approved ceiling as a ceiling breach, not as missing slack", () => {
    // Both rows of 003 §8.3 exist and they mean different things: with slack approved the ceiling
    // already includes it, so exceeding it is not something more slack could fix.
    const verdict = checkPaymentCapability({
      capability: issue({ tolerance: 50 }),
      ...ok,
      actualPlan: pageShowing({ amount: 1331 }),
    });
    expect(verdict).toMatchObject({ ok: false, reason: "amount_over_max" });
  });

  it("refuses a page that does not say whose it is", () => {
    const verdict = checkPaymentCapability({
      capability: issue({}),
      ...ok,
      actualPlan: { ...pageShowing(), merchantDomain: "" },
    });
    expect(verdict).toMatchObject({ ok: false, reason: "merchant_mismatch" });
  });

  it("matches the domain case-insensitively", () => {
    expect(
      checkPaymentCapability({
        capability: issue({}),
        ...ok,
        actualPlan: pageShowing({ merchantDomain: "CTrip.com" }),
      }),
    ).toEqual({ ok: true });
  });

  it("refuses an amount over the ceiling without looking at tolerance", () => {
    const verdict = checkPaymentCapability({
      capability: issue({ tolerance: 50 }),
      ...ok,
      actualPlan: pageShowing({ amount: 1400 }),
    });
    expect(verdict).toMatchObject({ ok: false, reason: "amount_over_max" });
  });

  it("passes a rise that stays inside slack the person approved", () => {
    expect(
      checkPaymentCapability({
        capability: issue({ tolerance: 50 }),
        ...ok,
        actualPlan: pageShowing({ amount: 1320 }),
      }),
    ).toEqual({ ok: true });
  });

  it("refuses any rise when no slack was approved — the default path", () => {
    const verdict = checkPaymentCapability({
      capability: issue({}),
      ...ok,
      actualPlan: pageShowing({ amount: 1281 }),
    });
    expect(verdict).toMatchObject({ ok: false, reason: "tolerance_not_approved" });
  });

  it("lets the price fall", () => {
    expect(
      checkPaymentCapability({
        capability: issue({}),
        ...ok,
        actualPlan: pageShowing({ amount: 1180 }),
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a page charging in a different currency", () => {
    // A converted amount is a different purchase, and comparing the two numbers would be
    // comparing nothing.
    const verdict = checkPaymentCapability({
      capability: issue({}),
      ...ok,
      actualPlan: pageShowing({ currency: "USD", amount: 180 }),
    });
    expect(verdict).toMatchObject({ ok: false, reason: "capability_invalid" });
  });

  it("refuses a page that does not say what it is about to charge", () => {
    const verdict = checkPaymentCapability({
      capability: issue({}),
      ...ok,
      actualPlan: { ...pageShowing(), amount: undefined },
    });
    expect(verdict).toMatchObject({ ok: false, reason: "capability_invalid" });
  });

  it("refuses a capability whose commitment is not the one being executed", () => {
    const other = commitmentFromConfirmation({
      summary: summaryOf({ item: "CA1234 2026-09-02 经济舱 1 成人" }),
      channel: "card",
    });
    const verdict = checkPaymentCapability({ capability: issue({}), ...ok, commitment: other });
    expect(verdict).toMatchObject({ ok: false, reason: "capability_invalid" });
  });

  it("accepts the capability's own commitment, whenever it was recorded", () => {
    // `approvedAt` and `channel` say when and where consent was given, not what it was for; a
    // reissue seconds later must still match.
    const capability = issue({});
    const restated = commitmentFromConfirmation({
      summary: summaryOf(),
      channel: "natural_language",
      approvedAt: LATER.toISOString(),
    });
    expect(checkPaymentCapability({ capability, ...ok, commitment: restated })).toEqual({
      ok: true,
    });
  });

  it("refuses a hand-built capability that is not a readable authorisation", () => {
    const forged = {
      ...issue({}),
      commitmentDigest: "",
      paymentMethodRef: "4242424242424242",
    } as PaymentCapability;
    const verdict = checkPaymentCapability({ capability: forged, ...ok });
    expect(verdict).toMatchObject({ ok: false, reason: "capability_invalid" });
    expect((verdict as { detail: string[] }).detail.join(" ")).toMatch(/displayed summary/);
  });
});
