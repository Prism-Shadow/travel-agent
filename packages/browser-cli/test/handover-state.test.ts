/** Pure browser-control transitions kept beside their only production consumer. */
import { describe, expect, it } from 'vitest'

import {
  applyHandoverEvent,
  HandoverTransitionError,
  INITIAL_HANDOVER,
  mayRead,
  mayWrite,
  refuseIfNotPermitted,
  type HandoverEvent,
  type HandoverSnapshot,
} from '../src/executor/handover-state.js'

function run(events: HandoverEvent[]): HandoverSnapshot {
  return events.reduce(applyHandoverEvent, { ...INITIAL_HANDOVER })
}

describe('ordinary handover', () => {
  it('drains before user control and resumes through a distinct state', () => {
    const handing = run([{ type: 'request_handover', kind: 'human_challenge' }])
    expect(handing.state).toBe('handing_over')
    expect(mayWrite(handing)).toBe(false)
    expect(mayRead(handing)).toBe(true)

    const resuming = run([
      { type: 'request_handover', kind: 'human_challenge' },
      { type: 'drained' },
      { type: 'user_returned', message: '验证码输好了' },
    ])
    expect(resuming).toMatchObject({ state: 'resuming', pendingMessage: '验证码输好了' })
    expect(applyHandoverEvent(resuming, { type: 'resumed' }).state).toBe('agent_control')
  })

  it('requires a reason for full browser takeover', () => {
    expect(() =>
      applyHandoverEvent(INITIAL_HANDOVER, {
        type: 'request_handover',
        kind: 'browser_takeover',
      }),
    ).toThrow(HandoverTransitionError)
  })

  it('rejects events that cannot be true in the current state', () => {
    expect(() => applyHandoverEvent(INITIAL_HANDOVER, { type: 'drained' })).toThrow(
      HandoverTransitionError,
    )
    expect(() => applyHandoverEvent(INITIAL_HANDOVER, { type: 'resumed' })).toThrow(
      HandoverTransitionError,
    )
  })
})

describe('secret phase', () => {
  it('refuses reads as well as writes', () => {
    const secret = run([{ type: 'enter_secret_phase', field: 'cvv' }])
    expect(mayRead(secret)).toBe(false)
    expect(mayWrite(secret)).toBe(false)
    expect(refuseIfNotPermitted(secret, 'read')?.code).toBe('IAB_SECRET_PHASE')
  })

  it('returns the page only when it was cleared or the target was destroyed', () => {
    expect(
      run([
        { type: 'enter_secret_phase', field: 'otp' },
        { type: 'exit_secret_phase', exit: 'cleared' },
      ]),
    ).toMatchObject({ state: 'agent_control', lastSecretExit: 'cleared' })
    expect(
      run([
        { type: 'enter_secret_phase', field: 'otp' },
        { type: 'exit_secret_phase', exit: 'unproven' },
      ]),
    ).toMatchObject({ state: 'user_control', lastSecretExit: 'unproven' })
  })

  it('returns to a known state on abort', () => {
    const secret = run([{ type: 'enter_secret_phase', field: 'otp' }])
    expect(applyHandoverEvent(secret, { type: 'abort' })).toEqual(INITIAL_HANDOVER)
  })
})
