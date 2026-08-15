/**
 * `GET /api/sessions/browser-tasks` — the authority the desktop shell reconciles against.
 *
 * The shell's in-app browser gives a *task* — one turn of a conversation — permission to open and
 * drive tabs, and takes it away when the turn ends. Neither fact may come from the renderer: a
 * stale frame asserting "this turn is running" is exactly the authority a leftover background
 * command is reaching for. So the shell polls this route instead, and everything about its contract
 * matters to something concrete on the other side.
 *
 * Three properties are load-bearing here:
 *
 *   - **Access control.** The answer names which Agent a conversation belongs to, and the shell
 *     writes downloads into that Agent's scratchpad. A wrong or unauthorised mapping is a file
 *     written into someone else's directory.
 *   - **One state per requested id, always.** The shell treats a missing entry as a failed tick
 *     rather than as "nothing running", so a route that quietly dropped ids would strand a
 *     conversation's tabs — owned, locked, forever.
 *   - **Non-disclosure.** A conversation that does not exist and one the caller may not see answer
 *     identically.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, isTaskId, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-15-10-00-00-bbcc0001";
const OTHER_SID = "session-2026-08-15-10-00-00-bbcc0002";

interface BrowserTaskState {
  sessionId: string;
  projectId: string | null;
  agentId: string | null;
  running: string | null;
  lastFinished: { taskId: string; failed: boolean } | null;
}

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

function blockingSession(sessionId: string, release: Promise<void>): RuntimeSession {
  return {
    ...quickSession(sessionId),
    async *run(): AsyncGenerator<OmniMessage> {
      await release;
      yield assistantText("done");
    },
  };
}

function failingSession(sessionId: string, release: Promise<void>): RuntimeSession {
  return {
    ...quickSession(sessionId),
    async *run(): AsyncGenerator<OmniMessage> {
      await release;
      throw new Error("the turn fell over");
    },
  };
}

describe("browser task state", () => {
  let t: TestApp;
  let ownerCookie: string;
  let outsiderCookie: string;
  let row: SessionRow;

  const rowFor = (sessionId: string, projectId: string, agentId = "default_agent"): SessionRow => ({
    sessionId,
    projectId,
    agentId,
    modelId: "m1",
    provider: "custom",
    workspace: "/tmp/w",
    approvalMode: "always-ask",
    title: null,
    createdAt: new Date().toISOString(),
  });

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie: ownerCookie } = await provisionUser(t.app, "browser_owner"));
    ({ cookie: outsiderCookie } = await provisionUser(t.app, "browser_outsider"));
    row = rowFor(SID, "browser_owner-default_project");
    t.deps.sessionsRepo.insert(row);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const owner = () => apiClient(t.app, ownerCookie);
  const outsider = () => apiClient(t.app, outsiderCookie);

  const ask = async (
    client: ReturnType<typeof apiClient>,
    sessions: string[],
  ): Promise<{ status: number; sessions: BrowserTaskState[] }> => {
    const response = await client.get(
      `/api/sessions/browser-tasks?sessions=${encodeURIComponent(sessions.join(","))}`,
    );
    if (response.status !== 200) return { status: response.status, sessions: [] };
    const body = (await response.json()) as { sessions: BrowserTaskState[] };
    return { status: response.status, sessions: body.sessions };
  };

  it("names the Agent a conversation belongs to, from the index rather than from the caller", async () => {
    // This is where the shell learns which scratchpad a download goes into. It deliberately does
    // not take the project and agent from the renderer, because that triple is a relationship
    // nobody has checked.
    const { status, sessions } = await ask(owner(), [SID]);
    expect(status).toBe(200);
    expect(sessions).toEqual([
      {
        sessionId: SID,
        projectId: "browser_owner-default_project",
        agentId: "default_agent",
        running: null,
        lastFinished: null,
      },
    ]);
  });

  it("names the turn that is running", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, blockingSession(SID, blocked));
    const { taskId } = await t.deps.manager.startTask(SID, [userText("go")]);

    const { sessions } = await ask(owner(), [SID]);
    expect(sessions[0]?.running).toBe(taskId);
    expect(isTaskId(sessions[0]?.running)).toBe(true);

    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("names the turn that just finished, and says it ended cleanly", async () => {
    // How a shell that was asleep — or a window opened after the fact — learns that the tabs of a
    // turn it still believes in should be released.
    t.deps.manager.adopt(row, quickSession(SID));
    const { taskId } = await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    const { sessions } = await ask(owner(), [SID]);
    expect(sessions[0]).toMatchObject({ running: null, lastFinished: { taskId, failed: false } });
  });

  it("says when the turn ended badly, because a failure keeps its pages", async () => {
    // The four end-of-task rules turn on this bit: a failed turn's tabs are the evidence of what
    // went wrong, and closing them is the one irreversible thing the shell can do.
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, failingSession(SID, blocked));
    const { taskId } = await t.deps.manager.startTask(SID, [userText("go")]);
    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    const { sessions } = await ask(owner(), [SID]);
    expect(sessions[0]).toMatchObject({ running: null, lastFinished: { taskId, failed: true } });
  });

  it("answers about a conversation it has never heard of, without saying so", async () => {
    // An answer, not an omission: the shell reads a missing entry as a broken tick and applies
    // nothing, so a silent drop would strand every conversation in that batch.
    const { sessions } = await ask(owner(), ["session-2026-08-15-10-00-00-0000dead"]);
    expect(sessions).toEqual([
      {
        sessionId: "session-2026-08-15-10-00-00-0000dead",
        projectId: null,
        agentId: null,
        running: null,
        lastFinished: null,
      },
    ]);
  });

  it("answers about someone else's conversation exactly as it answers about a missing one", async () => {
    // Not a 404 and not a different shape: the two must be indistinguishable, or the route becomes
    // a way to ask whether a given conversation id exists.
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, blockingSession(SID, blocked));
    await t.deps.manager.startTask(SID, [userText("go")]);

    const mine = await ask(outsider(), [SID]);
    const missing = await ask(outsider(), ["session-2026-08-15-10-00-00-0000beef"]);
    expect(mine.sessions[0]).toEqual({
      sessionId: SID,
      projectId: null,
      agentId: null,
      running: null,
      lastFinished: null,
    });
    expect({ ...missing.sessions[0], sessionId: SID }).toEqual(mine.sessions[0]);

    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("answers about every conversation asked for, in order, once each", async () => {
    t.deps.sessionsRepo.insert(rowFor(OTHER_SID, "browser_owner-default_project"));
    const { sessions } = await ask(owner(), [OTHER_SID, SID, OTHER_SID]);
    // Deduplicated, because the answer is a set: a repeated id would otherwise produce two states
    // for one conversation, and a reconcile reading both would revoke the turn it just confirmed.
    expect(sessions.map((state) => state.sessionId)).toEqual([OTHER_SID, SID]);
  });

  it("refuses a query naming more conversations than it will answer about", async () => {
    // Truncating instead would hand back a *wrong* answer rather than a shorter one, and the caller
    // cannot tell the difference. The shell asks in batches for exactly this reason.
    const many = Array.from(
      { length: 101 },
      (_, index) => `session-2026-08-15-10-00-00-${String(index).padStart(8, "0")}`,
    );
    const { status } = await ask(owner(), many);
    expect(status).toBe(400);
  });

  it("answers a query at the limit", async () => {
    const many = Array.from(
      { length: 100 },
      (_, index) => `session-2026-08-15-10-00-00-${String(index).padStart(8, "0")}`,
    );
    const { status, sessions } = await ask(owner(), many);
    expect(status).toBe(200);
    expect(sessions).toHaveLength(100);
  });

  it("answers an empty query with an empty list", async () => {
    const { status, sessions } = await ask(owner(), []);
    expect(status).toBe(200);
    expect(sessions).toEqual([]);
  });

  it("is not reachable without a session cookie", async () => {
    // The shell reaches this over the window's own authenticated session, which is what makes it
    // work whether the shell spawned the server or attached to one already running.
    const response = await t.app.request(`/api/sessions/browser-tasks?sessions=${SID}`);
    expect(response.status).toBe(401);
  });
});
