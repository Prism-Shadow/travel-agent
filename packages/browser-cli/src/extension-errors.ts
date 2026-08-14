export const EXTENSION_TRANSPORT_DISCONNECTED = 'PENGUIN_EXTENSION_TRANSPORT_DISCONNECTED' as const

export function extensionTransportDisconnectedMessage(message = 'Extension transport disconnected'): string {
  return `[${EXTENSION_TRANSPORT_DISCONNECTED}] ${message}`
}

export class ExtensionTransportDisconnectedError extends Error {
  readonly code = EXTENSION_TRANSPORT_DISCONNECTED

  constructor(message = 'Extension transport disconnected', options?: { cause?: unknown }) {
    super(extensionTransportDisconnectedMessage(message), options)
    this.name = 'ExtensionTransportDisconnectedError'
  }
}

function hasDisconnectMarker(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as { code?: unknown; data?: unknown; error?: unknown }
  if (record.code === EXTENSION_TRANSPORT_DISCONNECTED) return true
  return hasDisconnectMarker(record.data) || hasDisconnectMarker(record.error)
}

export function isExtensionTransportDisconnectedError(error: unknown): boolean {
  if (error instanceof ExtensionTransportDisconnectedError) return true
  if (hasDisconnectMarker(error)) return true
  if (!(error instanceof Error)) return false
  return hasDisconnectMarker(error.cause) || error.message.includes(EXTENSION_TRANSPORT_DISCONNECTED)
}
