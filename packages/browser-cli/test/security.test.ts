import { describe, it, expect, afterEach } from 'vitest'
import { startPenguinBrowserCDPRelayServer } from '../src/relay/cdp-relay.js'
import { WebSocket } from 'ws'
import { createFileLogger } from '../src/shared/create-logger.js'
import { killPortProcess } from '../src/browser/kill-port.js'
import { EXTENSION_IDS } from '../src/shared/utils.js'

const TEST_PORT = 19999

// Every request in this file goes to one host:port, and every test starts its own relay on it, so
// the suite repeatedly tears a server down and binds the same port again. Node's fetch (undici)
// pools keep-alive sockets per origin: a socket opened against test N's server is offered to test
// N+1's first request, and a POST is not retried once its write has reached a socket the old
// server has since closed. That is the shape of the one failure seen here — `fetch failed: read
// ECONNRESET` on the first POST of the test that follows three GETs, during a full parallel run.
//
// Not proven: a standalone reproduction of that reset, with and without CPU load, did not produce
// it in 600 attempts, so the pooled-socket account is the best-supported explanation rather than a
// demonstrated one. What `Connection: close` does guarantee is that no socket outlives the server
// that served it, which removes the whole class regardless of which member of it fired.
const fetchOnce = (url: string, init: Parameters<typeof fetch>[1] = {}) => {
  return fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), connection: 'close' },
  })
}

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPortProcess({ port })
  } catch (err) {
    // Ignore if no process is running
  }
}

