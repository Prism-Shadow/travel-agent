/**
 * The main-process task supervisor (src/task-supervisor.ts).
 *
 * This is the thing that replaced a renderer-side watcher, and the reason is worth restating: the
 * chat page holds one session stream and drops it when the route changes, so a turn that finished
 * after the user opened another conversation reported nothing and its tabs stayed owned forever. A
 * reload took the bookkeeping with it. A dropped message was gone.
 *
 * So what is tested here is not delivery but *convergence*: given what the server says, the same
 * answer is applied however many times it is asked for, a failed ask changes nothing, and an ask
 * that arrives mid-flight is answered about the conversations it cares about rather than about
 * whichever ones happened to be interesting when the request went out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  batchSessions,
  MAX_SESSIONS_PER_QUERY,
  parseBrowserTaskState,
  reconcileTasks,
  TaskSupervisor,
} from "../src/task-supervisor.js";
import type { SessionTaskState } from "../src/task-supervisor.js";

function state(
  sessionId: string,
  running: string | null,
  lastFinished: { taskId: string; failed: boolean } | null = null,
): SessionTaskState {
  return { sessionId, projectId: "project-1", agentId: "agent-1", running, lastFinished };
}

/** A supervisor wired to a scripted server, with every applied answer recorded. */
function harness(options: {
  answer: (sessions: string[]) => Promise<SessionTaskState[]>;
  interest: () => string[];
  intervalMs?: number;
}) {
  const applied: SessionTaskState[][] = [];
  const asked: string[][] = [];
  const supervisor = new TaskSupervisor({
    fetchState: async (sessions) => {
      asked.push([...sessions]);
      return options.answer(sessions);
    },
    sessionsOfInterest: options.interest,
    apply: (states) => applied.push(states),
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
  });
  return { supervisor, applied, asked };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("reconcileTasks", () => {
  it("ends a turn the server no longer reports running", () => {
    const believed = new Map([["task-a", "session-1"]]);
    const { live, ended } = reconcileTasks(believed, [
      state("session-1", null, { taskId: "task-a", failed: false }),
    ]);
    expect(live).toEqual([]);
    expect(ended).toEqual([{ taskId: "task-a", failed: false }]);
  });

  it("carries how the turn ended, so a failure keeps its pages", () => {
    const believed = new Map([["task-a", "session-1"]]);
    const { ended } = reconcileTasks(believed, [
      state("session-1", null, { taskId: "task-a", failed: true }),
    ]);
    expect(ended).toEqual([{ taskId: "task-a", failed: true }]);
  });

  it("ends the previous turn when a new one takes its place", () => {
    const believed = new Map([["task-a", "session-1"]]);
    const { live, ended } = reconcileTasks(believed, [
      state("session-1", "task-b", { taskId: "task-a", failed: false }),
    ]);
    expect(live).toEqual([{ sessionId: "session-1", taskId: "task-b" }]);
    expect(ended).toEqual([{ taskId: "task-a", failed: false }]);
  });

  it("leaves other conversations' turns alone", () => {
    const believed = new Map([
      ["task-a", "session-1"],
      ["task-b", "session-2"],
    ]);
    const { ended } = reconcileTasks(believed, [state("session-1", null)]);
    expect(ended).toEqual([{ taskId: "task-a", failed: false }]);
  });

  it("ends the turns of a conversation the server no longer knows", () => {
    // A deleted Session answers with nothing running and no project. Its turn is over by any
    // reading, and leaving it live would hold the backend switch shut for good.
    const believed = new Map([["task-a", "session-gone"]]);
    const { ended } = reconcileTasks(believed, [
      {
        sessionId: "session-gone",
        projectId: null,
        agentId: null,
        running: null,
        lastFinished: null,
      },
    ]);
    expect(ended).toEqual([{ taskId: "task-a", failed: false }]);
  });
});

describe("TaskSupervisor", () => {
  it("ends a turn with no renderer involved at all", async () => {
    let running: string | null = "task-a";
    const { supervisor, applied } = harness({
      interest: () => ["session-1"],
      answer: async () => [
        state("session-1", running, running ? null : { taskId: "task-a", failed: false }),
      ],
    });

    await supervisor.reconcile();
    expect(applied.at(-1)).toEqual([state("session-1", "task-a")]);

    running = null;
    await supervisor.reconcile();
    expect(applied.at(-1)).toEqual([state("session-1", null, { taskId: "task-a", failed: false })]);
  });

  it("applies nothing when the server cannot be reached, and asks again next time", async () => {
    // The failure mode this shape exists to prevent: treating "we could not ask" as "nothing is
    // running" releases the tabs of every turn in progress. A tick that fails must change nothing.
    let attempt = 0;
    const { supervisor, applied } = harness({
      interest: () => ["session-1"],
      answer: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("ECONNREFUSED");
        return [state("session-1", "task-a")];
      },
    });

    await supervisor.reconcile();
    expect(applied).toEqual([]);

    await supervisor.reconcile();
    expect(applied).toEqual([[state("session-1", "task-a")]]);
  });

  it("answers a caller about the conversation it asked about, not the one in flight", async () => {
    // The race: a tick goes out while only conversation A has tabs, so it asks about A alone. A
    // turn then starts in B and its first `tabs.open()` waits for a refresh. Joining the tick
    // already in flight returns an answer that says nothing about B — and the tab is refused as
    // not-live while the server has had it running the whole time. A false refusal reads to the
    // agent as "your turn is over", so it is worse than a wait.
    let interest = ["session-a"];
    let release: (() => void) | null = null;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    const { supervisor, applied, asked } = harness({
      interest: () => [...interest],
      answer: async (sessions) => {
        call += 1;
        if (call === 1) await first;
        return sessions.map((sessionId) =>
          sessionId === "session-b" ? state("session-b", "task-b") : state("session-a", "task-a"),
        );
      },
    });

    const stale = supervisor.reconcile();
    // Now B becomes interesting and somebody needs the truth about it.
    interest = ["session-a", "session-b"];
    const asking = supervisor.reconcile();

    release!();
    await stale;
    await asking;

    expect(asked[0]).toEqual(["session-a"]);
    expect(asked[1]).toEqual(["session-a", "session-b"]);
    expect(applied.at(-1)).toEqual([state("session-a", "task-a"), state("session-b", "task-b")]);
  });

  it("runs one follow-up however many callers arrive during a tick", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    const { supervisor, asked } = harness({
      interest: () => ["session-1"],
      answer: async () => {
        call += 1;
        if (call === 1) await gate;
        return [state("session-1", "task-a")];
      },
    });

    const inFlight = supervisor.reconcile();
    const waiters = [supervisor.reconcile(), supervisor.reconcile(), supervisor.reconcile()];
    release!();
    await inFlight;
    await Promise.all(waiters);

    expect(asked).toHaveLength(2);
  });

  it("defers a hint that lands inside the rate limit instead of dropping it", async () => {
    // A hint arriving just after a tick is the one that matters most — it is how the shell hears
    // about a turn that started a moment ago. Dropping it made that conversation wait out the full
    // poll interval for something it had already been told about.
    vi.useFakeTimers();
    const { supervisor, asked } = harness({
      interest: () => ["session-1"],
      answer: async () => [state("session-1", "task-a")],
      intervalMs: 60_000,
    });

    await supervisor.reconcile();
    expect(asked).toHaveLength(1);

    supervisor.prompt();
    supervisor.prompt();
    expect(asked).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(asked).toHaveLength(2);
    supervisor.stop();
  });

  it("asks nothing when the pane holds no conversations", async () => {
    const { supervisor, asked } = harness({ interest: () => [], answer: async () => [] });
    await supervisor.reconcile();
    expect(asked).toEqual([]);
  });

  it("stops asking once stopped", async () => {
    vi.useFakeTimers();
    const { supervisor, asked } = harness({
      interest: () => ["session-1"],
      answer: async () => [state("session-1", "task-a")],
      intervalMs: 100,
    });
    supervisor.start();
    await vi.advanceTimersByTimeAsync(250);
    const before = asked.length;
    expect(before).toBeGreaterThan(1);
    supervisor.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(asked).toHaveLength(before);
  });
});

