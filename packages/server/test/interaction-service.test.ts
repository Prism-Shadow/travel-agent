/**
 * The interaction service on its own: checkpoints, the escalation channel, and the end of a turn.
 *
 * Driven directly rather than over HTTP, because what is under test here is the behaviour the
 * routes delegate *to* — which card writes a checkpoint (and which deliberately does not), what an
 * escalation from the transaction layer turns into, and what happens to a question nobody answered
 * when the turn it belonged to ends.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { escalation } from "@travel-agent/transaction";
import { InteractionService, InvalidExpiryError } from "../src/interaction/service.js";
import type { InteractionServerEvent } from "../src/interaction/service.js";
import { InvalidOutcomeError } from "../src/interaction/outcome.js";

const dirs: string[] = [];

afterEach(async () => {
  // `maxRetries` because a checkpoint write can still be landing as the directory goes: the service
  // writes them best-effort and deliberately does not make a card wait on a file.
  while (dirs.length > 0) {
    await fs.rm(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

const LOCATOR = { sessionId: "session-1", projectId: "p1", agentId: "a1" };

async function serviceWith(clickPay = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "interaction-svc-"));
  dirs.push(root);
  const published: Array<{ sessionId: string; event: InteractionServerEvent }> = [];
  const service = new InteractionService({
    root,
    flags: {
      "payments.agent_click_pay": clickPay,
      "secret_entry.contract": false,
      "secret_entry.live": false,
    },
    publish: (sessionId, event) => published.push({ sessionId, event }),
    scratchpadDir: () => root,
  });
  return { service, published, root };
}

const payment = {
  merchant: { name: "携程", domain: "ctrip.com" },
  item: "MU5137 2026-09-02 经济舱",
  amount: { value: 1280, currency: "CNY" },
  cancellation: { summary: "起飞前 24 小时可退" },
  paymentMethod: { alias: "常用信用卡", last4: "4242" },
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  taskId: "task-1755000000000-aaaa1111",
};

describe("checkpoints", () => {
  it("records the payment page, with the summary that was shown", async () => {
    // This is what makes a lapsed card resumable: the next turn reads "we were at the payment page
    // waiting" instead of re-running the search.
    const { service, root } = await serviceWith();
    await service.request(LOCATOR, {
      kind: "commitment_confirmation",
      ask: "确认这笔付款",
      summary: "",
      taskId: payment.taskId,
      payment,
    });

    const checkpoint = JSON.parse(
      await fs.readFile(path.join(root, "task-checkpoint.json"), "utf8"),
    ) as { stage: string; payload: { kind: string; payment: { merchant: { domain: string } } } };
    expect(checkpoint.stage).toBe("awaiting_confirmation");
    expect(checkpoint.payload.kind).toBe("commitment_confirmation");
    expect(checkpoint.payload.payment.merchant.domain).toBe("ctrip.com");
  });

  it("records a choice as the stage it is", async () => {
    const { service, root } = await serviceWith();
    await service.request(LOCATOR, {
      kind: "selection",
      ask: "选一个",
      summary: "",
      options: [
        { id: "a", label: "A", rationale: "唯一直飞", plan: {} },
        { id: "b", label: "B", rationale: "便宜 400", plan: {} },
      ],
    });
    const checkpoint = JSON.parse(
      await fs.readFile(path.join(root, "task-checkpoint.json"), "utf8"),
    ) as { stage: string };
    expect(checkpoint.stage).toBe("awaiting_choice");
  });

  it("does not overwrite a real stage with a question", async () => {
    // An information request does not move the task. Checkpointing it would replace "we were at the
    // payment page" with "we asked how many passengers".
    const { service, root } = await serviceWith();
    await service.request(LOCATOR, {
      kind: "commitment_confirmation",
      ask: "确认",
      summary: "",
      taskId: payment.taskId,
      payment,
    });
    await service.request(LOCATOR, { kind: "info_request", ask: "几位乘客？", summary: "" });

    const checkpoint = JSON.parse(
      await fs.readFile(path.join(root, "task-checkpoint.json"), "utf8"),
    ) as { stage: string };
    expect(checkpoint.stage).toBe("awaiting_confirmation");
  });

  it("opens no journal for a conversation that never books anything", async () => {
    const { service, root } = await serviceWith();
    await service.request(LOCATOR, { kind: "info_request", ask: "几位乘客？", summary: "" });
    await expect(fs.readFile(path.join(root, "payments.jsonl"), "utf8")).rejects.toThrow();
  });
});

describe("the escalation channel", () => {
  it("turns a knowledge gap with options into a selection card", async () => {
    // The kind mapping read backwards. This is what makes anything in the transaction layer able to reach
    // the person without knowing what a card is.
    const { service } = await serviceWith();
    const channel = service.escalationChannel(LOCATOR, payment.taskId);
    const sending = channel.send(
      escalation({
        kind: "knowledge_gap",
        ask: "选一个航班",
        summary: "两个都直飞",
        options: [
          { id: "mu", label: "MU5137", rationale: "早到两小时", plan: {} },
          { id: "ca", label: "CA1234", rationale: "便宜 400", plan: {} },
        ],
      }),
    );

    const raised = service.pending(LOCATOR.sessionId)[0]!;
    expect(raised.kind).toBe("selection");
    await service.resolve(LOCATOR, raised.id, { status: "answered", optionId: "ca" });
    await expect(sending).resolves.toEqual({ status: "answered", optionId: "ca" });
  });

  it("turns an authority gap into a yes/no rather than a fake payment card", async () => {
    // An escalation has no purchase summary of its own; a seven-field card built from four fields
    // would be inventing the three that matter.
    const { service } = await serviceWith();
    const channel = service.escalationChannel(LOCATOR);
    const sending = channel.send(
      escalation({ kind: "authority_gap", ask: "价格涨了 60 元，还继续吗？", summary: "" }),
    );

    const raised = service.pending(LOCATOR.sessionId)[0]!;
    expect(raised).toMatchObject({ kind: "info_request", answerShape: "decision" });
    await service.resolve(LOCATOR, raised.id, { status: "declined" });
    await expect(sending).resolves.toEqual({ status: "answered", approved: false });
  });

  it("turns a capability gap into something the person does in the page", async () => {
    const { service } = await serviceWith();
    const channel = service.escalationChannel(LOCATOR);
    const sending = channel.send(
      escalation({ kind: "capability_gap", ask: "请完成滑块", summary: "" }),
    );
    const raised = service.pending(LOCATOR.sessionId)[0]!;
    expect(raised.kind).toBe("human_challenge");
    // Answered before the test ends: an escalation left hanging would still be writing its
    // checkpoint while the temporary directory is being removed.
    await service.resolve(LOCATOR, raised.id, { status: "answered", message: "好了" });
    await expect(sending).resolves.toMatchObject({ status: "answered" });
  });
});

describe("an answer that does not match its card", () => {
  /** A card of each kind, raised on a fresh service. */
  const raise = async (input: Parameters<InteractionService["request"]>[1]) => {
    const { service, published } = await serviceWith();
    const card = await service.request(LOCATOR, input);
    return { service, published, card };
  };

  const selection = {
    kind: "selection" as const,
    ask: "选一个",
    summary: "",
    options: [
      { id: "mu", label: "MU5137", rationale: "唯一直飞", plan: {} },
      { id: "ca", label: "CA1234", rationale: "便宜 400", plan: {} },
    ],
  };

  it("refuses an option that is not on the card, and leaves the card up", async () => {
    // The agent would otherwise act on a plan nobody was shown. And the card has to survive the
    // refusal: taking it down would leave the person with nothing to answer.
    const { service, published, card } = await raise(selection);
    await expect(
      service.resolve(LOCATOR, card.id, { status: "answered", optionId: "hu" }),
    ).rejects.toThrow(InvalidOutcomeError);
    expect(service.pending(LOCATOR.sessionId).map((i) => i.id)).toEqual([card.id]);
    expect(published.filter((e) => e.event.type === "interaction_resolved")).toEqual([]);
    await service.resolve(LOCATOR, card.id, { status: "answered", optionId: "ca" });
  });

  it("refuses a selection answered with no choice at all", async () => {
    const { service, card } = await raise(selection);
    await expect(service.resolve(LOCATOR, card.id, { status: "answered" })).rejects.toThrow(
      /optionId/,
    );
    await service.resolve(LOCATOR, card.id, { status: "declined" });
  });

  it("refuses an approval on a card that was never a purchase", async () => {
    const { service, card } = await raise(selection);
    await expect(
      service.resolve(LOCATOR, card.id, { status: "answered", optionId: "ca", approved: true }),
    ).rejects.toThrow(InvalidOutcomeError);
    await service.resolve(LOCATOR, card.id, { status: "answered", optionId: "ca" });
  });

  it("will not read a missing approval as a no, and records nothing", async () => {
    // The whole point of `declined` having its own status: an answered payment card with no
    // approval is neither a yes nor a no, and reading it generously spends somebody's money.
    const { service, card } = await raise({
      kind: "commitment_confirmation",
      ask: "确认",
      summary: "",
      taskId: payment.taskId,
      payment,
    });
    await expect(service.resolve(LOCATOR, card.id, { status: "answered" })).rejects.toThrow(
      /approved: true/,
    );
    await expect(
      service.resolve(LOCATOR, card.id, { status: "answered", approved: false }),
    ).rejects.toThrow(InvalidOutcomeError);

    const guard = await service.paymentGuard(LOCATOR);
    expect(guard.confirmationFor(payment.taskId)).toBeNull();
    await service.resolve(LOCATOR, card.id, { status: "declined" });
  });

  it("refuses slack the card never offered, and slack larger than it did", async () => {
    const { service, card } = await raise({
      kind: "commitment_confirmation",
      ask: "确认",
      summary: "",
      taskId: payment.taskId,
      payment,
      offeredTolerance: { amountIncrease: 50 },
    });
    await expect(
      service.resolve(LOCATOR, card.id, {
        status: "answered",
        approved: true,
        toleranceApproved: { amountIncrease: 500 },
      }),
    ).rejects.toThrow(/offered 50/);

    const guard = await service.paymentGuard(LOCATOR);
    expect(guard.confirmationFor(payment.taskId)).toBeNull();

    // Within the offer is fine, and is what gets recorded.
    await service.resolve(LOCATOR, card.id, {
      status: "answered",
      approved: true,
      toleranceApproved: { amountIncrease: 20 },
    });
    expect(guard.confirmationFor(payment.taskId)?.commitment.tolerance).toEqual({
      amount: { increase: 20 },
    });
  });

  it("refuses accepted slack on a card that offered none", async () => {
    const { service, card } = await raise({
      kind: "commitment_confirmation",
      ask: "确认",
      summary: "",
      taskId: payment.taskId,
      payment,
    });
    await expect(
      service.resolve(LOCATOR, card.id, {
        status: "answered",
        approved: true,
        toleranceApproved: { amountIncrease: 1 },
      }),
    ).rejects.toThrow(/offered no slack/);
    await service.resolve(LOCATOR, card.id, { status: "declined" });
  });

  it("lets a secret card carry nothing back — not a value, not a note", async () => {
    // The outcome is published over SSE and replayed from a ring buffer on reconnect. A code that
    // reached this object would be in three places before anybody noticed.
    const { service, published, card } = await raise({
      kind: "secret_entry",
      ask: "请在页面上输入验证码",
      summary: "",
      field: "otp",
      purpose: "3DS",
      live: false,
    });
    for (const bad of [
      { status: "answered" as const, value: "482913" },
      { status: "answered" as const, values: { otp: "482913" } },
      { status: "answered" as const, message: "验证码是 482913" },
      { status: "declined" as const, message: "算了" },
      { status: "answered" as const, approved: true },
    ]) {
      await expect(service.resolve(LOCATOR, card.id, bad)).rejects.toThrow(InvalidOutcomeError);
    }
    expect(JSON.stringify(published)).not.toContain("482913");

    // What it may say is that the person did it.
    await service.resolve(LOCATOR, card.id, { status: "answered" });
    expect(service.pending(LOCATOR.sessionId)).toEqual([]);
  });

  it("needs an actual answer to a question, and a boolean to a yes/no", async () => {
    const { service, card } = await raise({ kind: "info_request", ask: "几位乘客？", summary: "" });
    await expect(
      service.resolve(LOCATOR, card.id, { status: "answered", value: "   " }),
    ).rejects.toThrow(InvalidOutcomeError);
    await expect(
      service.resolve(LOCATOR, card.id, { status: "answered", approved: true }),
    ).rejects.toThrow(InvalidOutcomeError);
    await service.resolve(LOCATOR, card.id, { status: "answered", value: "两位成人" });

    const decision = await service.request(LOCATOR, {
      kind: "info_request",
      ask: "价格涨了 60 元，还继续吗？",
      summary: "",
      answerShape: "decision",
    });
    await expect(
      service.resolve(LOCATOR, decision.id, { status: "answered", value: "可以" }),
    ).rejects.toThrow(InvalidOutcomeError);
    await service.resolve(LOCATOR, decision.id, { status: "answered", approved: false });
  });
});

