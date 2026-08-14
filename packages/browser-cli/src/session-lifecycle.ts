import type { SessionInfo } from './executor.js'

import { BoundExtensionDisconnectedError } from './executor.js'

export const SESSION_EXTENSION_DISCONNECTED = 'SESSION_EXTENSION_DISCONNECTED' as const

export type SessionConnectionStatus = 'connected' | 'disconnected' | 'not_bound'

export type SessionConnection = {
  connectionStatus: SessionConnectionStatus
  disconnectReason?: 'bound_extension_not_connected'
}

export type SessionWithConnection = SessionInfo & SessionConnection

export type SessionExtensionDisconnectedError = {
  error: {
    code: typeof SESSION_EXTENSION_DISCONNECTED
    message: string
    sessionId: string
    boundExtensionKey: string
    recovery: string[]
  }
}

/**
 * Extension sessions stay pinned to the installation identity selected at creation.
 * A reinstall produces a new stable key and must never be treated as the same browser
 * automatically: account/profile labels are not unique enough for that safety decision.
 */
export function describeSessionConnection(
  session: Pick<SessionInfo, 'extensionId'>,
  connectedExtensionKeys: ReadonlySet<string>,
): SessionConnection {
  if (!session.extensionId) {
    return { connectionStatus: 'not_bound' }
  }
  if (connectedExtensionKeys.has(session.extensionId)) {
    return { connectionStatus: 'connected' }
  }
  return {
    connectionStatus: 'disconnected',
    disconnectReason: 'bound_extension_not_connected',
  }
}

export function withSessionConnection(
  session: SessionInfo,
  connectedExtensionKeys: ReadonlySet<string>,
): SessionWithConnection {
  return { ...session, ...describeSessionConnection(session, connectedExtensionKeys) }
}

export function disconnectedSessionError(
  session: SessionInfo,
  connectedExtensionKeys: ReadonlySet<string>,
): SessionExtensionDisconnectedError | null {
  const connection = describeSessionConnection(session, connectedExtensionKeys)
  if (connection.connectionStatus !== 'disconnected' || !session.extensionId) return null
  return sessionExtensionDisconnectedError(session.id, session.extensionId)
}

export function sessionExtensionDisconnectedError(
  sessionId: string,
  boundExtensionKey: string,
): SessionExtensionDisconnectedError {
  return {
    error: {
      code: SESSION_EXTENSION_DISCONNECTED,
      message:
        `Session ${sessionId} is bound to a Penguin Browser extension installation that is currently disconnected. ` +
        'The session remains pinned to that installation and is not migrated automatically.',
      sessionId,
      boundExtensionKey,
      recovery: [
        'Wait for the original extension installation to reconnect.',
        `Delete this session with: penguin-browser session delete ${sessionId}`,
        'Create a new session after authorizing a tab in the currently connected extension.',
      ],
    },
  }
}

export function errorForBoundExtensionDisconnect(error: unknown): SessionExtensionDisconnectedError | null {
  if (!(error instanceof BoundExtensionDisconnectedError)) return null
  return sessionExtensionDisconnectedError(error.sessionId, error.boundExtensionKey)
}
