/**
 * Who is allowed to drive the in-app browser, decided in the main process.
 *
 * A tab is opened by a *task* — one turn of a conversation — and stops being writable when that turn
 * ends. Both facts have to be known here, in the process that owns the tabs, and neither can come
 * from the renderer:
 *
 *   - The chat page holds one session stream and disposes it when the route changes, so a task that
 *     finished after the user opened another conversation reported nothing. Its tabs stayed owned
 *     and its locks stayed shut until somebody wandered back.
 *   - A renderer reload takes any renderer-side bookkeeping with it, so whatever was being watched
 *     simply stops being watched.
 *   - And a single "this task is running" message from the renderer is not evidence. The renderer is
 *     the app's own window, but a *stale* frame — a replayed event, a reload racing a switch — would
 *     be enough to re-authorise a turn that ended long ago, which is exactly the authority a
 *     leftover background command is trying to reuse.
 *
 * So this is a **reconcile loop against the server**, which is the only authority on what is
 * running. It polls `GET /api/sessions/browser-tasks` — authenticated by the window's own session
 * cookie, so a shell that spawned the server and one that attached to a running instance take the
 * same path — for the conversations the pane actually holds tabs for, and applies the answer: a turn the server calls running is live, a
 * turn that was live and is not any more has ended, and everything else is refused.
 *
 * Reconciliation rather than delivery is what makes it durable. There is no queue to lose, no
 * acknowledgement to miss and no retry to schedule: a tick that fails changes nothing, and the next
 * one applies the same truth again. A renderer reload, a route switch, a dropped IPC and a server
 * restart all converge the same way — by asking again.
 */

/** What the shell needs to know about one conversation. */
export interface SessionTaskState {
  sessionId: string;
  /** Null when the Session is unknown to the server (deleted, or never existed). */
  projectId: string | null;
  agentId: string | null;
  /** The turn running right now, if any. */
  running: string | null;
  /** The turn that finished most recently, and whether it ended badly. */
  lastFinished: { taskId: string; failed: boolean } | null;
}

export interface TaskSupervisorOptions {
  /**
   * Asks the server about these conversations.
   *
   * Injected so the loop can be driven deterministically in a test; in the shell it is an
   * authenticated request to the embedded server.
   */
  fetchState: (sessionIds: string[]) => Promise<SessionTaskState[]>;
  /** Which conversations matter right now — the ones the pane holds tabs or pending work for. */
  sessionsOfInterest: () => string[];
  /** Applies the reconciled truth. Idempotent: it is called with the same answer repeatedly. */
  apply: (states: SessionTaskState[]) => void;
  /** How often to reconcile with no prompting. */
  intervalMs?: number;
  log?: (message: string) => void;
}

/** Default reconcile cadence. Frequent enough that a finished turn's tabs are released promptly. */
const DEFAULT_INTERVAL_MS = 3_000;

/** Shortest gap between prompted reconciles, so a burst of hints cannot become a request storm. */
const MIN_PROMPTED_GAP_MS = 250;

export class TaskSupervisor {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  private trailing: NodeJS.Timeout | null = null;
  private lastRunAt = 0;
  private stopped = false;

  constructor(private readonly options: TaskSupervisorOptions) {}

  start(): void {
    this.stopped = false;
    this.schedule();
    void this.reconcile();
  }