describe("how long a confirmation is worth anything", () => {
  const at = (iso: string) => ({ now: () => new Date(iso) });

  async function serviceAt(iso: string) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "interaction-exp-"));
    dirs.push(root);
    return new InteractionService({
      root,
      flags: {
        "payments.agent_click_pay": false,
        "secret_entry.contract": false,
        "secret_entry.live": false,
      },
      publish: () => {},
      scratchpadDir: () => root,
      ...at(iso),
    });
  }

  it("uses the product's ten minutes when the agent proposes nothing", async () => {
    const service = await serviceAt("2026-08-15T10:00:00.000Z");
    expect(service.confirmationExpiry()).toBe("2026-08-15T10:10:00.000Z");
    expect(service.confirmationExpiry("")).toBe("2026-08-15T10:10:00.000Z");
  });

  it("lets an agent shorten the window but never lengthen it", async () => {
    // A fare hold that lapses in two minutes is a real reason to ask for less. A day is not a
    // proposal, it is consent to a purchase whose page nobody has looked at since.
    const service = await serviceAt("2026-08-15T10:00:00.000Z");
    expect(service.confirmationExpiry("2026-08-15T10:02:00.000Z")).toBe("2026-08-15T10:02:00.000Z");
    expect(service.confirmationExpiry("2026-08-16T10:00:00.000Z")).toBe("2026-08-15T10:10:00.000Z");
  });

  it("refuses an expiry that is not an ISO timestamp with a zone", async () => {
    const service = await serviceAt("2026-08-15T10:00:00.000Z");
    for (const bad of ["soon", "2026-08-15", "2026-08-15T10:05:00", "十分钟后", "0"]) {
      expect(() => service.confirmationExpiry(bad)).toThrow(InvalidExpiryError);
    }
  });

  it("refuses an expiry that has already passed", async () => {
    // A card that is dead the moment it is shown teaches a person that the buttons are decorative.
    const service = await serviceAt("2026-08-15T10:00:00.000Z");
    expect(() => service.confirmationExpiry("2026-08-15T09:59:59.000Z")).toThrow(/already passed/);
    expect(() => service.confirmationExpiry("2026-08-15T10:00:00.000Z")).toThrow(
      InvalidExpiryError,
    );
  });
});