describe("stopping", () => {
  it("does not apply an answer that arrives after the window has gone", async () => {
    // A window closing stops the supervisor and destroys the pane, but a request already in flight
    // resolves afterwards. Applying it would reach into a destroyed pane — or into the pane of the
    // window that replaced it, with an answer about the conversations the old one cared about.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { supervisor, applied } = harness({
      interest: () => ["session-1"],
      answer: async () => {
        await gate;
        return [state("session-1", "task-a")];
      },
    });

    const inFlight = supervisor.reconcile();
    supervisor.stop();
    release!();
    await inFlight;

    expect(applied).toEqual([]);
  });

  it("drops a hint that was waiting out the rate limit", async () => {
    vi.useFakeTimers();
    const { supervisor, asked } = harness({
      interest: () => ["session-1"],
      answer: async () => [state("session-1", "task-a")],
      intervalMs: 60_000,
    });
    await supervisor.reconcile();
    supervisor.prompt();
    supervisor.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(asked).toHaveLength(1);
  });
});

describe("parseBrowserTaskState", () => {
  const asked = ["session-1", "session-2"];
  const answer = (sessionId: string, extra: Record<string, unknown> = {}) => ({
    sessionId,
    projectId: "p1",
    agentId: "a1",
    running: null,
    lastFinished: null,
    ...extra,
  });

  it("reads an answer that covers exactly what was asked", () => {
    expect(
      parseBrowserTaskState(
        {
          sessions: [
            answer("session-1", {
              running: "task-a",
              lastFinished: { taskId: "task-old", failed: true },
            }),
            answer("session-2"),
          ],
        },
        asked,
      ),
    ).toEqual([
      {
        sessionId: "session-1",
        projectId: "p1",
        agentId: "a1",
        running: "task-a",
        lastFinished: { taskId: "task-old", failed: true },
      },
      { sessionId: "session-2", projectId: "p1", agentId: "a1", running: null, lastFinished: null },
    ]);
  });

  it("reads a conversation the server does not know, or will not show", () => {
    // Unknown and not-yours answer identically — a null owner, nothing running — so the shell can
    // tell a complete answer from a partial one without being told which of the two it was. Its
    // turns are then ended by the reconcile, which is right either way.
    expect(
      parseBrowserTaskState(
        {
          sessions: [
            {
              sessionId: "session-1",
              projectId: null,
              agentId: null,
              running: null,
              lastFinished: null,
            },
            answer("session-2"),
          ],
        },
        asked,
      )[0],
    ).toEqual({
      sessionId: "session-1",
      projectId: null,
      agentId: null,
      running: null,
      lastFinished: null,
    });
  });

  it("refuses an answer that leaves a conversation out", () => {
    // A server bug would otherwise strand that conversation: its turns are never reconciled, its
    // tabs stay owned, and the backend switch stays shut for the life of the window.
    expect(() => parseBrowserTaskState({ sessions: [answer("session-1")] }, asked)).toThrow(
      /said nothing about session-2/,
    );
  });

  it("refuses an answer that names a conversation twice", () => {
    // "A is running" plus "A is idle" in one tick produces a live task *and* an ended one from the
    // same answer, revoking the turn it just confirmed.
    expect(() =>
      parseBrowserTaskState(
        {
          sessions: [
            answer("session-1", { running: "task-a" }),
            answer("session-1"),
            answer("session-2"),
          ],
        },
        asked,
      ),
    ).toThrow(/twice/);
  });

  it("refuses an answer about a conversation nobody asked about", () => {
    expect(() =>
      parseBrowserTaskState(
        { sessions: [answer("session-1"), answer("session-2"), answer("session-9")] },
        asked,
      ),
    ).toThrow(/not asked about/);
  });

  it.each([
    ["a body that is not an object", "nope"],
    ["a body with no sessions array", { ok: true }],
    ["a sessions field that is not an array", { sessions: { "session-1": null } }],
    ["an entry that is not an object", { sessions: ["session-1"] }],
    ["an entry with no conversation", { sessions: [{ running: null }] }],
    [
      "an empty running id",
      {
        sessions: [
          { sessionId: "session-1", projectId: "p", agentId: "a", running: "", lastFinished: null },
        ],
      },
    ],
    [
      "a running id that is not a string",
      {
        sessions: [
          { sessionId: "session-1", projectId: "p", agentId: "a", running: 7, lastFinished: null },
        ],
      },
    ],
    [
      "a missing running field",
      { sessions: [{ sessionId: "session-1", projectId: "p", agentId: "a", lastFinished: null }] },
    ],
    [
      "an owner given only in half",
      {
        sessions: [
          {
            sessionId: "session-1",
            projectId: "p",
            agentId: null,
            running: null,
            lastFinished: null,
          },
        ],
      },
    ],
    [
      "a last-finished turn with no outcome",
      {
        sessions: [
          {
            sessionId: "session-1",
            projectId: "p",
            agentId: "a",
            running: null,
            lastFinished: { taskId: "t" },
          },
        ],
      },
    ],
    [
      "a last-finished turn with no id",
      {
        sessions: [
          {
            sessionId: "session-1",
            projectId: "p",
            agentId: "a",
            running: null,
            lastFinished: { failed: false },
          },
        ],
      },
    ],
    [
      "an over-long identifier",
      {
        sessions: [
          {
            sessionId: "session-1",
            projectId: "p",
            agentId: "a",
            running: "x".repeat(300),
            lastFinished: null,
          },
        ],
      },
    ],
  ])("refuses %s rather than reading it as nothing running", (_label, body) => {
    // The asymmetry that makes this fail closed: an answer read as "nothing is running" *ends*
    // turns. Anything not fully understood must throw, so the tick changes nothing.
    expect(() => parseBrowserTaskState(body, ["session-1"])).toThrow();
  });
});

