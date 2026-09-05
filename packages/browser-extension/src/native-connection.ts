import { NATIVE_HOST_NAME, type NativeResponse } from 'penguin-browser/src/shared/desktop-connection'

const CONNECTION_ERROR = 'Open Travel Agent Desktop to set up the Chrome connection, then try again.'

/** One ordered discovery channel per worker, independent of the Desktop relay's lifetime. */
export class NativeConnection {
  private port: chrome.runtime.Port | undefined
  private pending: { resolve: (response: NativeResponse) => void; reject: (error: Error) => void } | undefined
  private queue: Promise<void> = Promise.resolve()
  private failures = 0
  private retryAt = 0

  request(message: object): Promise<NativeResponse> {
    // The host replies in order. Only one request is in flight, including settings-page refreshes.
    const result = this.queue.then(() => this.send(message))
    this.queue = result.then(() => {}, () => {})
    return result
  }

  private fail(port?: chrome.runtime.Port): void {
    if (port !== this.port) return
    this.port = undefined
    this.retryAt = Date.now() + Math.min(3000 * 2 ** Math.min(this.failures++, 5), 60_000)
    const pending = this.pending
    this.pending = undefined
    pending?.reject(new Error(CONNECTION_ERROR))
    // A timed-out request must not deliver a late reply to the next caller.
    try { port?.disconnect() } catch {}
  }

  private connect(): chrome.runtime.Port {
    if (this.port) return this.port
    if (Date.now() < this.retryAt) throw new Error(CONNECTION_ERROR)
    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
      this.port = port
      port.onDisconnect.addListener(() => {
        // Read lastError to acknowledge Chrome's transport error without logging host output.
        void chrome.runtime.lastError
        this.fail(port)
      })
      port.onMessage.addListener((response: NativeResponse) => {
        if (this.port !== port) return
        if (!this.pending || !response || response.protocol !== 1) {
          this.fail(port)
          return
        }
        this.failures = 0
        this.retryAt = 0
        const pending = this.pending
        this.pending = undefined
        pending.resolve(response)
      })
      return port
    } catch {
      this.fail(this.port)
      throw new Error(CONNECTION_ERROR)
    }
  }

  private async send(message: object): Promise<NativeResponse> {
    const port = this.connect()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<NativeResponse>((resolve, reject) => {
        this.pending = { resolve, reject }
        timer = setTimeout(() => this.fail(port), 5000)
        try { port.postMessage(message) } catch { this.fail(port) }
      })
    } finally { clearTimeout(timer) }
  }
}
