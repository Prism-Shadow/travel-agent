/**
 * The six interaction kinds, and the cards this module refuses to build.
 *
 * Every rejection tested here is a card that would otherwise reach a person: a purchase shown
 * without its cancellation terms, a takeover with no stated reason, a "type your code" request
 * carrying the code. They are contract violations rather than user errors, which is why they throw
 * — at the call site, where the stack still names whoever wrote it.
 */
import { describe, expect, it } from "vitest";

import {
  assertCompleteSummary,
  buildInteraction,
  escalationKindFor,
  isNeverFillable,
  touchesBrowser,
  type PaymentSummary,
} from "../src/interaction.js";
import { paymentSummaryDigest } from "../src/payment.js";

function summary(overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    merchant: { name: "携程", domain: "ctrip.com" },
    item: "MU5137 2026-09-02 经济舱",
    amount: { value: 1280, currency: "CNY" },
    cancellation: {
      summary: "起飞前 24 小时可退，收 200 元手续费",
      url: "https://ctrip.com/rules",
    },
    paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
    expiresAt: "2026-08-15T10:10:00.000Z",
    taskId: "task-1755000000000-aaaa1111",
    ...overrides,
  };
}

const digest = (value: PaymentSummary) => paymentSummaryDigest(value);

describe("which kinds touch the browser", () => {
  it("is exactly the two that hand the page over", () => {
    // The whole design turns on this split: the first three (and the secret card) leave the agent
    // working, and only these two put the person in the page.
    expect(touchesBrowser("human_challenge")).toBe(true);
    expect(touchesBrowser("browser_takeover")).toBe(true);
    for (const kind of [
      "info_request",
      "selection",
      "commitment_confirmation",
      "secret_entry",
    ] as const) {
      expect(touchesBrowser(kind)).toBe(false);
    }
  });

  it("maps onto the transaction layer's three gaps", () => {
    expect(escalationKindFor("info_request")).toBe("knowledge_gap");
    expect(escalationKindFor("selection")).toBe("knowledge_gap");
    expect(escalationKindFor("commitment_confirmation")).toBe("authority_gap");
    expect(escalationKindFor("secret_entry")).toBe("capability_gap");
    expect(escalationKindFor("human_challenge")).toBe("capability_gap");
    expect(escalationKindFor("browser_takeover")).toBe("capability_gap");
  });
});

describe("browser_takeover", () => {
  it("refuses to be built without a reason", () => {
    // 003 §7.4. The point is not paperwork: an unexplained takeover cannot be reviewed, and the
    // rate of them is the metric that says whether the other five kinds are covering enough.
    expect(() =>
      buildInteraction({ kind: "browser_takeover", ask: "请接管", summary: "", reason: "" }),
    ).toThrow(/reason/i);
    expect(() =>
      buildInteraction({ kind: "browser_takeover", ask: "请接管", summary: "", reason: "   " }),
    ).toThrow(/reason/i);
  });

  it("keeps the reason on the interaction", () => {
    const built = buildInteraction({
      kind: "browser_takeover",
      ask: "请在页面里完成银行的验证",
      summary: "银行 3DS 页面要求真实点击",
      reason: "3DS page requires a real click; no automatable control exists",
    });
    expect(built.kind).toBe("browser_takeover");
    expect((built as { reason: string }).reason).toMatch(/3DS/);
  });
});

describe("selection", () => {
  it("needs at least two options", () => {
    expect(() =>
      buildInteraction({
        kind: "selection",
        ask: "选一个",
        summary: "",
        options: [{ id: "a", label: "A", rationale: "唯一直飞", plan: {} }],
      }),
    ).toThrow(/at least two/i);
  });

  it("needs a rationale on every option", () => {
    expect(() =>
      buildInteraction({
        kind: "selection",
        ask: "选一个",
        summary: "",
        options: [
          { id: "a", label: "A", rationale: "唯一直飞", plan: {} },
          { id: "b", label: "B", rationale: "  ", plan: {} },
        ],
      }),
    ).toThrow(/rationale/i);
  });
});