describe("batchSessions", () => {
  it("asks about everything, in batches the server will answer in full", () => {
    // The pane holds tabs across as many conversations as the user has visited; the server refuses
    // a query naming more than it will answer about. Without batching, a shell with 101 live
    // conversations would fail *every* reconcile — and no task could ever end.
    const many = Array.from({ length: 250 }, (_, index) => `session-${index}`);
    const batches = batchSessions(many);
    expect(batches).toHaveLength(3);
    expect(batches.every((batch) => batch.length <= MAX_SESSIONS_PER_QUERY)).toBe(true);
    expect(batches.flat()).toEqual(many);
  });

  it("asks about each conversation once", () => {
    expect(batchSessions(["a", "b", "a", "", "b"])).toEqual([["a", "b"]]);
  });

  it("asks nothing when there is nothing to ask about", () => {
    expect(batchSessions([])).toEqual([]);
  });
});

describe("a shell holding more conversations than one query allows", () => {
  it("reconciles all of them, and applies nothing if any batch fails", async () => {
    const many = Array.from({ length: 150 }, (_, index) => `session-${index}`);
    const applied: SessionTaskState[][] = [];
    const asked: string[][] = [];
    let failBatch = -1;
    const supervisor = new TaskSupervisor({
      // Stands in for main's batching fetch: one request per batch, each validated on its own.
      fetchState: async (sessions) => {
        const states: SessionTaskState[] = [];
        for (const [index, batch] of batchSessions(sessions).entries()) {
          asked.push(batch);
          if (index === failBatch) throw new Error("the server answered 400");
          states.push(
            ...parseBrowserTaskState(
              {
                sessions: batch.map((sessionId) => ({
                  sessionId,
                  projectId: "p1",
                  agentId: "a1",
                  running: null,
                  lastFinished: null,
                })),
              },
              batch,
            ),
          );
        }
        return states;
      },
      sessionsOfInterest: () => many,
      apply: (states) => applied.push(states),
    });

    await supervisor.reconcile();
    expect(asked).toHaveLength(2);
    expect(applied.at(-1)).toHaveLength(150);

    // A batch that fails takes the whole tick with it: a partial answer would read as "these
    // conversations have nothing running", which ends turns that are still going.
    failBatch = 1;
    asked.length = 0;
    await supervisor.reconcile();
    expect(applied).toHaveLength(1);
  });
});
