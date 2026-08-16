/**
 * Payment confirmation: the digest, the commitment, and the reading of a spoken "yes".
 *
 * The natural-language cases are the ones worth reading. They encode 003 §8.4, and the rule behind
 * every one of them is the same: a false negative costs one more card, a false positive spends
 * somebody's money on something they did not read. So the judge errs towards the card, and the
 * vague-agreement table below is a specification rather than a sample.
 */
import { describe, expect, it } from "vitest";

import { checkDrift } from "../src/commitment.js";
import type { PaymentSummary } from "../src/interaction.js";
import {
  classifyDrift,
  commitmentFromConfirmation,
  describePaymentSummary,
  judgeConfirmationReply,
  paymentSummaryDigest,
  planFromSummary,
} from "../src/payment.js";

function summary(overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    merchant: { name: "携程", domain: "ctrip.com" },
    item: "MU5137 2026-09-02 经济舱",
    amount: { value: 1280, currency: "CNY" },
    cancellation: { summary: "起飞前 24 小时可退，收 200 元手续费" },
    paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
    expiresAt: "2026-08-15T10:10:00.000Z",
    taskId: "task-1755000000000-aaaa1111",
    ...overrides,
  };
}

describe("the digest", () => {
  it("does not depend on key order", () => {
    const a = summary();
    const b: PaymentSummary = JSON.parse(
      JSON.stringify({
        taskId: a.taskId,
        expiresAt: a.expiresAt,
        paymentMethod: a.paymentMethod,
        cancellation: a.cancellation,
        amount: a.amount,
        item: a.item,
        merchant: a.merchant,
      }),
    ) as PaymentSummary;
    expect(paymentSummaryDigest(b)).toBe(paymentSummaryDigest(a));
  });

  it("changes when anything the person read changes", () => {
    const base = paymentSummaryDigest(summary());
    expect(paymentSummaryDigest(summary({ amount: { value: 1290, currency: "CNY" } }))).not.toBe(
      base,
    );
    expect(paymentSummaryDigest(summary({ cancellation: { summary: "不可退改" } }))).not.toBe(base);
  });
});

describe("the commitment a confirmation produces", () => {
  it("has no tolerance at all unless the person chose some", () => {
    // 003 §8.5: the exact amount is the hard ceiling by default. A price that moves by one yuan
    // goes back to the person, and that is the intended behaviour, not an oversight.
    const commitment = commitmentFromConfirmation({ summary: summary(), channel: "card" });
    expect(commitment.tolerance).toEqual({});
    expect(commitment.ceiling).toBe("pay");

    const drifted = checkDrift(
      commitment,
      planFromSummary(summary({ amount: { value: 1281, currency: "CNY" } })),
    );
    expect(drifted.withinCommitment).toBe(false);
  });

  it("uses the slack the person selected, and only upwards", () => {
    const commitment = commitmentFromConfirmation({
      summary: summary(),
      approvedTolerance: { amountIncrease: 50 },
      channel: "card",
    });
    expect(
      checkDrift(commitment, planFromSummary(summary({ amount: { value: 1320, currency: "CNY" } })))
        .withinCommitment,
    ).toBe(true);
    expect(
      checkDrift(commitment, planFromSummary(summary({ amount: { value: 1400, currency: "CNY" } })))
        .withinCommitment,
    ).toBe(false);
  });

  it("treats a currency change as drift rather than as a price move", () => {
    // 1280 CNY and 1280 USD are the same number. Keeping the currency as its own field is what
    // stops a tolerance meant for yuan from silently covering dollars.
    const commitment = commitmentFromConfirmation({
      summary: summary(),
      approvedTolerance: { amountIncrease: 1000 },
      channel: "card",
    });
    const drift = checkDrift(
      commitment,
      planFromSummary(summary({ amount: { value: 1280, currency: "USD" } })),
    );
    expect(drift.withinCommitment).toBe(false);
    expect(drift.drifts.map((d) => d.path)).toContain("currency");
  });

  it("catches a fee that was not on the card", () => {
    const commitment = commitmentFromConfirmation({ summary: summary(), channel: "card" });
    const actual = { ...planFromSummary(summary()), seatFee: 60 };
    const drift = checkDrift(commitment, actual);
    expect(drift.drifts.some((d) => d.reason === "added" && d.path === "seatFee")).toBe(true);
  });
});

