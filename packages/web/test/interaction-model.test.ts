/**
 * What the interaction cards show and send (src/features/chat/interaction-model.ts).
 *
 * These are the rules a screenshot review would not catch: that a payment card carries all seven
 * fields with the merchant's *domain* beside its name, that slack is only ever sent when the person
 * ticked the box that offered it, and that the card for a one-time code does not pretend this
 * application will type it.
 */
import { describe, expect, it } from "vitest";
import type { UserInteraction } from "@prismshadow/penguin-server/api";

import {
  canSubmit,
  cardCopy,
  formatAmount,
  formatExpiry,
  outcomeFor,
  paymentLines,
  secretEntryIsGuidanceOnly,
} from "../src/features/chat/interaction-model";

const base = {
  id: "int-1",
  ask: "看看这个",
  summary: "",
  timeoutMs: 120_000,
  onTimeout: "suspend" as const,
  createdAt: "2026-08-15T10:00:00.000Z",
};

const payment = {
  merchant: { name: "携程", domain: "ctrip.com" },
  item: "MU5137 2026-09-02 经济舱",
  amount: { value: 1280, currency: "CNY" },
  cancellation: { summary: "起飞前 24 小时可退" },
  paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
  expiresAt: "2026-08-15T10:10:00.000Z",
  taskId: "task-1755000000000-aaaa1111",
};

const confirmation = (extra: Record<string, unknown> = {}): UserInteraction =>
  ({
    ...base,
    kind: "commitment_confirmation",
    ask: "确认这笔付款",
    payment,
    digest: "d".repeat(32),
    ...extra,
  }) as UserInteraction;

describe("the payment card", () => {
  it("shows all seven fields, with the domain beside the name", () => {
    // The display name is what a phishing page controls; the domain is what it cannot. A card that
    // showed only "携程" would be exactly as convincing on the wrong site.
    //
    // Seven lines, counted: the purchase summary lists seven fields, and a card that renders five of them while
    // the comment above it says seven is the exact defect this counts.
    const lines = paymentLines(payment);
    expect(lines).toHaveLength(7);
    expect(lines.join("\n")).toContain("ctrip.com");
    expect(lines.join("\n")).toContain("MU5137");
    expect(lines.join("\n")).toContain("1280 CNY");
    expect(lines.join("\n")).toContain("起飞前 24 小时可退");
    expect(lines.join("\n")).toContain("••4242");
    expect(lines.join("\n")).toContain("task-1755000000000-aaaa1111");
  });

  it("shows when the confirmation lapses, in the reader's own clock", () => {
    // Built from a local `Date` and read back with local getters, so the assertion holds in any
    // timezone — and so the person is not asked to convert a `Z` timestamp in their head to work
    // out whether they still have time.
    const at = new Date(2026, 7, 16, 9, 5);
    const lines = paymentLines({ ...payment, expiresAt: at.toISOString() });
    expect(lines[5]).toBe("确认有效期至：2026-08-16 09:05");
  });

  it("shows a malformed expiry verbatim rather than as a blank or an Invalid Date", () => {
    // A blank line where the expiry belongs reads as "no expiry", which is the opposite of true.
    expect(formatExpiry("not-a-timestamp")).toBe("not-a-timestamp");
    expect(paymentLines({ ...payment, expiresAt: "" })[5]).toBe("确认有效期至：");
  });

  it("never renders anything that could charge the card", () => {
    const lines = paymentLines({
      ...payment,
      paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
    });
    // Every line except our own task id, whose millisecond stamp is a long run of digits and is
    // not a number anybody could charge. What is being looked for is a PAN or a token.
    const shown = lines.filter((line) => !line.startsWith("所属任务")).join("\n");
    expect(shown).not.toMatch(/tok_|token|[0-9]{13,}/);
    expect(lines.join("\n")).not.toMatch(/tok_|token/);
  });

  it("always shows the amount with its currency", () => {
    expect(formatAmount(1280, "cny")).toBe("1280 CNY");
    expect(formatAmount(1280.5, "USD")).toBe("1280.50 USD");
  });

  it("offers confirm and decline, in that order", () => {
    const copy = cardCopy(confirmation());
    expect(copy.actions.map((action) => action.kind)).toEqual(["approve", "decline"]);
  });
});

