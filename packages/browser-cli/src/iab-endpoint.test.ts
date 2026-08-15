/**
 * Authentication on the relay's `/iab` WebSocket.
 *
 * This endpoint hands whoever reaches it the ability to drive the in-app browser, so the tests that
 * matter are the refusals. Three doors are checked here — a missing key, a wrong key, and an
 * `Origin` header — because each closes a different attack: a local process that merely knows the
 * port, one that guesses, and a web page trying to reach loopback from a user's browser.
 *
 * The loopback restriction is not exercised here — the relay binds 127.0.0.1, so there is no
 * non-loopback address to connect from. It is covered instead by `loopback.test.ts`, which tests the
 * `isLoopbackAddress` predicate this endpoint calls, exhaustively and without a socket.
 */
import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { WebSocket } from 'ws'
import { createCdpLogger } from './cdp-log.js'
import { startPenguinBrowserCDPRelayServer } from './cdp-relay.js'

import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const KEY = 'unit-test-iab-key'

/** Ephemeral port: a fixed one collides with a developer's own relay and with a parallel run. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

let PORT: number
let logDir: string
let server: Awaited<ReturnType<typeof startPenguinBrowserCDPRelayServer>>

/** What an attempt observed, plus the socket, so cleanup itself can be asserted. */
type Attempt = { code: number | 'open'; socket: WebSocket }

/**
 * Opens a socket, reports how the server answered, and disposes of it without leaking an error.
 *
 * The disposal is the fiddly part, and getting it wrong is what these tests originally did. A
 * rejected handshake leaves the socket in CONNECTING; calling `close()` there makes ws emit
 * "WebSocket was closed before the connection was established", and an `error` with no listener is
 * an unhandled exception that fails the run. So:
 *
 *   - an `error` listener is attached for the socket's whole life and never removed — ws can emit
 *     after we have stopped caring, and the abort below is itself reported that way;
 *   - CONNECTING is terminated rather than closed, because there is no handshake to close;
 *   - OPEN is closed normally;
 *   - settling is guarded and the timeout cleared, so `done` cannot run twice.
 */
function attemptDetailed(url: string, headers: Record<string, string> = {}): Promise<Attempt> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers })

    // Attached first and never removed. Everything below may provoke an error event.
    socket.on('error', () => {})

    let settled = false
    let timer: NodeJS.Timeout | undefined

    const onOpen = () => done('open')
    const onUnexpected = (_req: unknown, res: { statusCode?: number }) => done(res.statusCode ?? 0)
    const onError = () => done(0)

    const done = (code: number | 'open') => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      socket.off('open', onOpen)
      socket.off('unexpected-response', onUnexpected)
      socket.off('error', onError)

      if (socket.readyState === WebSocket.OPEN) {
        socket.close()
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate()
      }
      resolve({ code, socket })
    }

    socket.on('open', onOpen)
    // A rejected upgrade surfaces here, before any close frame.
    socket.on('unexpected-response', onUnexpected)
    socket.on('error', onError)
    timer = setTimeout(() => done(0), 3000)
  })
}

/** Resolves to the close code, or 'open' when the socket was accepted. */
async function attempt(url: string, headers: Record<string, string> = {}): Promise<number | 'open'> {
  return (await attemptDetailed(url, headers)).code
}

beforeAll(async () => {
  PORT = await freePort()
  // Its own CDP log: the default path is shared, and `createCdpLogger` truncates it on creation,
  // so a relay started in one suite silently empties the file another suite is measuring.
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iab-endpoint-log-'))
  server = await startPenguinBrowserCDPRelayServer({
    port: PORT,
    host: '127.0.0.1',
    iabKey: KEY,
    cdpLogger: createCdpLogger({ logFilePath: path.join(logDir, 'cdp.jsonl') }),
  })
})

afterAll(() => {
  server?.close()
  if (logDir) fs.rmSync(logDir, { recursive: true, force: true })
})

describe('/iab authentication', () => {
  it('accepts a connection carrying the right key and no Origin', async () => {
    const result = await attempt(`ws://127.0.0.1:${PORT}/iab?key=${KEY}&id=travel-agent-iab&installId=i1`)
    expect(result).toBe('open')
  })

  it('rejects a connection with no key', async () => {
    const result = await attempt(`ws://127.0.0.1:${PORT}/iab?id=travel-agent-iab&installId=i1`)
    expect(result).toBe(401)
  })

  it('rejects a wrong key', async () => {
    const result = await attempt(`ws://127.0.0.1:${PORT}/iab?key=not-the-key&installId=i1`)
    expect(result).toBe(401)
  })

  it('rejects a key that is a prefix of the real one', async () => {
    // Guards the comparison itself: a length-insensitive check would let this through.
    const result = await attempt(`ws://127.0.0.1:${PORT}/iab?key=${KEY.slice(0, 5)}&installId=i1`)
    expect(result).toBe(401)
  })

  it('rejects any request carrying an Origin header, even with the right key', async () => {
    // A Node client never sends Origin; a page always does. Refusing outright is stronger than
    // maintaining an allowlist of origins that may connect.
    const result = await attempt(`ws://127.0.0.1:${PORT}/iab?key=${KEY}&installId=i1`, {
      origin: 'https://evil.example',
    })
    expect(result).toBe(403)
  })

  it('disposes of a rejected handshake without leaving an unhandled error', async () => {
    // Pins the helper itself. The socket is still CONNECTING when the server refuses the upgrade,
    // and ws reports closing a connecting socket as an error — which, with no listener attached,
    // aborts the whole run rather than failing one assertion.
    const { code, socket } = await attemptDetailed(`ws://127.0.0.1:${PORT}/iab?key=wrong-key`)
    expect(code).toBe(401)
    expect([WebSocket.CLOSING, WebSocket.CLOSED]).toContain(socket.readyState)
    // The lifelong swallow listener is still there, because ws can emit after we are done.
    expect(socket.listenerCount('error')).toBeGreaterThan(0)
  })

  it('rejects a chrome-extension origin too, so the two transports stay separate', async () => {
    const result = await attempt(`ws://127.0.0.1:${PORT}/iab?key=${KEY}&installId=i1`, {
      origin: 'chrome-extension://fbiciihmfbflenjjaphaljgfnlepnjdf',
    })
    expect(result).toBe(403)
  })
})

describe('/iab on a relay started without a key', () => {
  let bareePort: number
  let bare: Awaited<ReturnType<typeof startPenguinBrowserCDPRelayServer>>

  beforeAll(async () => {
    bareePort = await freePort()
    bare = await startPenguinBrowserCDPRelayServer({
      port: bareePort,
      host: '127.0.0.1',
      cdpLogger: createCdpLogger({ logFilePath: path.join(logDir, 'cdp-bare.jsonl') }),
    })
  })
  afterAll(() => bare?.close())

  it('refuses every connection, key or not', async () => {
    // A standalone `penguin-browser serve` has no in-app browser to drive, so the endpoint should
    // be closed rather than open with an empty secret.
    expect(await attempt(`ws://127.0.0.1:${bareePort}/iab?installId=i1`)).toBe(403)
    expect(await attempt(`ws://127.0.0.1:${bareePort}/iab?key=anything&installId=i1`)).toBe(403)
  })
})
