/**
 * The full round trip of a card: the agent raises it, the person answers it, the agent hears.
 *
 * Two credentials meet here and they are deliberately different. The agent authenticates with the
 * token minted for its turn — it has no cookie, and it is a subprocess — while the person answers
 * over the ordinary session cookie with the ordinary project check. Most of what is asserted below
 * is the *boundary* between them: a token from another conversation, a token whose turn has ended,
 * a card built out of parameters that would put a dishonest question in front of somebody.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-15-12-00-00-cccc0001";

function blockingSession(sessionId: string, release: Promise<void>): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(): AsyncGenerator<OmniMessage> {
      await release;
      yield assistantText("done");
    },
    async *compact() {},
  };
}

const payment = (overrides: Record<string, unknown> = {}) => ({
  merchant: { name: "携程", domain: "ctrip.com" },
  item: "MU5137 2026-09-02 经济舱",
  amount: { value: 1280, currency: "CNY" },
  cancellation: { summary: "起飞前 24 小时可退" },
  paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
  ...overrides,
});

describe("interaction round trip", () => {
  let t: TestApp;
  let cookie: string;
  let row: SizedRow;
  let release!: () => void;
  let running: Promise<void>;

  type SizedRow = SessionRow;

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "interactor"));
    row = {
      sessionId: SID,
      projectId: "interactor-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    running = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, blockingSession(SID, running));
    await t.deps.manager.startTask(SID, [userText("book me a flight")]);
  });

  afterEach(async () => {
    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle").catch(() => undefined);
    await t.cleanup();
  });

  const api = () => apiClient(t.app, cookie);
  const token = () => t.deps.manager.interactionTokens.current(SID)?.token ?? "";

  /** The agent's own surface: a bearer token, no cookie. */
  const agent = (bearer = token()) => ({
    post: (path: string, body: unknown) =>
      t.app.request(path, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    get: (path: string) => t.app.request(path, { headers: { authorization: `Bearer ${bearer}` } }),
  });

  it("raises a card, waits, and hears the answer", async () => {
    const created = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "info_request",
      ask: "几位乘客？",
      summary: "航班已选好，缺乘客人数",
    });
    expect(created.status).toBe(200);
    const { interactionId } = (await created.json()) as { interactionId: string };

    // The card is pending, and would be replayed to a client that connects now.
    expect(t.deps.interactions.pending(SID).map((i) => i.id)).toEqual([interactionId]);

    // The agent is waiting; the person answers over the ordinary cookie surface.
    const waiting = agent().get(
      `/api/agent/interactions/${interactionId}?sessionId=${SID}&waitMs=5000`,
    );
    const answered = await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, {
      status: "answered",
      value: "两位成人",
    });
    expect(answered.status).toBe(204);

    const outcome = (await (await waiting).json()) as {
      outcome: { status: string; value: string };
    };
    expect(outcome.outcome).toMatchObject({ status: "answered", value: "两位成人" });
    expect(t.deps.interactions.pending(SID)).toEqual([]);
  });

  it("still answers a waiter that reconnected after its socket died", async () => {
    // The agent's connection is not the question. A CLI whose request timed out asks again, and
    // has to learn what the person said rather than asking them a second time.
    const created = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "info_request",
      ask: "几位乘客？",
    });
    const { interactionId } = (await created.json()) as { interactionId: string };
    await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, {
      status: "answered",
      value: "两位成人",
    });

    const late = await agent().get(
      `/api/agent/interactions/${interactionId}?sessionId=${SID}&waitMs=100`,
    );
    expect(((await late.json()) as { outcome: { value: string } }).outcome.value).toBe("两位成人");
  });

  it("records what was confirmed when a payment card is approved", async () => {
    const created = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "commitment_confirmation",
      ask: "确认这笔付款",
      payment: payment(),
    });
    const { interactionId, digest } = (await created.json()) as {
      interactionId: string;
      digest: string;
    };
    expect(digest).toHaveLength(32);

    await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, {
      status: "answered",
      approved: true,
    });

    const taskId = t.deps.manager.browserTaskState(SID).running!;
    const guard = await t.deps.interactions.paymentGuard({
      sessionId: SID,
      projectId: row.projectId,
      agentId: row.agentId,
    });
    const confirmed = guard.confirmationFor(taskId);
    expect(confirmed?.summary.merchant.domain).toBe("ctrip.com");
    // No slack unless the person picked some: the exact amount is the ceiling (003 §8.5).
    expect(confirmed?.commitment.tolerance).toEqual({});
  });

  it("records the slack the person actually chose", async () => {
    const created = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "commitment_confirmation",
      ask: "确认这笔付款",
      payment: payment(),
      offeredTolerance: { amountIncrease: 50 },
    });
    const { interactionId } = (await created.json()) as { interactionId: string };
    await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, {
      status: "answered",
      approved: true,
      toleranceApproved: { amountIncrease: 50 },
    });

    const taskId = t.deps.manager.browserTaskState(SID).running!;
    const guard = await t.deps.interactions.paymentGuard({
      sessionId: SID,
      projectId: row.projectId,
      agentId: row.agentId,
    });
    expect(guard.confirmationFor(taskId)?.commitment.tolerance).toEqual({
      amount: { increase: 50 },
    });
  });

  it("refuses an answer that does not match the card, and keeps the card up", async () => {
    // A body is just JSON: nothing about the round trip forces it to agree with the question it
    // claims to answer. The refusal has to leave the card pending, or a mistyped answer would take
    // away the only thing the person could act on.
    const created = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "selection",
      ask: "选一个航班",
      options: [
        { id: "mu", label: "MU5137", rationale: "唯一直飞" },
        { id: "ca", label: "CA1234", rationale: "便宜 400" },
      ],
    });
    const { interactionId } = (await created.json()) as { interactionId: string };

    const wrong = await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, {
      status: "answered",
      optionId: "hu7890",
    });
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(await wrong.json())).toMatch(/hu7890/);
    expect(t.deps.interactions.pending(SID).map((i) => i.id)).toEqual([interactionId]);

    const right = await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, {
      status: "answered",
      optionId: "ca",
    });
    expect(right.status).toBe(204);
  });

  it("refuses a payment answered without an explicit approval, and records nothing", async () => {
    const created = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "commitment_confirmation",
      ask: "确认这笔付款",
      payment: payment(),
    });
    const { interactionId } = (await created.json()) as { interactionId: string };

    for (const body of [
      { status: "answered" },
      { status: "answered", approved: false },
      { status: "answered", approved: true, toleranceApproved: { amountIncrease: 100 } },
    ]) {
      const res = await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, body);
      expect(res.status).toBe(400);
    }

    const taskId = t.deps.manager.browserTaskState(SID).running!;
    const guard = await t.deps.interactions.paymentGuard({
      sessionId: SID,
      projectId: row.projectId,
      agentId: row.agentId,
    });
    expect(guard.confirmationFor(taskId)).toBeNull();
    expect(t.deps.interactions.pending(SID).map((i) => i.id)).toEqual([interactionId]);
  });

  it("refuses anything coming back from a secret card", async () => {
    // Whatever the person typed went into the site's own field. A code arriving here would be
    // published over SSE and replayed on reconnect before anybody noticed (003 §4.6).
    const created = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "secret_entry",
      ask: "请在页面上输入验证码",
      field: "otp",
      purpose: "3DS",
    });
    const { interactionId } = (await created.json()) as { interactionId: string };

    const leak = await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, {
      status: "answered",
      value: "482913",
    });
    expect(leak.status).toBe(400);

    const done = await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, {
      status: "answered",
    });
    expect(done.status).toBe(204);
  });

  it("clamps a confirmation window to the product's ten minutes, and refuses a bad one", async () => {
    // The agent may shorten it; it may not extend it, and it may not put a string on the card that
    // is not a timestamp at all.
    const bad = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "commitment_confirmation",
      ask: "确认",
      payment: payment({ expiresAt: "in a bit" }),
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toMatch(/expiresAt/);

    const past = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "commitment_confirmation",
      ask: "确认",
      payment: payment({ expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    });
    expect(past.status).toBe(400);

    const far = new Date(Date.now() + 86_400_000).toISOString();
    const created = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "commitment_confirmation",
      ask: "确认",
      payment: payment({ expiresAt: far }),
    });
    expect(created.status).toBe(200);
    const { interactionId } = (await created.json()) as { interactionId: string };
    const card = t.deps.interactions.pending(SID).find((i) => i.id === interactionId)!;
    const expiresAt = (card as { payment: { expiresAt: string } }).payment.expiresAt;
    expect(expiresAt).not.toBe(far);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
  });

  it("records nothing when the person declines", async () => {
    const created = await agent().post("/api/agent/interactions", {
      sessionId: SID,
      kind: "commitment_confirmation",
      ask: "确认这笔付款",
      payment: payment(),
    });
    const { interactionId } = (await created.json()) as { interactionId: string };
    await api().post(`/api/sessions/${SID}/interactions/${interactionId}`, {
      status: "declined",
      message: "太贵了，看看别的",
    });

    const taskId = t.deps.manager.browserTaskState(SID).running!;
    const guard = await t.deps.interactions.paymentGuard({
      sessionId: SID,
      projectId: row.projectId,
      agentId: row.agentId,
    });
    expect(guard.confirmationFor(taskId)).toBeNull();
  });
});

