import { vi } from 'vitest'

export function nativePort(handler?: (message: object) => unknown) {
  const messages = new Set<(message: unknown) => void>()
  const disconnects = new Set<() => void>()
  const respond = (message: unknown) => { for (const listener of messages) listener(message) }
  const close = () => { for (const listener of disconnects) listener() }
  const postMessage = vi.fn((message: object) => {
    if (handler) void Promise.resolve().then(() => handler(message)).then(respond, close)
  })
  const disconnect = vi.fn(close)
  return {
    respond, close, postMessage, disconnect,
    port: { postMessage, disconnect,
      onMessage: { addListener: (listener: (message: unknown) => void) => messages.add(listener) },
      onDisconnect: { addListener: (listener: () => void) => disconnects.add(listener) },
    } as unknown as chrome.runtime.Port,
  }
}