  private schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setInterval(
      () => void this.reconcile(),
      this.options.intervalMs ?? DEFAULT_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  /**
   * Asks the server and applies the answer.
   *
   * Resolves only once an answer has been applied that was **asked for after this call** — which is
   * why a caller arriving mid-tick does not simply join the tick in progress. The list of
   * conversations is snapshotted when a request goes out, so a tick that started while only
   * conversation A had tabs is asking about A alone; a tab being opened for a turn in B would await
   * it, learn nothing about B, and be refused as not-live while the server had it running all
   * along. A false refusal is worse than a wait: the agent reads it as its turn having ended.
   *
   * So an in-flight tick is chained rather than shared, and everyone who arrives during it waits on
   * that same follow-up — one extra request no matter how many callers, and never a stale answer.
   */
  async reconcile(): Promise<void> {
    if (!this.inFlight) return this.runTick();
    if (!this.queued) {
      this.queued = this.inFlight
        .catch(() => {})
        .then(() => {
          this.queued = null;
          return this.runTick();
        });
    }
    return this.queued;
  }

  /** One request-and-apply, with the conversations snapshotted as it goes out. */
  private runTick(): Promise<void> {
    const sessions = [...new Set(this.options.sessionsOfInterest())].filter(Boolean);
    if (sessions.length === 0) {
      this.lastRunAt = Date.now();
      return Promise.resolve();
    }

    this.inFlight = (async () => {
      try {
        const states = await this.options.fetchState(sessions);
        // Checked *after* the await, not only before it. A window closing stops the supervisor and
        // destroys the pane, but a request already in flight resolves afterwards — and applying it
        // would reach into a destroyed pane, or, worse, into the pane of the window that replaced
        // it, with an answer about the conversations the old one cared about.
        if (this.stopped) return;
        this.options.apply(states);
      } catch (error) {
        // A failed tick changes nothing and the next one asks again. Refusing to apply a *partial*
        // answer is the point: treating an unreachable server as "nothing is running" would release
        // the tabs of every turn still in progress.
        this.options.log?.(`[iab] could not reconcile task state: ${(error as Error).message}\n`);
      } finally {
        this.lastRunAt = Date.now();
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /**
   * A hint that something changed — the renderer saw a turn start, a tab was opened.
   *
   * Only a hint: it brings the next reconcile forward, and the answer still comes from the server.
   * Rate-limited so a chatty renderer cannot become a request per event — but a hint inside the
   * limit is **deferred, not dropped**. Dropping it loses the one event that mattered whenever it
   * lands just after a tick, and the conversation then waits out the full poll interval for
   * something it had already been told about.
   */
  prompt(): void {
    if (this.stopped) return;
    const since = Date.now() - this.lastRunAt;
    if (since >= MIN_PROMPTED_GAP_MS) {
      void this.reconcile();
      return;
    }
    if (this.trailing) return;
    this.trailing = setTimeout(() => {
      this.trailing = null;
      if (!this.stopped) void this.reconcile();
    }, MIN_PROMPTED_GAP_MS - since);
    this.trailing.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.trailing) {
      clearTimeout(this.trailing);
      this.trailing = null;
    }
  }
}

/**
 * The reconcile step itself, kept pure.
 *
 * Given what was believed and what the server says, produces the tasks to mark live and the tasks
 * that have ended. Separated from the loop because this is where the rules are — a turn that
 * disappears from the running set has ended, and an unknown Session ends everything it held — and
 * those deserve to be asserted without a timer or a socket in the way.
 */
export function reconcileTasks(
  believed: ReadonlyMap<string, string>,
  states: readonly SessionTaskState[],
): {
  live: Array<{ sessionId: string; taskId: string }>;
  ended: Array<{ taskId: string; failed: boolean }>;
} {
  const live: Array<{ sessionId: string; taskId: string }> = [];
  const ended: Array<{ taskId: string; failed: boolean }> = [];

  for (const state of states) {
    if (state.running) live.push({ sessionId: state.sessionId, taskId: state.running });

    for (const [taskId, sessionId] of believed) {
      if (sessionId !== state.sessionId) continue;
      if (taskId === state.running) continue;
      // It was running and is not any more. `lastFinished` says how it went when it is about this
      // task; when it is about some later one — or the Session is gone — the turn still ended, and
      // the conservative reading keeps its pages.
      const failed = state.lastFinished?.taskId === taskId ? state.lastFinished.failed : false;
      ended.push({ taskId, failed });
    }
  }

  return { live, ended };
}

/**
 * Reads the server's answer, refusing anything it does not fully understand.
 *
 * Fails closed, and the reason is asymmetric: an answer read as "nothing is running" *ends* turns.
 * A body with a missing or malformed `sessions` array — a proxy's error page, a truncated response,
 * a future server that renamed the field — must not become an empty list, because an empty list is
 * a positive statement that every turn in progress has finished. Throwing means the tick changes
 * nothing and the next one asks again.
 *
 * The contract is **exactly one state per requested conversation**, including the ones the server
 * does not know or will not show, which answer with a null owner and nothing running. So this
 * checks the *set*, not just the shapes:
 *
 *   - a **missing** entry would leave that conversation's turns unreconciled forever, and the tabs
 *     of a turn that has since ended would stay owned with the backend switch held shut;
 *   - a **duplicate** is worse than useless — "A running" plus "A idle" produces a live task and an
 *     ended one from the same tick, which revokes the turn it just confirmed;
 *   - an **extra** would reconcile a conversation this tick never asked about, and could end turns
 *     outside the set the caller is holding open.
 */
export function parseBrowserTaskState(body: unknown, asked: string[]): SessionTaskState[] {
  if (!body || typeof body !== "object")
    throw new Error("the server's task state was not an object");
  const sessions = (body as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions))
    throw new Error("the server's task state carried no sessions array");

  const requested = new Set(asked);
  const seen = new Set<string>();
  const states = sessions.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("the server's task state contained an entry that was not an object");
    }
    const record = entry as Record<string, unknown>;
    const sessionId = requireId(record.sessionId, "conversation");
    if (!requested.has(sessionId)) {
      throw new Error(
        `the server's task state named a conversation that was not asked about: ${sessionId}`,
      );
    }
    if (seen.has(sessionId)) {
      throw new Error(`the server's task state named ${sessionId} twice`);
    }
    seen.add(sessionId);

    const running =
      record.running === null ? null : requireId(record.running, `running task for ${sessionId}`);

    // Both or neither. One without the other is a half-answer about which Agent owns the
    // conversation, and that answer decides where its downloads are written.
    const projectId =
      record.projectId === null ? null : requireId(record.projectId, `project for ${sessionId}`);
    const agentId =
      record.agentId === null ? null : requireId(record.agentId, `agent for ${sessionId}`);
    if ((projectId === null) !== (agentId === null)) {
      throw new Error(`the server's task state for ${sessionId} named only half of its owner`);
    }

    let lastFinished: { taskId: string; failed: boolean } | null = null;
    if (record.lastFinished !== null) {
      const shape = record.lastFinished;
      if (!shape || typeof shape !== "object" || Array.isArray(shape)) {
        throw new Error(
          `the server's task state for ${sessionId} had a malformed last-finished turn`,
        );
      }
      const finished = shape as Record<string, unknown>;
      if (typeof finished.failed !== "boolean") {
        throw new Error(
          `the server's task state for ${sessionId} did not say how its last turn ended`,
        );
      }
      lastFinished = {
        taskId: requireId(finished.taskId, `last finished task for ${sessionId}`),
        failed: finished.failed,
      };
    }

    return { sessionId, projectId, agentId, running, lastFinished };
  });

  for (const sessionId of requested) {
    if (!seen.has(sessionId)) {
      throw new Error(`the server's task state said nothing about ${sessionId}`);
    }
  }
  return states;
}

/** Longest identifier the shell will read from the server. Far above anything the app mints. */
const MAX_IDENTIFIER_LENGTH = 256;

/** A non-empty, bounded identifier — or an error naming what was wrong with it. */
function requireId(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`the server's task state had a malformed ${what}`);
  }
  return value;
}

/**
 * Splits a set of conversations into batches the server will answer in full.
 *
 * The server refuses a query naming more than it will answer about, rather than truncating it —
 * and the shell holds tabs across as many conversations as the user has visited, which has no
 * matching bound. Asking in batches is what keeps "exactly one state per conversation" true; the
 * caller merges the batches and applies nothing unless every one of them came back.
 */
export function batchSessions(sessionIds: string[], size = MAX_SESSIONS_PER_QUERY): string[][] {
  const unique = [...new Set(sessionIds)].filter(Boolean);
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    batches.push(unique.slice(index, index + size));
  }
  return batches;
}

/** Matches the server's own cap on one browser-task query. */
export const MAX_SESSIONS_PER_QUERY = 100;
