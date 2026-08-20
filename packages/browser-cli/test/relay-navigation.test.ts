import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Page } from '@xmorse/playwright-core'
import WebSocket from 'ws'
import path from 'node:path'
import { getCdpUrl } from '../src/shared/utils.js'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  type TestContext,
  withTimeout,
  createSimpleServer,
} from './test-utils.js'
import '../src/shared/test-declarations.js'

const TEST_PORT = 19992
const FIXTURE_EXTENSION_PATH = path.resolve('test/fixtures/fixture-extension')

describe('Relay Navigation Tests', () => {
  let testCtx: TestContext | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'pw-nav-test-',
      toggleExtension: true,
      additionalExtensions: [FIXTURE_EXTENSION_PATH],
    })
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx)
    testCtx = null
  })

  const getBrowserContext = () => {
    if (!testCtx?.browserContext) throw new Error('Browser not initialized')
    return testCtx.browserContext
  }

  const waitForStableDocumentReadyState = async ({ page, timeoutMs }: { page: Page; timeoutMs: number }) => {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      try {
        const readyState = await page.evaluate(() => {
          return document.readyState
        })
        if (readyState !== 'loading') {
          return
        }
      } catch (e) {
        if (!(e instanceof Error) || !e.message.includes('Execution context was destroyed')) {
          throw new Error('Failed while waiting for stable document readyState', { cause: e })
        }
      }

      await page.waitForTimeout(100)
    }

    throw new Error(`Timed out waiting for stable document readyState after ${timeoutMs}ms`)
  }

  it('should be usable after toggle with valid URL', async () => {
    // Validates the extension waits for a non-empty URL before attaching.

    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const context = browser.contexts()[0]

    const server = await createSimpleServer({
      routes: {
        '/': '<!doctype html><html><body>ok</body></html>',
      },
    })

    const page = await browserContext.newPage()
    try {
      await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.bringToFront()

      const pagePromise = context.waitForEvent('page', { timeout: 5000 })

      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })

      const targetPage = await pagePromise
      console.log('Page URL when event fired:', targetPage.url())

      expect(targetPage.url()).not.toBe('')
      expect(targetPage.url()).not.toBe(':')
      expect(targetPage.url()).toContain(server.baseUrl)

      const result = await targetPage.evaluate(() => window.location.href)
      expect(result).toContain(server.baseUrl)
    } finally {
      await browser.close()
      await page.close()
      await server.close()
    }
  }, 15000)

  it('should expose iframe frames when connecting to an existing page over CDP', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const childServer = await createSimpleServer({
      routes: {
        '/child.html': '<!doctype html><html><body>child</body></html>',
      },
    })
    const childUrl = `${childServer.baseUrl}/child.html`

    const parentServer = await createSimpleServer({
      routes: {
        '/': `<!doctype html><html><body><iframe src="${childUrl}"></iframe></body></html>`,
      },
    })

    const page = await browserContext.newPage()
    try {
      await withTimeout({
        promise: page.goto(parentServer.baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 }),
        timeoutMs: 6000,
        errorMessage: 'Timed out loading parent page for iframe test',
      })
      await withTimeout({
        promise: page.frameLocator('iframe').locator('body').waitFor({ timeout: 5000 }),
        timeoutMs: 6000,
        errorMessage: 'Timed out waiting for iframe to attach in parent page',
      })
      expect(page.frames().map((frame) => frame.url())).toContain(childUrl)
      await page.bringToFront()

      await withTimeout({
        promise: serviceWorker.evaluate(async () => {
          await globalThis.toggleExtensionForActiveTab()
        }),
        timeoutMs: 5000,
        errorMessage: 'Timed out toggling extension for iframe test',
      })
      await new Promise((r) => {
        setTimeout(r, 400)
      })

      const browser = await withTimeout({
        promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
        timeoutMs: 5000,
        errorMessage: 'Timed out connecting over CDP for iframe test',
      })
      const context = browser.contexts()[0]
      const cdpPage = context.pages().find((candidate) => {
        return candidate.url().startsWith(parentServer.baseUrl)
      })
      expect(cdpPage).toBeDefined()

      const frames = cdpPage!.frames()
      const childFrame = frames.find((frame) => {
        return frame.url() === childUrl
      })

      expect(frames.length).toBe(2)
      expect(childFrame).toBeDefined()

      await withTimeout({
        promise: browser.close(),
        timeoutMs: 5000,
        errorMessage: 'Timed out closing CDP browser for iframe test',
      })
    } finally {
      await withTimeout({
        promise: page.close(),
        timeoutMs: 5000,
        errorMessage: 'Timed out closing page for iframe test',
      })
      await Promise.all([parentServer.close(), childServer.close()])
    }
  }, 60000)

  it('should resolve locators for cross-origin iframe that starts with empty src', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const childServer = await createSimpleServer({
      routes: {
        '/login.html': '<!doctype html><html><body><button id="login-btn">Login</button></body></html>',
        '/canvas.html': '<!doctype html><html><body><button id="canvas-btn">Canvas</button></body></html>',
      },
    })
    const loginUrl = `${childServer.baseUrl}/login.html`
    const canvasUrl = `${childServer.baseUrl}/canvas.html`

    const parentServer = await createSimpleServer({
      routes: {
        // Reproduces Framer-like plugin iframes: attached with empty src first,
        // then navigated cross-origin after auto-attach is active.
        '/': `<!doctype html>
<html>
  <body>
    <iframe id="plugin-frame"></iframe>
    <script>
      window.startPluginFlow = () => {
        const frame = document.getElementById('plugin-frame');
        frame.src = '${loginUrl}';
        setTimeout(() => {
          frame.src = '${canvasUrl}';
        }, 150);
      };
    </script>
  </body>
</html>`,
      },
    })

    const page = await browserContext.newPage()
    try {
      await withTimeout({
        promise: page.goto(parentServer.baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 }),
        timeoutMs: 6000,
        errorMessage: 'Timed out loading parent page for empty-src iframe test',
      })
      await page.bringToFront()

      await withTimeout({
        promise: serviceWorker.evaluate(async () => {
          await globalThis.toggleExtensionForActiveTab()
        }),
        timeoutMs: 5000,
        errorMessage: 'Timed out toggling extension for empty-src iframe test',
      })

      const browser = await withTimeout({
        promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
        timeoutMs: 5000,
        errorMessage: 'Timed out connecting over CDP for empty-src iframe test',
      })

      try {
        const context = browser.contexts()[0]
        const cdpPage = context.pages().find((candidate) => {
          return candidate.url().startsWith(parentServer.baseUrl)
        })
        expect(cdpPage).toBeDefined()

        await withTimeout({
          promise: page.evaluate(() => {
            ;(window as Window & { startPluginFlow?: () => void }).startPluginFlow?.()
          }),
          timeoutMs: 3000,
          errorMessage: 'Timed out starting plugin iframe flow',
        })

        const pluginFrame = await withTimeout({
          promise: (async () => {
            for (let attempt = 0; attempt < 40; attempt += 1) {
              // Wait for the *terminal* URL. The page navigates this frame twice — empty src,
              // then login, then canvas 150ms later — so accepting the login document meant
              // racing that second navigation: the button count below could be taken while the
              // document was being replaced, and came back 0 (docs/issues/0003). Reaching
              // canvas still proves the whole empty-src → cross-origin sequence resolved under
              // auto-attach, because canvas is only reachable through it.
              const frame = cdpPage!.frames().find((candidate) => candidate.url() === canvasUrl)
              if (frame) {
                return frame
              }
              await cdpPage!.waitForTimeout(100)
            }
            throw new Error('Plugin frame did not settle at the canvas URL')
          })(),
          timeoutMs: 5000,
          errorMessage: 'Timed out waiting for plugin frame URL in empty-src iframe test',
        })

        await withTimeout({
          promise: pluginFrame.locator('button').first().waitFor({ state: 'attached' }),
          timeoutMs: 5000,
          errorMessage: 'Timed out waiting for button locator in empty-src iframe test',
        })

        const buttonCount = await pluginFrame.locator('button').count()
        expect(buttonCount).toBe(1)
      } finally {
        await withTimeout({
          promise: browser.close(),
          timeoutMs: 5000,
          errorMessage: 'Timed out closing CDP browser for empty-src iframe test',
        })
      }
    } finally {
      await withTimeout({
        promise: page.close(),
        timeoutMs: 5000,
        errorMessage: 'Timed out closing page for empty-src iframe test',
      })
      await Promise.all([parentServer.close(), childServer.close()])
    }
  }, 60000)

  it('should have non-empty URLs when connecting to already-loaded pages', async () => {
    const _browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(_browserContext)

    const page = await _browserContext.newPage()
    await page.goto('https://discord.com/login', { waitUntil: 'load' })
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const context = browser.contexts()[0]

    const pages = context.pages()
    console.log(
      'All page URLs:',
      pages.map((p) => p.url()),
    )

    expect(pages.length).toBeGreaterThan(0)
    for (const p of pages) {
      expect(p.url()).not.toBe('')
      expect(p.url()).not.toBe(':')
      expect(p.url()).not.toBeUndefined()
    }

    const discordPage = pages.find((p) => p.url().includes('discord.com'))
    expect(discordPage).toBeDefined()

    const result = await discordPage!.evaluate(() => window.location.href)
    expect(result).toContain('discord.com')

    await browser.close()
    await page.close()
  }, 60000)

  it('should navigate to notion without hanging', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    const initialUrl = 'https://example.com/notion-repro'
    await page.goto(initialUrl)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url() === initialUrl)
    expect(cdpPage).toBeDefined()

    const response = await cdpPage!.goto('https://www.notion.so', { waitUntil: 'domcontentloaded', timeout: 20000 })

    const currentUrl = cdpPage!.url()
    const responseUrl = response?.url() ?? ''
    expect(responseUrl).toMatch(/notion\.(so|com)/)
    expect(currentUrl).toMatch(/notion\.(so|com)/)
    expect(await cdpPage!.evaluate(() => document.readyState)).not.toBe('loading')

    await browser.close()
    await page.close()
  }, 60000)

  it('should navigate to youtube without hanging', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('about:blank')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    await new Promise((r) => setTimeout(r, 100))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('about:'))
    expect(cdpPage).toBeDefined()

    const response = await cdpPage!.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 })
    const currentUrl = cdpPage!.url()
    const responseUrl = response?.url() ?? ''

    expect(responseUrl).toContain('youtube')
    expect(currentUrl).toContain('youtube')
    await waitForStableDocumentReadyState({ page: cdpPage!, timeoutMs: 5000 })

    await browser.close()
    await page.close()
  }, 60000)

  it('should maintain correct page.url() with iframe-heavy pages', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.setContent(`
            <html>
                <head><title>Iframe Test Page</title></head>
                <body>
                    <h1>Iframe Heavy Page</h1>
                    <iframe src="about:blank" id="frame1"></iframe>
                    <iframe src="about:blank" id="frame2"></iframe>
                    <iframe src="about:blank" id="frame3"></iframe>
                </body>
            </html>
        `)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    await new Promise((r) => setTimeout(r, 100))

    for (let i = 0; i < 3; i++) {
      const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
      const pages = browser.contexts()[0].pages()
      let iframePage
      for (const p of pages) {
        const html = await p.content()
        if (html.includes('Iframe Heavy Page')) {
          iframePage = p
          break
        }
      }

      expect(iframePage).toBeDefined()
      expect(iframePage?.url()).toContain('about:')

      await browser.close()
      await new Promise((r) => setTimeout(r, 100))
    }

    await page.close()
  }, 30000)

  it('should work with stagehand', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })
    await new Promise((r) => setTimeout(r, 100))

    const targetUrl = 'https://example.com/'

    const enableResult = await serviceWorker.evaluate(async (url) => {
      const tab = await chrome.tabs.create({ url, active: true })
      await new Promise((r) => setTimeout(r, 100))
      return await globalThis.toggleExtensionForActiveTab()
    }, targetUrl)

    console.log('Extension enabled:', enableResult)
    expect(enableResult.isConnected).toBe(true)

    await new Promise((r) => setTimeout(r, 100))

    const { Stagehand } = await import('@browserbasehq/stagehand')

    const stagehand = new Stagehand({
      env: 'LOCAL',
      verbose: 1,
      disablePino: true,
      localBrowserLaunchOptions: {
        cdpUrl: getCdpUrl({ port: TEST_PORT }),
      },
    })

    console.log('Initializing Stagehand...')
    await stagehand.init()
    console.log('Stagehand initialized')

    const context = stagehand.context
    expect(context).toBeDefined()

    const pages = context.pages()
    console.log(
      'Stagehand pages:',
      pages.length,
      pages.map((p) => p.url()),
    )

    const stagehandPage = pages.find((p) => p.url().includes('example.com'))
    expect(stagehandPage).toBeDefined()

    const url = stagehandPage!.url()
    console.log('Stagehand page URL:', url)
    expect(url).toContain('example.com')

    await stagehand.close()
  }, 60000)

  it('should expose CDP discovery endpoints /json/version and /json/list', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 200))

    // Test /json/version
    const versionRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/version`)
    expect(versionRes.status).toBe(200)
    const versionJson = (await versionRes.json()) as { webSocketDebuggerUrl: string }
    expect(versionJson).toMatchObject({
      Browser: expect.stringContaining('Penguin Browser/'),
      'Protocol-Version': '1.3',
      webSocketDebuggerUrl: expect.stringContaining('ws://'),
    })
    expect(versionJson.webSocketDebuggerUrl).toContain(`127.0.0.1:${TEST_PORT}/cdp`)

    // Test /json/version/ (trailing slash)
    const versionSlashRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/version/`)
    expect(versionSlashRes.status).toBe(200)

    // Test /json/list
    const listRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/list`)
    expect(listRes.status).toBe(200)
    const listJson = (await listRes.json()) as Array<{ url?: string }>
    expect(Array.isArray(listJson)).toBe(true)
    expect(listJson.length).toBeGreaterThan(0)

    const examplePage = listJson.find((t) => t.url?.includes('example.com'))
    expect(examplePage).toBeDefined()
    expect(examplePage).toMatchObject({
      id: expect.any(String),
      type: 'page',
      url: expect.stringContaining('example.com'),
      webSocketDebuggerUrl: expect.stringContaining('ws://'),
    })

    // Test /json (alias for /json/list)
    const jsonRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json`)
    expect(jsonRes.status).toBe(200)
    const jsonData = await jsonRes.json()
    expect(Array.isArray(jsonData)).toBe(true)

    // Test PUT method (Chrome 66+ prefers PUT)
    const putRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/version`, { method: 'PUT' })
    expect(putRes.status).toBe(200)

    await page.close()
  }, 60000)

  // Skip: chrome.tabCapture.getMediaStreamId() requires activeTab permission
  it.skip('should record screen with navigation using chrome.tabCapture', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const path = await import('node:path')
    const fs = await import('node:fs')

    const recordingPage = await browserContext.newPage()
    await recordingPage.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' })
    await recordingPage.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 200))

    const outputPath = path.join(process.cwd(), 'tmp', 'test-recording.mp4')
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    }

    const { startRecording, stopRecording, isRecording } = await import('../src/media/screen-recording.js')

    const startResult = await startRecording({
      page: recordingPage,
      outputPath,
      frameRate: 30,
      audio: false,
      videoBitsPerSecond: 1500000,
      relayPort: TEST_PORT,
    })
    expect(startResult.isRecording).toBe(true)
    const actualOutputPath = startResult.outputPath ?? outputPath

    await recordingPage.locator('.titleline a').first().click()
    await recordingPage.waitForLoadState('domcontentloaded')
    await new Promise((r) => setTimeout(r, 500))

    await recordingPage.goBack()
    await recordingPage.waitForLoadState('domcontentloaded')

    const status = await isRecording({ page: recordingPage, relayPort: TEST_PORT })
    expect(status.isRecording).toBe(true)

    const stopResult = await stopRecording({ page: recordingPage, relayPort: TEST_PORT })
    expect(stopResult.path).toBe(actualOutputPath)
    expect(stopResult.size).toBeGreaterThan(10000)
    expect(fs.existsSync(actualOutputPath)).toBe(true)

    // Create a sped-up demo video from the recording.
    // We fake executionTimestamps since this test calls screen-recording
    // directly (not via executor sandbox which tracks them automatically).
    const { createDemoVideo } = await import('../src/media/ffmpeg.js')
    const demoPath = await createDemoVideo({
      recordingPath: actualOutputPath,
      durationMs: stopResult.duration,
      executionTimestamps: [
        // Simulate two interactions with an idle gap between them
        { start: 0.5, end: 1.5 },
        { start: 3, end: 4 },
      ],
      speed: 4,
    })
    expect(fs.existsSync(demoPath)).toBe(true)
    expect(demoPath).toContain('-demo')

    // Verify the demo video is smaller (idle sections were sped up)
    const demoSize = fs.statSync(demoPath).size
    expect(demoSize).toBeGreaterThan(0)
    console.log(`Recording: ${stopResult.size} bytes, Demo: ${demoSize} bytes`)

    await recordingPage.close()
    fs.unlinkSync(actualOutputPath)
    fs.unlinkSync(demoPath)
  }, 60000)

  // Regression test for https://private-project.invalid/repository/issues/40
  // When Playwright sends Target.detachFromTarget on the root CDP session (no top-level
  // sessionId), the extension must still route the command by looking at params.sessionId.
  // Previously the extension threw "No tab found for method Target.detachFromTarget"
  // because it only checked the top-level sessionId for routing, which is absent on root
  // session commands. This caused cascading disconnects and instability.
  it('should route Target.detachFromTarget without top-level sessionId (issue #40)', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const server = await createSimpleServer({
      routes: { '/': '<!doctype html><html><body>detach test</body></html>' },
    })

    const page = await browserContext.newPage()
    try {
      await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.bringToFront()

      await withTimeout({
        promise: serviceWorker.evaluate(async () => {
          await globalThis.toggleExtensionForActiveTab()
        }),
        timeoutMs: 5000,
        errorMessage: 'Timed out toggling extension for detach test',
      })
      await new Promise((r) => {
        setTimeout(r, 400)
      })

      // Connect a raw WebSocket to the relay — this lets us send CDP messages
      // exactly as they appear on the wire, without Playwright adding sessionId.
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/cdp/test-detach-raw`)
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          resolve()
        })
        ws.on('error', reject)
      })

      let nextId = 1
      const sendCdp = <T = unknown>(msg: Record<string, unknown>): Promise<T> => {
        return new Promise((resolve, reject) => {
          const id = nextId++
          const timeout = setTimeout(() => {
            ws.off('message', handler)
            reject(new Error(`CDP response timeout for id ${id}`))
          }, 5000)

          const handler = (data: WebSocket.RawData) => {
            const parsed = JSON.parse(data.toString())
            if (parsed.id === id) {
              ws.off('message', handler)
              clearTimeout(timeout)
              resolve(parsed as T)
            }
          }
          ws.on('message', handler)
          ws.send(JSON.stringify({ id, ...msg }))
        })
      }

      // Collect async events from the relay
      const events: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = []
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (!msg.id && msg.method) {
          events.push(msg)
        }
      })

      // Trigger Target.setAutoAttach so the relay sends Target.attachedToTarget for
      // all connected tabs. This gives us the page's pw-tab-* sessionId.
      await sendCdp({
        method: 'Target.setAutoAttach',
        params: { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      })

      // Wait for events to arrive
      await new Promise((r) => {
        setTimeout(r, 500)
      })

      // Filter for the specific page target by URL to avoid grabbing wrong sessions
      // (welcome tab, extension pages, etc.)
      type AttachParams = { sessionId?: string; targetInfo?: { type?: string; url?: string } }
      const attachEvent = events.find((e) => {
        if (e.method !== 'Target.attachedToTarget') {
          return false
        }
        const p = e.params as AttachParams
        return p.targetInfo?.type === 'page' && p.targetInfo?.url?.startsWith(server.baseUrl)
      })
      expect(attachEvent).toBeDefined()
      const pageSessionId = (attachEvent!.params as AttachParams).sessionId
      expect(pageSessionId).toBeTruthy()

      // Verify the session is usable before detach — send a command that requires routing.
      const evalBefore = await sendCdp<{ id: number; error?: { message: string }; result?: unknown }>({
        method: 'Runtime.evaluate',
        sessionId: pageSessionId,
        params: { expression: '1 + 1', returnByValue: true },
      })
      expect(evalBefore.error).toBeUndefined()
      expect((evalBefore.result as { result?: { value?: number } })?.result?.value).toBe(2)

      // NOW: send Target.detachFromTarget WITHOUT a top-level sessionId.
      // This is the exact wire format Playwright uses when sending on the root session
      // (e.g. from CRSession.detach() where _parentSession is the root browser session).
      // The extension must route this by looking at params.sessionId.
      const detachResult = await sendCdp<{ id: number; error?: { message: string }; result?: unknown }>({
        method: 'Target.detachFromTarget',
        // Intentionally NO sessionId field — this is the root session
        params: { sessionId: pageSessionId },
      })

      // Must not fail with extension routing error — the command must reach Chrome.
      // Chrome returns "No session with given id" because pw-tab-* is a virtual session
      // managed by the relay, not a real Chrome CDP session. This is expected — the key
      // proof is that the extension routed the command to Chrome instead of throwing
      // "No tab found" at the routing layer.
      expect(detachResult.error?.message).not.toContain('No tab found')
      expect(detachResult.error?.message).toContain('No session with given id')

      ws.close()
    } finally {
      await page.close()
      await server.close()
    }
  }, 30000)

  it('temporarily removes and restores restricted extension iframes without crashing', async () => {
    // Reproduces https://private-project.invalid/repository/issues/18
    // Extensions like LastPass, SurfingKeys inject chrome-extension:// iframes into every page.
    // When penguin-browser attaches the debugger and Target.setAutoAttach is active, Chrome
    // auto-attaches to these restricted iframe targets. Without filtering, the relay tries
    // to send Runtime.runIfWaitingForDebugger to the restricted child session, which Chrome
    // blocks with "Cannot access a chrome-extension:// URL of a different extension",
    // causing the entire debugger to detach.

    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    // Discover the fixture extension's ID from its service worker
    const penguinBrowserExtId = serviceWorker.url().match(/chrome-extension:\/\/([^/]+)/)?.[1]
    expect(penguinBrowserExtId).toBeTruthy()

    let fixtureExtId: string | undefined
    for (let i = 0; i < 50; i++) {
      const allSws = browserContext.serviceWorkers()
      const fixtureSw = allSws.find((sw) => {
        const id = sw.url().match(/chrome-extension:\/\/([^/]+)/)?.[1]
        return id && id !== penguinBrowserExtId
      })
      if (fixtureSw) {
        fixtureExtId = fixtureSw.url().match(/chrome-extension:\/\/([^/]+)/)?.[1]
        break
      }
      await new Promise((r) => {
        setTimeout(r, 100)
      })
    }
    expect(fixtureExtId).toBeTruthy()
    console.log('Fixture extension ID:', fixtureExtId)

    // Create a page that embeds the fixture extension's page as an iframe,
    // reproducing what extensions like SurfingKeys/LastPass do.
    const server = await createSimpleServer({
      routes: {
        '/': `<!doctype html><html><body>
          <h1>Main page</h1>
          <div id="top-level-parent">
            <span id="before-top-level"></span>
            <iframe src="chrome-extension://${fixtureExtId}/page.html" id="ext-iframe-one"></iframe>
            <span id="between-top-level"></span>
            <iframe src="chrome-extension://${fixtureExtId}/page.html" id="ext-iframe-two"></iframe>
            <span id="after-top-level"></span>
          </div>
          <div id="shadow-host"></div>
          <iframe src="/child.html" id="same-origin-child"></iframe>
          <script>
            const shadowRoot = document.querySelector('#shadow-host').attachShadow({ mode: 'open' })
            shadowRoot.innerHTML = '<span id="before-shadow"></span><iframe id="ext-iframe-shadow" src="chrome-extension://${fixtureExtId}/page.html"></iframe><span id="after-shadow"></span><div id="nested-shadow-host"></div>'
            const nestedShadowRoot = shadowRoot.querySelector('#nested-shadow-host').attachShadow({ mode: 'open' })
            nestedShadowRoot.innerHTML = '<span id="before-nested-shadow"></span><iframe id="ext-iframe-nested-shadow" src="chrome-extension://${fixtureExtId}/page.html"></iframe><span id="after-nested-shadow"></span>'

            globalThis.__restrictedIframeRefs = [
              document.querySelector('#ext-iframe-one'),
              document.querySelector('#ext-iframe-two'),
              shadowRoot.querySelector('#ext-iframe-shadow'),
              nestedShadowRoot.querySelector('#ext-iframe-nested-shadow'),
            ]
            globalThis.__restrictedIframeMutations = { added: 0, removed: 0 }
            const observer = new MutationObserver((records) => {
              for (const record of records) {
                globalThis.__restrictedIframeMutations.added += Array.from(record.addedNodes).filter((node) => node instanceof HTMLIFrameElement).length
                globalThis.__restrictedIframeMutations.removed += Array.from(record.removedNodes).filter((node) => node instanceof HTMLIFrameElement).length
              }
            })
            observer.observe(document.body, { childList: true, subtree: true })
            observer.observe(shadowRoot, { childList: true, subtree: true })
            observer.observe(nestedShadowRoot, { childList: true, subtree: true })
          </script>
        </body></html>`,
        '/child.html': `<!doctype html><html><body>
          <span id="before-child"></span>
          <iframe src="chrome-extension://${fixtureExtId}/page.html" id="ext-iframe-child"></iframe>
          <span id="after-child"></span>
          <script>
            globalThis.__restrictedIframeRef = document.querySelector('#ext-iframe-child')
            globalThis.__restrictedIframeMutations = { added: 0, removed: 0 }
            new MutationObserver((records) => {
              for (const record of records) {
                globalThis.__restrictedIframeMutations.added += Array.from(record.addedNodes).filter((node) => node instanceof HTMLIFrameElement).length
                globalThis.__restrictedIframeMutations.removed += Array.from(record.removedNodes).filter((node) => node instanceof HTMLIFrameElement).length
              }
            }).observe(document.body, { childList: true, subtree: true })
          </script>
        </body></html>`,
      },
    })

    const page = await browserContext.newPage()
    let penguinBrowserConnected = false
    try {
      await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.bringToFront()

      const readRestrictedIframeState = async () => {
        return await page.evaluate(() => {
          type MutationCounts = { added: number; removed: number }
          type RestrictedIframeReference = { isConnected: boolean }
          type MainTestGlobal = typeof globalThis & {
            __restrictedIframeRefs: RestrictedIframeReference[]
            __restrictedIframeMutations: MutationCounts
          }
          type ChildTestGlobal = typeof globalThis & {
            document: typeof document
            __restrictedIframeRef: RestrictedIframeReference
            __restrictedIframeMutations: MutationCounts
          }

          const mainGlobal = globalThis as MainTestGlobal
          const topLevelParent = document.querySelector('#top-level-parent')
          const shadowRoot = document.querySelector('#shadow-host')?.shadowRoot
          const nestedShadowRoot = shadowRoot?.querySelector('#nested-shadow-host')?.shadowRoot
          const childFrame = document.querySelector('#same-origin-child')
          const childGlobal = childFrame?.contentWindow as ChildTestGlobal | null
          const currentIframes: (RestrictedIframeReference | null | undefined)[] = [
            document.querySelector('#ext-iframe-one'),
            document.querySelector('#ext-iframe-two'),
            shadowRoot?.querySelector('#ext-iframe-shadow'),
            nestedShadowRoot?.querySelector('#ext-iframe-nested-shadow'),
          ]

          const markerCount = [document, shadowRoot, nestedShadowRoot].reduce((count, root) => {
            return count + (root?.querySelectorAll('template[data-penguin-browser-restricted-iframe]').length || 0)
          }, 0)

          return {
            allOriginalNodesConnected:
              mainGlobal.__restrictedIframeRefs.every((iframe, index) => {
                return iframe.isConnected && iframe === currentIframes[index]
              }) &&
              childGlobal?.__restrictedIframeRef.isConnected === true &&
              childGlobal.__restrictedIframeRef === childGlobal.document.querySelector('#ext-iframe-child'),
            childOrder:
              childGlobal?.document.querySelector('#ext-iframe-child')?.previousElementSibling?.id === 'before-child' &&
              childGlobal.document.querySelector('#ext-iframe-child')?.nextElementSibling?.id === 'after-child',
            mainMutations: mainGlobal.__restrictedIframeMutations,
            markerCount,
            nestedShadowOrder:
              nestedShadowRoot?.querySelector('#ext-iframe-nested-shadow')?.previousElementSibling?.id ===
                'before-nested-shadow' &&
              nestedShadowRoot.querySelector('#ext-iframe-nested-shadow')?.nextElementSibling?.id ===
                'after-nested-shadow',
            restrictedIframeCount:
              currentIframes.filter((iframe) => iframe?.isConnected).length +
              (childGlobal?.__restrictedIframeRef.isConnected ? 1 : 0),
            shadowOrder:
              shadowRoot?.querySelector('#ext-iframe-shadow')?.previousElementSibling?.id === 'before-shadow' &&
              shadowRoot.querySelector('#ext-iframe-shadow')?.nextElementSibling?.id === 'after-shadow',
            topLevelOrder:
              topLevelParent?.children[0]?.id === 'before-top-level' &&
              topLevelParent.children[1]?.id === 'ext-iframe-one' &&
              topLevelParent.children[2]?.id === 'between-top-level' &&
              topLevelParent.children[3]?.id === 'ext-iframe-two' &&
              topLevelParent.children[4]?.id === 'after-top-level',
            childMutations: childGlobal?.__restrictedIframeMutations,
          }
        })
      }

      const beforeAttach = await readRestrictedIframeState()
      expect(beforeAttach.restrictedIframeCount).toBe(5)
      expect(beforeAttach.allOriginalNodesConnected).toBe(true)

      // Enable penguin-browser on this page — this must NOT crash the debugger
      await withTimeout({
        promise: serviceWorker.evaluate(async () => {
          await globalThis.toggleExtensionForActiveTab()
        }),
        timeoutMs: 5000,
        errorMessage: 'Timed out toggling extension on page with chrome-extension:// iframe',
      })
      penguinBrowserConnected = true

      // Give time for any async errors (Target.attachedToTarget for the iframe) to surface
      await new Promise((r) => {
        setTimeout(r, 1500)
      })

      // Verify the extension is still connected by connecting over CDP and interacting
      const browser = await withTimeout({
        promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
        timeoutMs: 5000,
        errorMessage: 'Timed out connecting over CDP — extension likely crashed',
      })
      const context = browser.contexts()[0]
      const cdpPage = context.pages().find((p) => p.url().startsWith(server.baseUrl))
      expect(cdpPage).toBeDefined()

      // Verify we can execute JS on the page (proves the debugger session is alive)
      const title = await cdpPage!.evaluate(() => document.querySelector('h1')?.textContent)
      expect(title).toBe('Main page')

      const afterAttach = await readRestrictedIframeState()
      expect(afterAttach).toMatchInlineSnapshot(`
        {
          "allOriginalNodesConnected": false,
          "childMutations": {
            "added": 0,
            "removed": 1,
          },
          "childOrder": false,
          "mainMutations": {
            "added": 0,
            "removed": 4,
          },
          "markerCount": 4,
          "nestedShadowOrder": false,
          "restrictedIframeCount": 0,
          "shadowOrder": false,
          "topLevelOrder": false,
        }
      `)

      // Verify the chrome-extension:// iframe did NOT get exposed as a frame
      // (it should be filtered out as a restricted target)
      const frames = cdpPage!.frames()
      const extFrame = frames.find((f) => f.url().startsWith('chrome-extension://'))
      expect(extFrame).toBeUndefined()

      await browser.close()

      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })
      penguinBrowserConnected = false
      const afterDetach = await readRestrictedIframeState()
      expect(afterDetach).toMatchInlineSnapshot(`
        {
          "allOriginalNodesConnected": true,
          "childMutations": {
            "added": 1,
            "removed": 1,
          },
          "childOrder": true,
          "mainMutations": {
            "added": 4,
            "removed": 4,
          },
          "markerCount": 0,
          "nestedShadowOrder": true,
          "restrictedIframeCount": 5,
          "shadowOrder": true,
          "topLevelOrder": true,
        }
      `)

      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })
      penguinBrowserConnected = true
      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })

      const afterSecondAttach = await readRestrictedIframeState()
      expect(afterSecondAttach).toEqual({
        ...afterAttach,
        mainMutations: { added: 4, removed: 8 },
        childMutations: { added: 1, removed: 2 },
      })

      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })
      penguinBrowserConnected = false
      expect(await readRestrictedIframeState()).toEqual({
        ...afterDetach,
        mainMutations: { added: 8, removed: 8 },
        childMutations: { added: 2, removed: 2 },
      })
    } finally {
      // Toggle off to clean up
      if (penguinBrowserConnected) {
        await page.bringToFront()
        await serviceWorker
          .evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
          })
          .catch(() => {})
      }
      await page.close()
      await server.close()
    }
  }, 30000)

  it('restores restricted iframes when all debugger attach retries fail', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const penguinBrowserExtId = serviceWorker.url().match(/chrome-extension:\/\/([^/]+)/)?.[1]

    const fixtureServiceWorker = browserContext.serviceWorkers().find((worker) => {
      const extensionId = worker.url().match(/chrome-extension:\/\/([^/]+)/)?.[1]
      return extensionId && extensionId !== penguinBrowserExtId
    })
    const fixtureExtId = fixtureServiceWorker?.url().match(/chrome-extension:\/\/([^/]+)/)?.[1]
    expect(fixtureExtId).toBeTruthy()

    const server = await createSimpleServer({
      routes: {
        '/': `<!doctype html><html><body>
          <div id="iframe-parent">
            <iframe src="chrome-extension://${fixtureExtId}/page.html" id="original-restricted-iframe"></iframe>
          </div>
          <script>
            const iframeParent = document.querySelector('#iframe-parent')
            globalThis.__originalRestrictedIframe = document.querySelector('#original-restricted-iframe')
            globalThis.__replacementRestrictedIframeCount = 0
            new MutationObserver((records) => {
              const restrictedIframeWasRemoved = records.some((record) => {
                return Array.from(record.removedNodes).some((node) => node instanceof HTMLIFrameElement)
              })
              if (!restrictedIframeWasRemoved) return

              globalThis.__replacementRestrictedIframeCount += 1
              const replacement = document.createElement('iframe')
              replacement.id = 'replacement-restricted-iframe-' + globalThis.__replacementRestrictedIframeCount
              replacement.src = 'chrome-extension://${fixtureExtId}/page.html'
              iframeParent.append(replacement)
            }).observe(iframeParent, { childList: true })
          </script>
        </body></html>`,
      },
    })

    const page = await browserContext.newPage()
    try {
      await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.bringToFront()

      const result = await withTimeout({
        promise: serviceWorker.evaluate(async () => {
          return await globalThis.toggleExtensionForActiveTab()
        }),
        timeoutMs: 5000,
        errorMessage: 'Timed out exhausting restricted iframe attach retries',
      })
      expect(result.isConnected).toBe(false)

      const restoredState = await page.evaluate(() => {
        type FailureTestGlobal = typeof globalThis & {
          __originalRestrictedIframe: { isConnected: boolean }
          __replacementRestrictedIframeCount: number
        }
        const testGlobal = globalThis as FailureTestGlobal
        return {
          connectedRestrictedIframeCount: (
            Array.from(document.querySelectorAll('iframe[src^="chrome-extension://"]')) as {
              isConnected: boolean
            }[]
          ).filter((iframe) => iframe.isConnected).length,
          markerCount: document.querySelectorAll('template[data-penguin-browser-restricted-iframe]').length,
          originalNodeRestored:
            testGlobal.__originalRestrictedIframe.isConnected &&
            testGlobal.__originalRestrictedIframe === document.querySelector('#original-restricted-iframe'),
          replacementCount: testGlobal.__replacementRestrictedIframeCount,
        }
      })
      expect(restoredState).toMatchInlineSnapshot(`
        {
          "connectedRestrictedIframeCount": 3,
          "markerCount": 0,
          "originalNodeRestored": true,
          "replacementCount": 2,
        }
      `)

      // Clear the extension's error entry so this test leaves no tracked tab behind.
      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })
    } finally {
      await page.close()
      await server.close()
    }
  }, 30000)
})
