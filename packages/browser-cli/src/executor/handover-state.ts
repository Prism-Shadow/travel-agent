/**
 * Who is driving each browser session right now, on the executor's side.
 *
 * The pure machine and its browser-side adapter live together here because the state must be
 * readable by the relay process that is about to click, per session, without a dependency on the
 * conversation server.
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
export type ControlState =
  | 'agent_control'
  | 'handing_over'
  | 'user_control'
  | 'secret_phase'
  | 'resuming'

export const HANDOVER_DRAIN_MS = 3_000

export type SecretExit = 'cleared' | 'unproven' | 'target_destroyed'

export type HandoverEvent =
  | {
      type: 'request_handover'
      kind: 'human_challenge' | 'browser_takeover'
      reason?: string
    }
  | { type: 'drained' }
  | { type: 'user_returned'; message?: string }
  | { type: 'resumed' }
  | { type: 'enter_secret_phase'; field: string }
  | { type: 'exit_secret_phase'; exit: SecretExit }
  | { type: 'abort' }

export interface HandoverSnapshot {
  state: ControlState
  handoverKind?: 'human_challenge' | 'browser_takeover'
  reason?: string
  secretField?: string
  lastSecretExit?: SecretExit
  pendingMessage?: string
}

export const INITIAL_HANDOVER: HandoverSnapshot = { state: 'agent_control' }

export interface ControlRefusal {
  code: 'IAB_USER_CONTROL' | 'IAB_HANDING_OVER' | 'IAB_SECRET_PHASE' | 'IAB_TARGET_RELEASED'
  message: string
}

export function mayWrite(snapshot: HandoverSnapshot): boolean {
  return snapshot.state === 'agent_control'
}

export function mayRead(snapshot: HandoverSnapshot): boolean {
  return snapshot.state !== 'secret_phase'
}

export function refuseIfNotPermitted(
  snapshot: HandoverSnapshot,
  operation: 'read' | 'write',
): ControlRefusal | null {
  if (snapshot.state === 'secret_phase') {
    return {
      code: 'IAB_SECRET_PHASE',
      message:
        `The person is entering a ${snapshot.secretField ?? 'one-time code'} for this page and ` +
        'your access to it is suspended — reads included. Wait for it to come back; do not retry ' +
        'in a loop.',
    }
  }
  if (operation === 'read') return null
  if (snapshot.state === 'handing_over') {
    return {
      code: 'IAB_HANDING_OVER',
      message:
        'The page is being handed to the person; writes already in flight are finishing. Stop ' +
        'writing and wait for them to hand it back.',
    }
  }
  if (snapshot.state === 'user_control') {
    return {
      code: 'IAB_USER_CONTROL',
      message:
        `The person is operating this page${snapshot.reason ? ` (${snapshot.reason})` : ''}. ` +
        'Reads are fine — watch what they do — but do not write until they hand it back.',
    }
  }
  if (snapshot.state === 'resuming') {
    return {
      code: 'IAB_HANDING_OVER',
      message: "The page is coming back to you; the person's message is still being folded in.",
    }
  }
  return null
}

export class HandoverTransitionError extends Error {
  readonly state: ControlState
  readonly event: HandoverEvent['type']

  constructor(state: ControlState, event: HandoverEvent['type'], detail: string) {
    super(`Cannot ${event} while ${state}: ${detail}`)
    this.name = 'HandoverTransitionError'
    this.state = state
    this.event = event
  }
}

export function applyHandoverEvent(
  snapshot: HandoverSnapshot,
  event: HandoverEvent,
): HandoverSnapshot {
  switch (event.type) {
    case 'request_handover': {
      if (snapshot.state === 'secret_phase') {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          'a secret phase is in progress; it has to exit before the page can be handed over',
        )
      }
      if (snapshot.state !== 'agent_control') {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          'the page is already with the person',
        )
      }
      if (event.kind === 'browser_takeover' && !event.reason?.trim()) {
        throw new HandoverTransitionError(snapshot.state, event.type, 'a takeover needs a reason')
      }
      return {
        state: 'handing_over',
        handoverKind: event.kind,
        ...(event.reason?.trim() ? { reason: event.reason } : {}),
        ...(snapshot.lastSecretExit ? { lastSecretExit: snapshot.lastSecretExit } : {}),
      }
    }

    case 'drained':
      if (snapshot.state !== 'handing_over') {
        throw new HandoverTransitionError(snapshot.state, event.type, 'nothing was draining')
      }
      return { ...snapshot, state: 'user_control' }

    case 'user_returned':
      if (snapshot.state !== 'user_control') {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          'the person did not have the page',
        )
      }
      return {
        ...snapshot,
        state: 'resuming',
        ...(event.message?.trim() ? { pendingMessage: event.message } : {}),
      }

    case 'resumed':
      if (snapshot.state !== 'resuming') {
        throw new HandoverTransitionError(snapshot.state, event.type, 'nothing was resuming')
      }
      return {
        state: 'agent_control',
        ...(snapshot.lastSecretExit ? { lastSecretExit: snapshot.lastSecretExit } : {}),
      }

    case 'enter_secret_phase':
      if (snapshot.state !== 'agent_control') {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          'a secret phase starts from agent control; the page is currently elsewhere',
        )
      }
      if (snapshot.lastSecretExit === 'unproven') {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          'the previous secret phase could not prove the field was cleared, so this page stays ' +
            'with the person',
        )
      }
      return { state: 'secret_phase', secretField: event.field }

    case 'exit_secret_phase':
      if (snapshot.state !== 'secret_phase') {
        throw new HandoverTransitionError(snapshot.state, event.type, 'no secret phase to exit')
      }
      if (event.exit === 'cleared') return { state: 'agent_control', lastSecretExit: 'cleared' }
      if (event.exit === 'unproven') return { state: 'user_control', lastSecretExit: 'unproven' }
      return { state: 'agent_control', lastSecretExit: 'target_destroyed' }

    case 'abort':
      return { state: 'agent_control' }
  }
}

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
