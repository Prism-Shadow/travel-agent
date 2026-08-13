/**
 * Card-building and channel tests.
 *
 * The card builder carries the real decisions (what the person sees, what a tap means), so it is
 * tested directly. The Feishu transport is exercised with an injected fetch — enough to pin the
 * wait/timeout/abort semantics, which are ours; the wire contract itself needs a live tenant.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildEscalationCard,
  escalation,
  FeishuCardChannel,
  outcomeFromAction,
} from "../src/index.js";

const options = [
  {
    id: "a",
    label: "东航 MU5137 14:20→16:35 ¥1280",
    rationale: "唯一直飞，时间也最合适",
    plan: { price: 1280 },
  },
  {
    id: "b",
    label: "春秋 9C8916 13:05→15:30 ¥880",
    rationale: "最便宜，省 400，但要托运另付",
    plan: { price: 880 },
  },
  {
    id: "c",
    label: "国航 CA1858 16:40→19:05 ¥1150",
    rationale: "晚 2 小时，比 ① 省 130",
    plan: { price: 1150 },
  },
];

function choiceCard() {
  return buildEscalationCard(
    escalation({
      kind: "knowledge_gap",
      ask: "选一个方案，我接着往下订",
      summary: "北京 → 上海 · 8月20日 · 1人",
      options,
    }),
  );
}

describe("buildEscalationCard", () => {
  it("leads with the ask, not the context", () => {
    const card = choiceCard();
    const elements = card.card.elements as Record<string, unknown>[];
    expect(JSON.stringify(elements[0])).toContain("选一个方案");
  });

  it("renders every option with its rationale", () => {
    const json = JSON.stringify(choiceCard());
    for (const option of options) {
      expect(json).toContain(option.label);
      expect(json).toContain(option.rationale);
    }
  });

  it("gives each option a button carrying its id", () => {
    const elements = (choiceCard().card.elements as Record<string, unknown>[]).filter(
      (element) => element.tag === "action",
    );
    const choose = (elements[0]!.actions as Record<string, unknown>[]).map(
      (action) => action.value as { optionId: string; intent: string },
    );
    expect(choose.map((value) => value.optionId)).toEqual(["a", "b", "c"]);
    expect(new Set(choose.map((value) => value.intent))).toEqual(new Set(["choose"]));
  });

  it("offers a keep-looking button, which is an answer rather than a failure", () => {
    const json = JSON.stringify(choiceCard());
    expect(json).toContain("都不合适");
    expect(json).toContain("reject_all");
  });

  it("an authority gap gets approve / refuse instead of a list", () => {
    const card = buildEscalationCard(
      escalation({ kind: "authority_gap", ask: "价格涨了 120，还订吗？", summary: "780 → 900" }),
    );
    const json = JSON.stringify(card);
    expect(json).toContain('"approve"');
    expect(json).toContain('"refuse"');
    expect(json).not.toContain("reject_all");
  });

  it("a capability gap gets a single done button", () => {
    const json = JSON.stringify(
      buildEscalationCard(
        escalation({ kind: "capability_gap", ask: "请输入短信验证码", summary: "登录被拦截" }),
      ),
    );
    expect(json).toContain('"done"');
  });

  it("states what happens if nobody answers", () => {
    expect(JSON.stringify(choiceCard())).toContain("挂起");
    const aborting = buildEscalationCard(
      escalation({ kind: "authority_gap", ask: "确认", summary: "s", onTimeout: "abort" }),
    );
    expect(JSON.stringify(aborting)).toContain("终止任务");
  });
});

describe("outcomeFromAction", () => {
  it("a choice is an answer that carries the option and authorises it", () => {
    expect(outcomeFromAction({ escalationId: "e", optionId: "b", intent: "choose" })).toEqual({
      status: "answered",
      optionId: "b",
      approved: true,
      message: undefined,
    });
  });

  it("a refusal is answered-but-not-approved, not an error", () => {
    expect(outcomeFromAction({ escalationId: "e", intent: "refuse" })).toMatchObject({
      status: "answered",
      approved: false,
    });
  });

  it("keep-looking answers with a reason the search can use", () => {
    expect(outcomeFromAction({ escalationId: "e", intent: "reject_all" }).message).toBeTruthy();
  });
});

describe("FeishuCardChannel", () => {
  const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 }));

  it("posts the card and resolves when the tap comes back", async () => {
    const fetchImpl = okFetch();
    const channel = new FeishuCardChannel({
      webhookUrl: "https://example.invalid/hook",
      fetchImpl,
    });
    const esc = escalation({ kind: "knowledge_gap", ask: "选一个", summary: "s", options });

    const pending = channel.send(esc);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(
      channel.resolve({ escalationId: esc.id, optionId: "b", intent: "choose" }, "就这个"),
    ).toBe(true);

    await expect(pending).resolves.toEqual({
      status: "answered",
      optionId: "b",
      approved: true,
      message: "就这个",
    });
  });

  it("resolves with a timeout carrying the lapse policy, instead of throwing", async () => {
    const channel = new FeishuCardChannel({
      webhookUrl: "https://example.invalid/hook",
      fetchImpl: okFetch(),
    });
    const esc = escalation({ kind: "authority_gap", ask: "确认", summary: "s", timeoutMs: 150 });
    await expect(channel.send(esc)).resolves.toEqual({ status: "timeout", policy: "suspend" });
  });

  it("ignores a tap on an escalation that already lapsed", async () => {
    const channel = new FeishuCardChannel({
      webhookUrl: "https://example.invalid/hook",
      fetchImpl: okFetch(),
    });
    const esc = escalation({ kind: "authority_gap", ask: "确认", summary: "s", timeoutMs: 100 });
    await channel.send(esc);
    expect(channel.resolve({ escalationId: esc.id, intent: "approve" })).toBe(false);
  });

  it("aborts when the signal fires", async () => {
    const channel = new FeishuCardChannel({
      webhookUrl: "https://example.invalid/hook",
      fetchImpl: okFetch(),
    });
    const controller = new AbortController();
    const esc = escalation({ kind: "authority_gap", ask: "确认", summary: "s", timeoutMs: 10_000 });
    const pending = channel.send(esc, controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual({ status: "aborted" });
  });

  it("surfaces a rejected webhook as an error — an undelivered card is a real failure", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 403, statusText: "Forbidden" }),
    );
    const channel = new FeishuCardChannel({
      webhookUrl: "https://example.invalid/hook",
      fetchImpl,
    });
    await expect(
      channel.send(escalation({ kind: "authority_gap", ask: "确认", summary: "s" })),
    ).rejects.toThrow(/403/);
  });
});
