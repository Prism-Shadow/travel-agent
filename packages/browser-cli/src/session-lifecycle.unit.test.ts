import { describe, expect, it } from 'vitest'
import { BoundExtensionDisconnectedError } from './executor.js'
import {
  EXTENSION_TRANSPORT_DISCONNECTED,
  ExtensionTransportDisconnectedError,
  extensionTransportDisconnectedMessage,
  isExtensionTransportDisconnectedError,
} from './extension-errors.js'
import {
  describeSessionConnection,
  disconnectedSessionError,
  errorForBoundExtensionDisconnect,
  SESSION_EXTENSION_DISCONNECTED,
  sessionExtensionDisconnectedError,
  withSessionConnection,
} from './session-lifecycle.js'

const extensionSession = {
  id: '2',
  stateKeys: ['page'],
  extensionId: 'install:old-install',
  browser: 'Chrome',
  profile: { email: 'test@example.com', id: 'account-1' },
  cwd: '/tmp/workspace',
}

describe('session connection lifecycle', () => {
  it('keeps a session connected when the same installation key reconnects', () => {
    expect(
      describeSessionConnection(extensionSession, new Set(['install:old-install'])),
    ).toEqual({ connectionStatus: 'connected' })
  })

  it('marks a session disconnected when a reinstall connects under a different key', () => {
    expect(
      withSessionConnection(extensionSession, new Set(['install:new-install'])),
    ).toEqual({
      ...extensionSession,
      connectionStatus: 'disconnected',
      disconnectReason: 'bound_extension_not_connected',
    })
  })

  it('does not apply extension liveness to direct or headless sessions', () => {
    expect(describeSessionConnection({ extensionId: null }, new Set())).toEqual({
      connectionStatus: 'not_bound',
    })
  })

  it('returns an actionable conflict without suggesting ordinary reset', () => {
    const result = sessionExtensionDisconnectedError('2', 'install:old-install')

    expect(result.error.code).toBe(SESSION_EXTENSION_DISCONNECTED)
    expect(result.error.message).toContain('currently disconnected')
    expect(result.error.message).toContain('not migrated automatically')
    expect(result.error.message).not.toContain('Reinstalling')
    expect(result.error.recovery).toContain('Delete this session with: penguin-browser session delete 2')
    expect(result.error.recovery.join('\n')).not.toContain('session reset')
  })

  it('recognizes relay transport disconnect markers even after a fast reconnect', () => {
    expect(isExtensionTransportDisconnectedError(new ExtensionTransportDisconnectedError('closed'))).toBe(true)
    expect(
      isExtensionTransportDisconnectedError({
        message: 'Protocol error',
        data: { code: EXTENSION_TRANSPORT_DISCONNECTED },
      }),
    ).toBe(true)
    expect(
      isExtensionTransportDisconnectedError(new Error(extensionTransportDisconnectedMessage('closed'))),
    ).toBe(true)
    expect(isExtensionTransportDisconnectedError(new Error('Target closed'))).toBe(false)
  })

  it('converts a typed mid-operation disconnect into the same structured conflict', () => {
    const result = errorForBoundExtensionDisconnect(
      new BoundExtensionDisconnectedError('2', 'install:old-install'),
    )

    expect(result?.error).toMatchObject({
      code: SESSION_EXTENSION_DISCONNECTED,
      sessionId: '2',
      boundExtensionKey: 'install:old-install',
    })
    expect(errorForBoundExtensionDisconnect(new Error('other failure'))).toBeNull()
  })

  it('builds a conflict only for a disconnected extension-bound session', () => {
    expect(disconnectedSessionError(extensionSession, new Set(['install:new-install']))?.error.code).toBe(
      SESSION_EXTENSION_DISCONNECTED,
    )
    expect(disconnectedSessionError(extensionSession, new Set(['install:old-install']))).toBeNull()
    expect(
      disconnectedSessionError({ ...extensionSession, extensionId: null }, new Set()),
    ).toBeNull()
  })
})