describe("when the turn ends", () => {
  it("settles every pending card and publishes each ending", async () => {
    const { service, published } = await serviceWith();
    const first = await service.request(LOCATOR, {
      kind: "info_request",
      ask: "几位？",
      summary: "",
    });
    const second = await service.request(LOCATOR, {
      kind: "info_request",
      ask: "哪天？",
      summary: "",
    });

    service.endTask(LOCATOR.sessionId, payment.taskId);

    expect(service.pending(LOCATOR.sessionId)).toEqual([]);
    const resolved = published.filter((entry) => entry.event.type === "interaction_resolved");
    expect(
      resolved.map((entry) => (entry.event as { interactionId: string }).interactionId),
    ).toEqual([first.id, second.id]);
  });

  it("forgets what the turn confirmed, so the next one cannot spend it", async () => {
    const { service } = await serviceWith();
    const card = await service.request(LOCATOR, {
      kind: "commitment_confirmation",
      ask: "确认",
      summary: "",
      taskId: payment.taskId,
      payment,
    });
    await service.resolve(LOCATOR, card.id, { status: "answered", approved: true });

    const guard = await service.paymentGuard(LOCATOR);
    expect(guard.confirmationFor(payment.taskId)).not.toBeNull();

    service.endTask(LOCATOR.sessionId, payment.taskId);
    expect(guard.confirmationFor(payment.taskId)).toBeNull();
  });
});