describe("commitment_confirmation", () => {
  it("carries all seven fields of the purchase", () => {
    const built = buildInteraction(
      { kind: "commitment_confirmation", ask: "确认这笔付款", summary: "", payment: summary() },
      { computeDigest: digest },
    );
    expect(built.kind).toBe("commitment_confirmation");
    const card = built as { payment: PaymentSummary; digest: string };
    expect(card.payment.merchant.domain).toBe("ctrip.com");
    expect(card.digest).toHaveLength(32);
  });

  it.each([
    ["merchant.domain", { merchant: { name: "携程", domain: "" } }],
    ["item", { item: "" }],
    ["amount.currency", { amount: { value: 1280, currency: "" } }],
    ["cancellation", { cancellation: { summary: "" } }],
    ["paymentMethod.alias", { paymentMethod: { alias: "" } }],
    ["expiresAt", { expiresAt: "" }],
    ["taskId", { taskId: "" }],
  ])("refuses a summary missing %s", (_label, overrides) => {
    // A purchase shown without one of these is one the person was not really shown. The
    // cancellation line is the one people forget, and it is the one that decides whether "yes"
    // meant what they thought.
    expect(() =>
      buildInteraction(
        {
          kind: "commitment_confirmation",
          ask: "确认",
          summary: "",
          payment: summary(overrides as Partial<PaymentSummary>),
        },
        { computeDigest: digest },
      ),
    ).toThrow();
  });

  it("refuses a payment method that carries a token", () => {
    // A merchant token may itself be able to charge the card (003 §9.2), so it never appears on a
    // card, in an event, or in a trace — only an alias, a brand and four digits.
    expect(() =>
      assertCompleteSummary(
        summary({
          paymentMethod: { alias: "常用卡", token: "tok_live_123" } as never,
        }),
      ),
    ).toThrow(/token/i);
  });

  it("refuses to build without a digest of what is being shown", () => {
    expect(() =>
      buildInteraction({
        kind: "commitment_confirmation",
        ask: "确认",
        summary: "",
        payment: summary(),
      }),
    ).toThrow(/digest/i);
  });

  it("carries no tolerance unless one was offered", () => {
    const plain = buildInteraction(
      { kind: "commitment_confirmation", ask: "确认", summary: "", payment: summary() },
      { computeDigest: digest },
    ) as { offeredTolerance?: unknown };
    expect(plain.offeredTolerance).toBeUndefined();
  });
});

describe("secret_entry", () => {
  it("says what is wanted and why, and never carries the value", () => {
    const built = buildInteraction({
      kind: "secret_entry",
      ask: "请输入短信验证码",
      summary: "银行要求一次性密码",
      field: "otp",
      purpose: "完成 3DS 验证",
      live: false,
    });
    expect(built).toMatchObject({ kind: "secret_entry", field: "otp", live: false });
    // The keys are the contract: nothing on this object can hold what the person types.
    expect(Object.keys(built).sort()).toEqual([
      "ask",
      "createdAt",
      "field",
      "id",
      "kind",
      "live",
      "onTimeout",
      "purpose",
      "summary",
      "timeoutMs",
    ]);
  });

  it("refuses a request that carries anything shaped like the answer", () => {
    // This object is published over SSE, replayed from a ring buffer on reconnect and written to
    // traces (003 §4.6). "We strip it downstream" is a promise made in four places; refusing it
    // here is one.
    expect(() =>
      buildInteraction({
        kind: "secret_entry",
        ask: "请输入验证码",
        summary: "",
        field: "otp",
        purpose: "3DS",
        live: false,
        value: "123456",
      } as never),
    ).toThrow(/must not carry/i);
  });

  it("refuses a live fill for a field the app never fills", () => {
    // A payment password and a passkey are human-only under every flag — not "not yet", but never.
    for (const field of ["payment_password", "passkey"] as const) {
      expect(isNeverFillable(field)).toBe(true);
      expect(() =>
        buildInteraction({
          kind: "secret_entry",
          ask: "请输入",
          summary: "",
          field,
          purpose: "付款",
          live: true,
        }),
      ).toThrow(/never filled/i);
    }
  });

  it("allows the same fields as guidance, which is the shipped path", () => {
    const built = buildInteraction({
      kind: "secret_entry",
      ask: "请在银行 App 里输入支付密码",
      summary: "",
      field: "payment_password",
      purpose: "完成付款",
      live: false,
    });
    expect((built as { live: boolean }).live).toBe(false);
  });
});

describe("defaults", () => {
  it("lapses by suspending, like every other escalation in this project", () => {
    const built = buildInteraction({ kind: "info_request", ask: "几位乘客？", summary: "" });
    expect(built.onTimeout).toBe("suspend");
    expect(built.timeoutMs).toBeGreaterThan(0);
  });

  it("refuses an empty ask", () => {
    expect(() => buildInteraction({ kind: "info_request", ask: "  ", summary: "" })).toThrow(
      /ask/i,
    );
  });
});