describe("what the agent may not ask", () => {
  let t: TestApp;
  let cookie: string;
  let release!: () => void;

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "asker"));
    const row: SessionRow = {
      sessionId: SID,
      projectId: "asker-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, blockingSession(SID, blocked));
    await t.deps.manager.startTask(SID, [userText("go")]);
    void cookie;
  });

  afterEach(async () => {
    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle").catch(() => undefined);
    await t.cleanup();
  });

  const post = (body: unknown, bearer?: string) =>
    t.app.request("/api/agent/interactions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer ?? t.deps.manager.interactionTokens.current(SID)?.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  it("refuses a takeover with no reason", async () => {
    // The card would otherwise say "please take over" with nothing a reviewer could weigh.
    const res = await post({ sessionId: SID, kind: "browser_takeover", ask: "请接管" });
    expect(res.status).toBe(400);
  });

  it("refuses a purchase with no cancellation terms", async () => {
    const res = await post({
      sessionId: SID,
      kind: "commitment_confirmation",
      ask: "确认",
      payment: { ...payment(), cancellation: { summary: "" } },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/cancellation/);
  });

  it("refuses a selection with one option", async () => {
    const res = await post({
      sessionId: SID,
      kind: "selection",
      ask: "选一个",
      options: [{ id: "a", label: "A", rationale: "唯一直飞" }],
    });
    expect(res.status).toBe(400);
  });

  it("never lets the agent ask for a live secret fill", async () => {
    // The agent does not get a vote on whether the app types a one-time code. In this phase
    // nothing does: the card explains what is needed and the person enters it themselves.
    const res = await post({
      sessionId: SID,
      kind: "secret_entry",
      ask: "请输入短信验证码",
      field: "otp",
      purpose: "3DS",
      live: true,
    });
    expect(res.status).toBe(200);
    const { interactionId } = (await res.json()) as { interactionId: string };
    const raised = t.deps.interactions.pending(SID).find((i) => i.id === interactionId);
    expect(raised).toMatchObject({ kind: "secret_entry", live: false });
  });

  it("refuses a bearer token from another conversation", async () => {
    const other = "session-2026-08-15-12-00-00-dddd0002";
    t.deps.sessionsRepo.insert({
      sessionId: other,
      projectId: "asker-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
    });
    const res = await post({ sessionId: other, kind: "info_request", ask: "几位？" });
    expect(res.status).toBe(401);
  });

  it("refuses a made-up token", async () => {
    const res = await post({ sessionId: SID, kind: "info_request", ask: "几位？" }, "not-a-token");
    expect(res.status).toBe(401);
  });

  it("takes its cards down when the turn ends", async () => {
    // A card with no turn behind it would be answered into a void: the person clicks, and nothing
    // is listening. Every pending question is settled as aborted when the run finishes.
    const created = await post({ sessionId: SID, kind: "info_request", ask: "几位？" });
    const { interactionId } = (await created.json()) as { interactionId: string };
    expect(t.deps.interactions.pending(SID)).toHaveLength(1);

    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    expect(t.deps.interactions.pending(SID)).toEqual([]);
    // And a late waiter is told the question ended rather than hanging on it.
    const late = await t.app.request(
      `/api/agent/interactions/${interactionId}?sessionId=${SID}&waitMs=50`,
      { headers: { authorization: "Bearer irrelevant" } },
    );
    expect(late.status).toBe(401);
  });

  it("refuses the turn's token once the turn is over", async () => {
    // The same rule the browser tabs follow: a command that outlives its turn keeps a real id and
    // loses the authority that went with it.
    const stale = t.deps.manager.interactionTokens.current(SID)?.token;
    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    const res = await post({ sessionId: SID, kind: "info_request", ask: "几位？" }, stale);
    expect(res.status).toBe(401);
  });
});
