/**
 * Who is driving each browser session right now, on the executor's side.
 *
 * The machine itself lives in `@travel-agent/transaction` (pure, and tested there). This module is
 * the part that has to exist *here*: the state has to be readable by the code that is about to
 * click something, and that code runs in the relay process, per session, with no access to the
 * conversation.
 *
 * Two things it adds to the pure machine:
 *
 * - **Per session.** One relay serves several conversations at once; a handover in one must not
 *   stop another's agent from working.
 * - **A drain that means something.** `handing_over` is not a formality: at the moment the person
 *   takes the page, the executor may have an `await page.click()` in flight. In-flight writes are
 *   counted here, and the handover waits for them (bounded by `HANDOVER_DRAIN_MS`) before the
 *   person is told the page is theirs. Without the count the state would say "drained" while a
 *   click was still travelling.
 */
import {
  applyHandoverEvent,
  refuseIfNotPermitted,
  HANDOVER_DRAIN_MS,
  INITIAL_HANDOVER,
  type ControlRefusal,
  type HandoverEvent,
  type HandoverSnapshot,
} from '@travel-agent/transaction'

/** An operation refused because of who currently holds the page. */
export class ControlRefusedError extends Error {
  readonly code: ControlRefusal['code']

  constructor(refusal: ControlRefusal) {
    super(`${refusal.code}: ${refusal.message}`)
    this.name = 'ControlRefusedError'
    this.code = refusal.code
  }
}

interface SessionControl {
  snapshot: HandoverSnapshot
  /** Writes that have been let through and have not returned yet. */
  inFlightWrites: number
}

const sessions = new Map<string, SessionControl>()

function stateOf(sessionId: string): SessionControl {
  const existing = sessions.get(sessionId)
  if (existing) return existing
  const created: SessionControl = { snapshot: { ...INITIAL_HANDOVER }, inFlightWrites: 0 }
  sessions.set(sessionId, created)
  return created
}

/** The current control state of one session. */
export function controlSnapshot(sessionId: string): HandoverSnapshot {
  return stateOf(sessionId).snapshot
}

/** Applies an event to one session's machine; illegal transitions throw, as they do in the model. */
export function applyControlEvent(sessionId: string, event: HandoverEvent): HandoverSnapshot {
  const state = stateOf(sessionId)
  state.snapshot = applyHandoverEvent(state.snapshot, event)
  return state.snapshot
}

/** Forgets a session's control state (the session was deleted or reset). */
export function forgetControl(sessionId: string): void {
  sessions.delete(sessionId)
}

/** Test seam: clears every session's control state. */
export function resetControlForTests(): void {
  sessions.clear()
}

/**
 * Refuses an operation the current state does not allow, or lets it through.
 *
 * Throws rather than returning a value, and the error carries a code the agent can act on: this is
 * called from inside wrapped Playwright methods, where the only channel back to the caller is the
 * rejection it already has to handle.
 */
export function assertMayOperate(sessionId: string, operation: 'read' | 'write'): void {
  const refusal = refuseIfNotPermitted(stateOf(sessionId).snapshot, operation)
  if (refusal) throw new ControlRefusedError(refusal)
}

/** Runs a write through the gate, counting it so a handover can wait for it. */
export async function trackWrite<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
  const state = stateOf(sessionId)
  state.inFlightWrites += 1
  try {
    return await run()
  } finally {
    state.inFlightWrites -= 1
  }
}

/**
 * Waits for in-flight writes to finish, up to the drain budget.
 *
 * Resolves either way: a write that is still going after three seconds is not a reason to refuse
 * the person the page they asked for — it is a reason to stop starting new ones, which the state
 * already does. Returns whether the drain completed, for the audit line.
 */
export async function drainWrites(
  sessionId: string,
  budgetMs = HANDOVER_DRAIN_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  const state = stateOf(sessionId)
  const deadline = Date.now() + budgetMs
  while (state.inFlightWrites > 0 && Date.now() < deadline) {
    await sleep(25)
  }
  return state.inFlightWrites === 0
}

/** How many writes this session has let through and not seen return. For tests and diagnostics. */
export function inFlightWrites(sessionId: string): number {
  return stateOf(sessionId).inFlightWrites
}