describe("classifying drift", () => {
  it("marks a merchant change as the one with no way back", () => {
    // 003 §8.3: a payment page that moved to another domain is the shape of a hijack, and offering
    // "confirm the new one?" would be offering to walk into it.
    const commitment = commitmentFromConfirmation({ summary: summary(), channel: "card" });
    const drift = checkDrift(
      commitment,
      planFromSummary(summary({ merchant: { name: "携程", domain: "ctr1p-pay.com" } })),
    );
    const verdict = classifyDrift(drift.drifts);
    expect(verdict.merchantMismatch).toBe(true);
    expect(verdict.reconfirm).toEqual([]);
  });

  it("sends an ordinary price move back for re-confirmation", () => {
    const commitment = commitmentFromConfirmation({ summary: summary(), channel: "card" });
    const drift = checkDrift(
      commitment,
      planFromSummary(summary({ amount: { value: 1450, currency: "CNY" } })),
    );
    const verdict = classifyDrift(drift.drifts);
    expect(verdict.merchantMismatch).toBe(false);
    expect(verdict.reconfirm).toHaveLength(1);
  });
});

describe("reading a confirmation in words", () => {
  const shown = { summary: summary(), digestShown: true };

  it.each(["可以", "好", "好的", "就它吧", "付吧", "确认", "嗯", "OK", "yes", "go ahead"])(
    "falls back to the card for %s",
    (reply) => {
      const judged = judgeConfirmationReply({ ...shown, reply });
      expect(judged.confirmed).toBe(false);
    },
  );

  it("accepts a reply that refers to the summary and names its amount and merchant", () => {
    const judged = judgeConfirmationReply({
      ...shown,
      reply: "就上面这单，携程 1280 元，付吧",
    });
    expect(judged.confirmed).toBe(true);
  });

  it("refuses a reply that names an amount that is not the one shown", () => {
    // The most dangerous near-miss: it looks like a confirmation and confirms something else.
    const judged = judgeConfirmationReply({ ...shown, reply: "上面那单 1180 元，携程，付吧" });
    expect(judged.confirmed).toBe(false);
    expect(judged.missing).toContain("amount");
  });

  it("refuses a bare number with no currency", () => {
    const judged = judgeConfirmationReply({ ...shown, reply: "上面那单 1280，付吧" });
    expect(judged.confirmed).toBe(false);
  });

  it("reads a currency symbol as well as a code", () => {
    expect(
      judgeConfirmationReply({ ...shown, reply: "上面那单携程 ¥1280，确认支付" }).confirmed,
    ).toBe(true);
    expect(
      judgeConfirmationReply({ ...shown, reply: "confirm the ctrip one, CNY 1280" }).confirmed,
    ).toBe(true);
  });

  it("reads a thousands separator as the same number", () => {
    expect(judgeConfirmationReply({ ...shown, reply: "上面那单携程 1,280 元，付" }).confirmed).toBe(
      true,
    );
  });

  describe("with nothing shown beforehand", () => {
    const blind = { summary: summary(), digestShown: false };

    it("needs the whole purchase in the message", () => {
      const judged = judgeConfirmationReply({
        ...blind,
        reply: "用常用信用卡付携程的 MU5137 这张票，1280 元，退改条款我看过了，付吧",
      });
      expect(judged.confirmed).toBe(true);
    });

    it("refuses when the cancellation terms were never acknowledged", () => {
      const judged = judgeConfirmationReply({
        ...blind,
        reply: "用常用信用卡付携程 MU5137，1280 元",
      });
      expect(judged.confirmed).toBe(false);
      expect(judged.missing).toEqual(["cancellation"]);
    });

    it("refuses when the payment method is not named", () => {
      const judged = judgeConfirmationReply({
        ...blind,
        reply: "付携程 MU5137 这张票 1280 元，退改我看过了",
      });
      expect(judged.confirmed).toBe(false);
      expect(judged.missing).toContain("method");
    });

    it("names everything that was missing, so the card can say why it is back", () => {
      const judged = judgeConfirmationReply({ ...blind, reply: "帮我把这个订了" });
      expect(judged.missing.length).toBeGreaterThan(2);
      expect(judged.reason).toMatch(/whole purchase/i);
    });
  });
});

describe("the card's lines", () => {
  it("shows the domain next to the name, and never a token", () => {
    const lines = describePaymentSummary(summary());
    expect(lines.join("\n")).toContain("ctrip.com");
    expect(lines.join("\n")).toContain("••4242");
    expect(lines.join("\n")).not.toMatch(/tok_|token/);
  });
});
