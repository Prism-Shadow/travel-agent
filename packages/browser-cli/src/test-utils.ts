import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import http from 'node:http'
import net from 'node:net'
import { chromium, BrowserContext } from '@xmorse/playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { startPenguinBrowserCDPRelayServer, type RelayServer } from './cdp-relay.js'
import { createFileLogger } from './create-logger.js'
import { killPortProcess } from './kill-port.js'

const execAsync = promisify(exec)
const extensionBuildQueues: Map<string, Promise<void>> = new Map()

async function buildExtension({ port, distDir }: { port: number; distDir: string }): Promise<void> {
  const previous = extensionBuildQueues.get(distDir) || Promise.resolve()
  const buildPromise = previous
    .catch((error) => {
      console.error('Previous extension build failed:', error)
    })
    .then(async () => {
      // Build into a per-port dist to avoid parallel test runs overwriting each other.
      await execAsync(`TESTING=1 PENGUIN_BROWSER_PORT=${port} PENGUIN_BROWSER_EXTENSION_DIST=${distDir} pnpm build`, {
        cwd: '../browser-extension',
      })
    })

  extensionBuildQueues.set(
    distDir,
    buildPromise.finally(() => {}),
  )
  await buildPromise
}

export async function getExtensionServiceWorker(context: BrowserContext) {
  let serviceWorkers = context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'))
  if (serviceWorkers.length === 0) {
    await context.waitForEvent('serviceworker', {
      predicate: (sw) => sw.url().startsWith('chrome-extension://'),
    })
  }

  // Check all chrome-extension service workers for the penguin-browser one (the one
  // that exposes toggleExtensionForActiveTab). This handles cases where
  // additional test fixture extensions are loaded alongside penguin-browser.
  for (let i = 0; i < 50; i++) {
    const allSws = context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'))
    for (const sw of allSws) {
      try {
        const isReady = await sw.evaluate(() => {
          // @ts-ignore
          return typeof globalThis.toggleExtensionForActiveTab === 'function'
        })
        if (isReady) {
          return sw
        }
      } catch {
        // Service worker might not be ready yet
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  // Fallback to first service worker
  return context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'))[0]
}

export interface TestContext {
  browserContext: BrowserContext
  userDataDir: string
  extensionBuildDir: string
  relayServer: RelayServer
}

export async function setupTestContext({
  port,
  tempDirPrefix,
  toggleExtension = false,
  additionalExtensions = [],
}: {
  port: number
  tempDirPrefix: string
  /** Create initial page and toggle extension on it */
  toggleExtension?: boolean
  /** Additional extension paths to load alongside the main penguin-browser extension */
  additionalExtensions?: string[]
}): Promise<TestContext> {
  await killPortProcess({ port }).catch(() => {})

  // Use a port-scoped dist folder so parallel tests don't replace each other's extension builds.
  const distDir = `dist-${port}`

  console.log('Building extension...')
  await buildExtension({ port, distDir })
  console.log('Extension built')

  // Never truncate the developer's live relay-server.log when an E2E context
  // starts. Keep each isolated relay run independently inspectable instead.
  const logRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const localLogPath = path.join(process.cwd(), 'test-results', `relay-${port}-${logRunId}.log`)
  const logger = createFileLogger({ logFilePath: localLogPath })
  console.log(`[PB-E2E-BOOTSTRAP] starting relay on ${port}`)
  const relayServer = await startPenguinBrowserCDPRelayServer({ port, logger })
  console.log(`[PB-E2E-BOOTSTRAP] relay started on ${port}`)

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), tempDirPrefix))
  const extensionPath = path.resolve('../browser-extension', distDir)
  const allExtensionPaths = [extensionPath, ...additionalExtensions].join(',')

  console.log(`[PB-E2E-BOOTSTRAP] launching Chromium with extension ${extensionPath}`)
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    colorScheme: 'dark',
    args: [`--disable-extensions-except=${allExtensionPaths}`, `--load-extension=${allExtensionPaths}`],
  })
  console.log('[PB-E2E-BOOTSTRAP] Chromium launched')

  const serviceWorker = await getExtensionServiceWorker(browserContext)
  console.log(`[PB-E2E-BOOTSTRAP] extension service worker ready: ${serviceWorker?.url() ?? 'missing'}`)

  if (toggleExtension) {
    console.log('[PB-E2E-BOOTSTRAP] toggling extension for about:blank')
    const page = await browserContext.newPage()
    await page.goto('about:blank')
    await serviceWorker.evaluate(async () => {
      await (globalThis as any).toggleExtensionForActiveTab()
    })
    console.log('[PB-E2E-BOOTSTRAP] extension toggle completed')
  }

  return { browserContext, userDataDir, extensionBuildDir: extensionPath, relayServer }
}