describe("the slack a person may grant", () => {
  it("is not sent when the box was not ticked", () => {
    // An unapproved tolerance is zero, and no path here invents one.
    const outcome = outcomeFor({
      action: { kind: "approve", label: "确认", tone: "primary" },
      offeredTolerance: { amountIncrease: 50 },
      toleranceAccepted: false,
    });
    expect(outcome).toEqual({ status: "answered", approved: true });
  });

  it("is sent only when it was both offered and accepted", () => {
    expect(
      outcomeFor({
        action: { kind: "approve", label: "确认", tone: "primary" },
        offeredTolerance: { amountIncrease: 50 },
        toleranceAccepted: true,
      }),
    ).toEqual({ status: "answered", approved: true, toleranceApproved: { amountIncrease: 50 } });

    // Ticked with nothing offered cannot happen through the UI, and does nothing if it does.
    expect(
      outcomeFor({
        action: { kind: "approve", label: "确认", tone: "primary" },
        toleranceAccepted: true,
      }),
    ).toEqual({ status: "answered", approved: true });
  });

  it("turns a decline into a declined outcome, not an unapproved answer", () => {
    // The difference matters downstream: "declined" is a decision, while an answer with
    // `approved: false` would still look like an answer to a question that was never asked.
    expect(outcomeFor({ action: { kind: "decline", label: "先不付", tone: "quiet" } })).toEqual({
      status: "declined",
    });
  });
});

describe("the other kinds", () => {
  it("puts every option's reason on its button", () => {
    const copy = cardCopy({
      ...base,
      kind: "selection",
      ask: "选一个",
      options: [
        { id: "a", label: "MU5137 14:20", rationale: "唯一直飞", plan: {} },
        { id: "b", label: "CA1234 09:05", rationale: "便宜 400", plan: {} },
      ],
    } as UserInteraction);
    expect(copy.actions).toHaveLength(2);
    expect(copy.actions.every((action) => action.kind === "choose")).toBe(true);
    expect(copy.actions.map((a) => (a as { rationale: string }).rationale)).toEqual([
      "唯一直飞",
      "便宜 400",
    ]);
  });

  it("gives a yes/no card for an authority question rather than a text box", () => {
    const copy = cardCopy({
      ...base,
      kind: "info_request",
      ask: "价格涨了 60 元，还继续吗？",
      answerShape: "decision",
    } as UserInteraction);
    expect(copy.actions.map((action) => action.kind)).toEqual(["approve", "decline"]);
  });

  it("needs an answer before a free-text question can be sent", () => {
    const question = { ...base, kind: "info_request", ask: "几位乘客？" } as UserInteraction;
    expect(canSubmit(question, "  ")).toBe(false);
    expect(canSubmit(question, "两位")).toBe(true);
    // A decision card is two buttons; nothing was typed and nothing needs to be.
    expect(canSubmit({ ...question, answerShape: "decision" } as UserInteraction, "")).toBe(true);
  });

  it("says what the code is for, and does not promise to type it", () => {
    // `secret_entry.live` is off in this phase, so the card explains and the person types it into
    // the site's own field. An input box here would promise a capability that is switched off.
    const interaction = {
      ...base,
      kind: "secret_entry",
      ask: "银行发来的验证码请填在页面上",
      field: "otp",
      purpose: "完成 3DS 验证",
      live: false,
    } as UserInteraction;
    expect(secretEntryIsGuidanceOnly(interaction)).toBe(true);
    const copy = cardCopy(interaction);
    expect(copy.detail.join(" ")).toContain("短信");
    expect(copy.detail.join(" ")).toContain("完成 3DS 验证");
    expect(copy.actions.map((action) => action.label)).toEqual(["我已在页面上输入", "换一种方式"]);
  });

  it("shows why a takeover happened", () => {
    const copy = cardCopy({
      ...base,
      kind: "browser_takeover",
      ask: "请接管浏览器完成这一步",
      reason: "站点用自绘控件，没有可自动化的元素",
    } as UserInteraction);
    expect(copy.detail.join(" ")).toContain("自绘控件");
  });
});
