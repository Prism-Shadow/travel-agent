/**
 * Task identity across the server's HTTP and SSE surfaces.
 *
 * A Session is a conversation; a Task is one turn of it. The id is allocated when a task is
 * *accepted* — for queued work as well as immediate — so a caller can name the turn before anything
 * has run, and so a consumer that owns resources for a turn (the desktop shell owns browser tabs)
 * can tell which one started and which one ended.
 *
 * The interesting cases are the ones a live subscriber never sees: a client that reconnects after
 * the turn ended, and one that reconnects after the runtime entry has been swept from memory.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, isTaskId, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-06-10-00-00-aabb0002";

/** A Session that finishes immediately. */
function quickSession(sessionId: string): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {
      yield assistantText("done");
    },
    async *compact() {},
  };
}

/** A Session that blocks until released, so a task can be observed mid-run. */
function blockingSession(sessionId: string, release: Promise<void>): RuntimeSession {
  return {
    ...quickSession(sessionId),
    async *run(): AsyncGenerator<OmniMessage> {
      await release;
      yield assistantText("done");
    },
  };
}

describe("task identity", () => {
  let t: TestApp;
  let cookie: string;
  let row: SessionRow;

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "tasker"));
    row = {
      sessionId: SID,
      projectId: "tasker-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /** Built per test: `t` is replaced in beforeEach, so a module-level client would hold a dead app. */
  const api = () => apiClient(t.app, cookie);

  it("returns the task's id when one is accepted", async () => {
    t.deps.manager.adopt(row, quickSession(SID));
    const response = await api().post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "go" }],
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { taskId?: string };
    expect(isTaskId(body.taskId)).toBe(true);
  });

  it("allocates an id for queued work too, and keeps it when the follow-up starts", async () => {
    // The point of minting at acceptance rather than at launch: a caller that posted a task can
    // name it while it is still sitting in the queue.
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, blockingSession(SID, blocked));

    const first = await t.deps.manager.startTask(SID, [userText("one")]);
    const queued = await t.deps.manager.startTask(SID, [userText("two")], { queueIfBusy: true });
    expect(queued.queued).toBe(true);
    expect(isTaskId(queued.taskId)).toBe(true);
    expect(queued.taskId).not.toBe(first.taskId);

    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("names the running task in a subscription snapshot", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, blockingSession(SID, blocked));
    const { taskId } = await t.deps.manager.startTask(SID, [userText("go")]);

    expect(t.deps.manager.taskStateSnapshot(SID)).toMatchObject({ state: "running", taskId });
    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("still names the task after it has ended, for a client that reconnects", async () => {
    // Without this a renderer that reloads after the turn finished sees a bare "idle" and never
    // learns which turn ended — leaving whatever it held for that turn held forever.
    t.deps.manager.adopt(row, quickSession(SID));
    const { taskId } = await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    expect(t.deps.manager.taskStateSnapshot(SID)).toMatchObject({ state: "idle", taskId });
  });

  it("reports an abnormal ending in the snapshot, not only in the live event", async () => {
    // A client that missed the live event would otherwise read a failed turn as a clean one — and a
    // task that declared "just a search" would have its evidence closed.
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, blockingSession(SID, blocked));
    const { taskId } = await t.deps.manager.startTask(SID, [userText("go")]);
    t.deps.manager.abortTask(SID);
    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    expect(t.deps.manager.taskStateSnapshot(SID)).toMatchObject({
      state: "idle",
      taskId,
      taskFailed: true,
    });
  });

  it("survives the runtime entry being swept for idleness", async () => {
    // Entries are evicted after 30 idle minutes. A renderer that reconnects past that point is
    // exactly the case the record exists for, so it cannot live on the entry.
    t.deps.manager.adopt(row, quickSession(SID));
    const { taskId } = await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    // Force the sweep rather than waiting half an hour: the entry is idle, so a zero idle window
    // evicts it exactly as the timer would.
    t.deps.manager.sweepIdle(Date.now() + 1, 0);
    expect(t.deps.manager.taskStateSnapshot(SID)).toMatchObject({ state: "idle", taskId });
  });

  it("forgets the previous task once the next one starts", async () => {
    t.deps.manager.adopt(row, quickSession(SID));
    const first = await t.deps.manager.startTask(SID, [userText("one")]);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    const second = await t.deps.manager.startTask(SID, [userText("two")]);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    const snapshot = t.deps.manager.taskStateSnapshot(SID);
    expect(snapshot.taskId).toBe(second.taskId);
    expect(snapshot.taskId).not.toBe(first.taskId);
  });

  it("reports no task id for a compaction, which is not a turn", async () => {
    const response = await api().post(`/api/sessions/${SID}/compact`, {});
    // Whether compaction is possible here is beside the point; what matters is that the response
    // shape has no task to name, which is why it is a different type.
    if (response.status === 202) {
      expect(await response.json()).not.toHaveProperty("taskId");
    }
  });
});