export async function cleanupTestContext(
  ctx: TestContext | null,
  cleanup?: (() => Promise<void>) | null,
): Promise<void> {
  if (ctx?.browserContext) {
    await ctx.browserContext.close()
  }
  if (ctx?.relayServer) {
    ctx.relayServer.close()
  }

  if (ctx?.userDataDir) {
    try {
      fs.rmSync(ctx.userDataDir, { recursive: true, force: true })
    } catch (e) {
      console.error('Failed to cleanup user data dir:', e)
    }
  }
  if (ctx?.extensionBuildDir) {
    try {
      fs.rmSync(ctx.extensionBuildDir, { recursive: true, force: true })
    } catch (e) {
      console.error('Failed to cleanup extension test build:', e)
    }
  }
  if (cleanup) {
    await cleanup()
  }
}

export type SseServerState = {
  connected: boolean
  finished: boolean
  writeCount: number
  closed: boolean
}

export type SseServer = {
  baseUrl: string
  getState: () => SseServerState
  close: () => Promise<void>
}

export async function createSseServer(): Promise<SseServer> {
  let sseResponse: http.ServerResponse | null = null
  let sseFinished = false
  let sseClosed = false
  let sseWriteCount = 0
  let sseInterval: NodeJS.Timeout | null = null
  const openResponses: Set<http.ServerResponse> = new Set()
  const openSockets: Set<net.Socket> = new Set()

  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>SSE Test</title>
  </head>
  <body>
    <script>
      window.__sseMessages = [];
      window.__sseOpen = false;
      window.__sseError = null;
      window.startSse = function () {
        const source = new EventSource('/sse');
        window.__sseSource = source;
        source.onopen = function () {
          window.__sseOpen = true;
        };
        source.onmessage = function (event) {
          window.__sseMessages.push(event.data);
        };
        source.onerror = function () {
          window.__sseError = 'SSE error';
        };
        return true;
      };
      window.stopSse = function () {
        if (window.__sseSource) {
          window.__sseSource.close();
        }
      };
    </script>
  </body>
</html>`)
      return
    }

    if (req.url === '/sse') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })
      res.write('retry: 1000\n\n')
      res.write('data: hello\n\n')
      sseResponse = res
      sseWriteCount += 1
      openResponses.add(res)

      res.on('finish', () => {
        sseFinished = true
      })
      res.on('close', () => {
        sseClosed = true
        openResponses.delete(res)
        if (sseInterval) {
          clearInterval(sseInterval)
          sseInterval = null
        }
      })

      sseInterval = setInterval(() => {
        res.write('data: ping\n\n')
        sseWriteCount += 1
      }, 200)
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => {
      openSockets.delete(socket)
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind SSE server')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    getState: () => ({
      connected: sseResponse !== null,
      finished: sseFinished,
      closed: sseClosed,
      writeCount: sseWriteCount,
    }),
    close: async () => {
      for (const response of openResponses) {
        response.destroy()
      }
      for (const socket of openSockets) {
        socket.destroy()
      }
      if (sseInterval) {
        clearInterval(sseInterval)
        sseInterval = null
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

export async function withTimeout<T>({
  promise,
  timeoutMs,
  errorMessage,
}: {
  promise: Promise<T>
  timeoutMs: number
  errorMessage: string
}): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(errorMessage))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })
}

/** Tagged template for inline JS code strings used in MCP execute calls */
export function js(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((result, str, i) => result + str + (values[i] || ''), '')
}

export function tryJsonParse(str: string) {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}

/**
 * Safely close a browser connected via connectOverCDP.
 *
 * Playwright's CRConnection uses async message handling (messageWrap) that can cause
 * a race condition where _onClose() runs before all pending _onMessage() handlers complete.
 * This results in "Assertion error" from crConnection.js when a CDP response arrives
 * after callbacks were cleared by dispose().
 *
 * This helper waits for the message queue to drain before closing, avoiding the race.
 *
 * @param browser - Browser instance from chromium.connectOverCDP()
 * @param drainDelayMs - Time to wait for pending messages to be processed (default: 50ms)
 */
export async function safeCloseCDPBrowser(
  browser: Awaited<ReturnType<typeof import('@xmorse/playwright-core').chromium.connectOverCDP>>,
  drainDelayMs = 50,
): Promise<void> {
  // Wait for any queued message handlers to run
  // This gives Playwright's messageWrap time to process pending CDP responses
  await new Promise((r) => setTimeout(r, drainDelayMs))
  await browser.close()
}

export type SimpleServer = {
  baseUrl: string
  close: () => Promise<void>
}

/** Minimal local HTTP server for tests that need cross-origin iframes or custom routes */
export async function createSimpleServer({ routes }: { routes: Record<string, string> }): Promise<SimpleServer> {
  const openSockets: Set<net.Socket> = new Set()
  const server = http.createServer((req, res) => {
    const url = req.url || '/'
    const body = routes[url]
    if (!body) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(body)
  })

  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => {
      openSockets.delete(socket)
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    throw new Error('Failed to start test server')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of openSockets) {
        socket.destroy()
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}