describe('Security Tests', () => {
  let server: any = null

  afterEach(async () => {
    if (server) {
      server.close()
      server = null
    }
    await killProcessOnPort(TEST_PORT)
  })

  it('should enforce token authentication for /cdp endpoint', async () => {
    const token = 'secret-token'
    const logger = createFileLogger()

    server = await startPenguinBrowserCDPRelayServer({
      port: TEST_PORT,
      token,
      logger,
    })

    // Helper to try connecting
    const tryConnect = (tokenParam?: string) => {
      return new Promise<void>((resolve, reject) => {
        const url = `ws://127.0.0.1:${TEST_PORT}/cdp${tokenParam ? `?token=${tokenParam}` : ''}`
        const ws = new WebSocket(url)

        ws.on('open', () => {
          ws.close()
          resolve()
        })

        ws.on('error', (err) => {
          reject(err)
        })

        ws.on('unexpected-response', (req, res) => {
          reject(new Error(`Unexpected response: ${res.statusCode}`))
          ws.close()
        })
      })
    }

    // 1. No token -> Should fail
    await expect(tryConnect()).rejects.toThrow(/Unexpected response: (400|401|403)/)

    // 2. Wrong token -> Should fail
    await expect(tryConnect('wrong-token')).rejects.toThrow(/Unexpected response: (400|401|403)/)

    // 3. Correct token -> Should succeed
    await expect(tryConnect(token)).resolves.not.toThrow()
  })

  it('should enforce localhost restrictions for /extension endpoint', async () => {
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({
      port: TEST_PORT,
      logger,
    })

    const tryConnectExtension = (origin?: string) => {
      return new Promise<void>((resolve, reject) => {
        const url = `ws://127.0.0.1:${TEST_PORT}/extension`
        const options = origin ? { headers: { Origin: origin } } : {}
        const ws = new WebSocket(url, options)

        ws.on('open', () => {
          ws.close()
          resolve()
        })

        ws.on('error', (err) => {
          reject(err)
        })

        ws.on('unexpected-response', (req, res) => {
          reject(new Error(`Unexpected response: ${res.statusCode}`))
          ws.close()
        })
      })
    }

    // 1. Valid chrome-extension origin -> Should succeed
    // Use the extension ID derived from the Penguin Browser manifest key.
    await expect(tryConnectExtension(`chrome-extension://${EXTENSION_IDS[0]}`)).resolves.not.toThrow()

    // 2. Invalid origin (e.g., http://evil.com) -> Should fail
    await expect(tryConnectExtension('http://evil.com')).rejects.toThrow(/Unexpected response: (400|401|403)/)

    // 3. No origin -> Should likely fail if strict checking is enabled, but typically extension connection requires specific origin handling.
    // Based on implementation, usually it checks if it starts with chrome-extension://
    await expect(tryConnectExtension()).rejects.toThrow(/Unexpected response: (400|401|403)/)
  })

  it('should scope extension status to the requesting Chrome profile', async () => {
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({ port: TEST_PORT, logger })

    const connectExtension = (installId: string) => {
      return new Promise<WebSocket>((resolve, reject) => {
        const url = `ws://127.0.0.1:${TEST_PORT}/extension?browser=Chrome&installId=${installId}`
        const ws = new WebSocket(url, {
          headers: { Origin: `chrome-extension://${EXTENSION_IDS[0]}` },
        })
        ws.once('open', () => resolve(ws))
        ws.once('error', reject)
        ws.once('unexpected-response', (_request, response) => {
          reject(new Error(`Unexpected response: ${response.statusCode}`))
          ws.close()
        })
      })
    }

    const first = await connectExtension('profile-a')
    const second = await connectExtension('profile-b')

    try {
      const firstStatus = await fetchOnce(
        `http://127.0.0.1:${TEST_PORT}/extension/status?browser=Chrome&installId=profile-a`,
      ).then((response) => response.json())
      const secondStatus = await fetchOnce(
        `http://127.0.0.1:${TEST_PORT}/extension/status?browser=Chrome&installId=profile-b`,
      ).then((response) => response.json())
      const missingStatus = await fetchOnce(
        `http://127.0.0.1:${TEST_PORT}/extension/status?browser=Chrome&installId=profile-c`,
      ).then((response) => response.json())

      expect((firstStatus as { connected: boolean }).connected).toBe(true)
      expect((secondStatus as { connected: boolean }).connected).toBe(true)
      expect((missingStatus as { connected: boolean }).connected).toBe(false)
    } finally {
      first.close()
      second.close()
    }
  })

  // =========================================================================
  // Privileged HTTP route hardening (/cli/*, /recording/*)
  //
  // These tests verify that cross-origin browser requests are blocked even
  // without CORS preflight (the "simple request" attack vector where POST +
  // Content-Type: text/plain bypasses CORS entirely).
  // =========================================================================

  const httpRequest = ({
    path,
    method = 'POST',
    headers = {},
  }: {
    path: string
    method?: string
    headers?: Record<string, string>
  }) => {
    return fetchOnce(`http://127.0.0.1:${TEST_PORT}${path}`, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify({ sessionId: '1', code: 'true' }) : undefined,
    })
  }

  it('should block cross-origin browser requests to /cli/* via Sec-Fetch-Site', async () => {
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({ port: TEST_PORT, logger })

    // cross-site browser request → 403
    const crossSite = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(crossSite.status).toBe(403)

    // same-site but not same-origin → 403
    const sameSite = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-site' },
    })
    expect(sameSite.status).toBe(403)
  })

  it('should block cross-origin browser requests to /recording/* via Sec-Fetch-Site', async () => {
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({ port: TEST_PORT, logger })

    const res = await httpRequest({
      path: '/recording/status',
      method: 'GET',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(res.status).toBe(403)
  })

  it('should block POST with non-JSON Content-Type (text/plain bypass)', async () => {
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({ port: TEST_PORT, logger })

    // text/plain is the classic CORS preflight bypass
    const textPlain = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(textPlain.status).toBe(415)

    // form-urlencoded is another simple request type
    const formData = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(formData.status).toBe(415)

    // missing Content-Type entirely
    const noContentType = await httpRequest({
      path: '/cli/execute',
      headers: {},
    })
    expect(noContentType.status).toBe(415)
  })

  it('should allow requests without Sec-Fetch-Site (Node.js/CLI clients)', async () => {
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({ port: TEST_PORT, logger })

    // Node.js clients don't send Sec-Fetch-Site, only Content-Type: application/json.
    // Request should pass the middleware (will 404 because no session exists, which is fine).
    const res = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/json' },
    })
    // 404 = passed middleware, session just doesn't exist
    expect(res.status).toBe(404)
  })

  it('should allow same-origin browser requests', async () => {
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({ port: TEST_PORT, logger })

    const res = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    })
    // 404 = passed middleware
    expect(res.status).toBe(404)
  })

  it('should enforce token on /cli/* and /recording/* when token mode is enabled', async () => {
    const secretToken = 'test-secret-token'
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({ port: TEST_PORT, token: secretToken, logger })

    // No token → 401
    const noToken = await httpRequest({
      path: '/cli/sessions',
      method: 'GET',
      headers: {},
    })
    expect(noToken.status).toBe(401)

    // Wrong token → 401
    const wrongToken = await httpRequest({
      path: '/cli/sessions',
      method: 'GET',
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(wrongToken.status).toBe(401)

    // Correct token via Authorization header → pass middleware
    const bearerOk = await httpRequest({
      path: '/cli/sessions',
      method: 'GET',
      headers: { Authorization: `Bearer ${secretToken}` },
    })
    expect(bearerOk.status).toBe(200)

    // Correct token via query param → pass middleware
    const queryOk = await fetchOnce(`http://127.0.0.1:${TEST_PORT}/cli/sessions?token=${secretToken}`)
    expect(queryOk.status).toBe(200)

    // Token also enforced on /recording/*
    const recordingNoToken = await httpRequest({
      path: '/recording/status',
      method: 'GET',
      headers: {},
    })
    expect(recordingNoToken.status).toBe(401)

    const recordingWithToken = await httpRequest({
      path: '/recording/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${secretToken}` },
    })
    expect(recordingWithToken.status).toBe(200)
  })

  it('should enforce token on discovery and status HTTP endpoints', async () => {
    const secretToken = 'test-secret-token'
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({ port: TEST_PORT, token: secretToken, logger })

    for (const path of ['/version', '/extension/status', '/extensions/status', '/json/version', '/json/list']) {
      const unauthorized = await fetchOnce(`http://127.0.0.1:${TEST_PORT}${path}`)
      expect(unauthorized.status, path).toBe(401)

      const authorized = await fetchOnce(`http://127.0.0.1:${TEST_PORT}${path}`, {
        headers: { Authorization: `Bearer ${secretToken}` },
      })
      expect(authorized.status, path).toBe(200)
    }

    const queryAuthorized = await fetchOnce(`http://127.0.0.1:${TEST_PORT}/version?token=${secretToken}`)
    expect(queryAuthorized.status).toBe(200)

    const extensionStatus = await fetchOnce(`http://127.0.0.1:${TEST_PORT}/extension/status`, {
      headers: { Origin: `chrome-extension://${EXTENSION_IDS[0]}` },
    })
    expect(extensionStatus.status).toBe(200)
  })

  it('should not require token on /cli/* when no token is configured', async () => {
    const logger = createFileLogger()
    server = await startPenguinBrowserCDPRelayServer({ port: TEST_PORT, logger })

    // Without token mode, /cli/sessions should work with just proper headers
    const res = await httpRequest({
      path: '/cli/sessions',
      method: 'GET',
      headers: {},
    })
    expect(res.status).toBe(200)
  })
})
