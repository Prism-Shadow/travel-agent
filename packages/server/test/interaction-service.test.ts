/** Interaction cards: construction, answer validation, expiry, and turn lifetime. */
import { describe, expect, it } from "vitest";

import type { PaymentSummary } from "../src/api/types.js";
import {
  assertCompleteSummary,
  buildInteraction,
  isNeverFillable,
} from "../src/interaction/model.js";
import { InvalidOutcomeError } from "../src/interaction/outcome.js";
import {
  InteractionService,
  InvalidExpiryError,
  type InteractionServerEvent,
} from "../src/interaction/service.js";

const LOCATOR = { sessionId: "session-1" };

function serviceAt(iso = "2026-08-15T10:00:00.000Z") {
  const published: Array<{ sessionId: string; event: InteractionServerEvent }> = [];
  const service = new InteractionService({
    publish: (sessionId, event) => published.push({ sessionId, event }),
    now: () => new Date(iso),
  });
  return { service, published };
}

function payment(overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    merchant: { name: "携程", domain: "ctrip.com" },
    item: "MU5137 2026-09-02 经济舱",
    amount: { value: 1280, currency: "CNY" },
    cancellation: { summary: "起飞前 24 小时可退" },
    paymentMethod: { alias: "常用信用卡", last4: "4242" },
    expiresAt: "2026-08-15T10:10:00.000Z",
    taskId: "task-1755000000000-aaaa1111",
    ...overrides,
  };
}

describe("interaction construction", () => {
  it("requires a reason for browser takeover", () => {
    expect(() =>
      buildInteraction({ kind: "browser_takeover", ask: "请接管", summary: "", reason: "" }),
    ).toThrow(/reason/i);
  });

  it("requires at least two reasoned selection options", () => {
    expect(() =>
      buildInteraction({
        kind: "selection",
        ask: "选一个",
        summary: "",
        options: [{ id: "a", label: "A", rationale: "唯一直飞", plan: {} }],
      }),
    ).toThrow(/at least two/i);
    expect(() =>
      buildInteraction({
        kind: "selection",
        ask: "选一个",
        summary: "",
        options: [
          { id: "a", label: "A", rationale: "唯一直飞", plan: {} },
          { id: "b", label: "B", rationale: " ", plan: {} },
        ],
      }),
    ).toThrow(/rationale/i);
  });

  it.each([
    ["merchant.domain", { merchant: { name: "携程", domain: "" } }],
    ["item", { item: "" }],
    ["amount.currency", { amount: { value: 1280, currency: "" } }],
    ["cancellation", { cancellation: { summary: "" } }],
    ["paymentMethod.alias", { paymentMethod: { alias: "" } }],
    ["expiresAt", { expiresAt: "" }],
    ["taskId", { taskId: "" }],
  ])("refuses a payment summary missing %s", (_label, overrides) => {
    expect(() =>
      buildInteraction({
        kind: "commitment_confirmation",
        ask: "确认",
        summary: "",
        payment: payment(overrides as Partial<PaymentSummary>),
      }),
    ).toThrow();
  });

  it("never carries a payment token", () => {
    expect(() =>
      assertCompleteSummary(
        payment({ paymentMethod: { alias: "常用卡", token: "tok_live_123" } as never }),
      ),
    ).toThrow(/token/i);
  });

  it("never carries a secret value", () => {
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

  it("never fills payment passwords or passkeys", () => {
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
});

describe("answer validation", () => {
  const selection = {
    kind: "selection" as const,
    ask: "选一个",
    summary: "",
    options: [
      { id: "mu", label: "MU5137", rationale: "唯一直飞", plan: {} },
      { id: "ca", label: "CA1234", rationale: "便宜 400", plan: {} },
    ],
  };

  it("leaves a card pending after an invalid option", async () => {
    const { service, published } = serviceAt();
    const card = service.request(LOCATOR, selection);
    await expect(
      service.resolve(LOCATOR, card.id, { status: "answered", optionId: "hu" }),
    ).rejects.toThrow(InvalidOutcomeError);
    expect(service.pending(LOCATOR.sessionId).map((item) => item.id)).toEqual([card.id]);
    expect(published.filter((entry) => entry.event.type === "interaction_resolved")).toEqual([]);
  });

  it("requires an explicit yes or decline on a confirmation card", async () => {
    const { service } = serviceAt();
    const card = service.request(LOCATOR, {
      kind: "commitment_confirmation",
      ask: "确认",
      summary: "",
      payment: payment(),
    });
    await expect(service.resolve(LOCATOR, card.id, { status: "answered" })).rejects.toThrow(
      /approved: true/,
    );
    await service.resolve(LOCATOR, card.id, { status: "declined" });
  });

  it("lets a secret answer carry no value or note", async () => {
    const { service, published } = serviceAt();
    const card = service.request(LOCATOR, {
      kind: "secret_entry",
      ask: "请在页面上输入验证码",
      summary: "",
      field: "otp",
      purpose: "3DS",
      live: false,
    });
    await expect(
      service.resolve(LOCATOR, card.id, { status: "answered", value: "482913" }),
    ).rejects.toThrow(InvalidOutcomeError);
    expect(JSON.stringify(published)).not.toContain("482913");
    await service.resolve(LOCATOR, card.id, { status: "answered" });
  });
});

describe("confirmation expiry", () => {
  it("uses ten minutes and clamps longer proposals", () => {
    const { service } = serviceAt();
    expect(service.confirmationExpiry()).toBe("2026-08-15T10:10:00.000Z");
    expect(service.confirmationExpiry("2026-08-16T10:00:00.000Z")).toBe("2026-08-15T10:10:00.000Z");
  });

  it("refuses ambiguous or expired timestamps", () => {
    const { service } = serviceAt();
    expect(() => service.confirmationExpiry("2026-08-15T10:05:00")).toThrow(InvalidExpiryError);
    expect(() => service.confirmationExpiry("2026-08-15T09:59:59.000Z")).toThrow(/already passed/);
  });
});

describe("turn lifetime", () => {
  it("settles every pending card when the turn ends", async () => {
    const { service, published } = serviceAt();
    const first = service.request(LOCATOR, { kind: "info_request", ask: "几位？", summary: "" });
    const waiting = service.awaitOutcome(LOCATOR, first.id);
    service.endTask(LOCATOR.sessionId);
    await expect(waiting).resolves.toEqual({ status: "aborted" });
    expect(service.pending(LOCATOR.sessionId)).toEqual([]);
    expect(published.some((entry) => entry.event.type === "interaction_resolved")).toBe(true);
  });
});
