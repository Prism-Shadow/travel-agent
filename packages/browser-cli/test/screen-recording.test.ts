/**
 * Unit tests for fitToAspectRatio — verifies viewport shrink-to-fit
 * for common screen sizes and aspect ratios.
 */
import http from 'node:http'
import path from 'node:path'
import type { BrowserContext, Page } from '@xmorse/playwright-core'
import { describe, test, expect } from 'vitest'
import { GhostCursorController } from '../src/cursor/ghost-cursor-controller.js'
import {
  createRecordingApi,
  createRecordingLifecycleState,
  fitToAspectRatio,
  startRecording,
  stopRecording,
  type RecordingLifecycleState,
} from '../src/media/screen-recording.js'

type JsonObject = Record<string, unknown>

interface RecordingTestResponse {
  status?: number
  body: JsonObject
}

interface RecordingTestServer {
  port: number
  close: () => Promise<void>
}

interface TestPage {
  page: Page
  viewport: () => { width: number; height: number }
  viewportChanges: () => Array<{ width: number; height: number }>
  close: () => void
}

interface RecordingRequest {
  path: string
  sessionId: string
}

async function readJsonBody(request: http.IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) {
    return {}
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonObject
}

async function createRecordingTestServer(
  handler: (path: string, body: JsonObject) => Promise<RecordingTestResponse> | RecordingTestResponse,
): Promise<RecordingTestServer> {
  const server = http.createServer(async (request, response) => {
    try {
      const body = request.method === 'POST' ? await readJsonBody(request) : {}
      const result = await handler(request.url || '/', body)
      response.statusCode = result.status || 200
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(result.body))
    } catch (error) {
      response.statusCode = 500
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
    }
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Test HTTP server did not bind to a TCP port')
  }
  return {
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

function createTestPage(
  sessionId: string,
  initialViewport: { width: number; height: number },
  options: {
    failOnViewportChange?: number
    blockOnViewportChange?: { call: number; wait: Promise<void>; onBlocked?: () => void }
  } = {},
): TestPage {
  let currentViewport = { ...initialViewport }
  const changes: Array<{ width: number; height: number }> = []
  const closeListeners = new Set<() => void>()
  let closed = false
  const page = {
    sessionId: () => sessionId,
    isClosed: () => closed,
    once: (event: string, listener: () => void) => {
      if (event === 'close') {
        closeListeners.add(listener)
      }
    },
    off: (event: string, listener: () => void) => {
      if (event === 'close') {
        closeListeners.delete(listener)
      }
    },
    viewportSize: () => ({ ...currentViewport }),
    setViewportSize: async (viewport: { width: number; height: number }) => {
      if (closed) {
        throw new Error('page is closed')
      }
      const changeNumber = changes.length + 1
      if (changeNumber === options.blockOnViewportChange?.call) {
        options.blockOnViewportChange.onBlocked?.()
        await options.blockOnViewportChange.wait
      }
      if (changeNumber === options.failOnViewportChange) {
        throw new Error('viewport unavailable')
      }
      currentViewport = { ...viewport }
      changes.push({ ...viewport })
    },
  } as unknown as Page
  return {
    page,
    viewport: () => ({ ...currentViewport }),
    viewportChanges: () => changes.map((viewport) => ({ ...viewport })),
    close: () => {
      closed = true
      const listeners = Array.from(closeListeners)
      closeListeners.clear()
      listeners.forEach((listener) => listener())
    },
  }
}

function createLifecycleApi(options: {
  pages: Page[]
  defaultPage: Page
  relayPort: number
  lifecycleState: RecordingLifecycleState
  executionTimestamps?: Array<{ start: number; end: number }>
  onStart?: () => void
  onFinish?: () => void
}) {
  const context = { pages: () => options.pages } as unknown as BrowserContext
  return createRecordingApi({
    context,
    defaultPage: options.defaultPage,
    relayPort: options.relayPort,
    lifecycleState: options.lifecycleState,
    ghostCursorController: new GhostCursorController({ logger: { error: () => {} } }),
    onStart: options.onStart || (() => {}),
    onFinish: options.onFinish || (() => {}),
    getExecutionTimestamps: () => options.executionTimestamps || [],
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for test condition')
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
}

function createSuccessfulRecordingHandler(
  requests: RecordingRequest[],
  options: {
    /**
     * Holds the stop response open until the test resolves it. A timer cannot express "still
     * in flight": on a loaded machine the timer expires before the assertions run, which is
     * exactly how this file's two stop-race tests used to flake (docs/issues/0003).
     */
    stopGate?: Promise<void>
    startDelayMs?: number
    statusDelayMs?: number
    failStartCount?: number
    statusOverride?: (sessionId: string) => { isRecording: boolean; authoritative?: boolean }
  } = {},
): (path: string, body: JsonObject) => Promise<RecordingTestResponse> {
  const outputPaths = new Map<string, string>()
  const activeSessions = new Set<string>()
  let failedStarts = 0
  return async (requestPath, body) => {
    const requestUrl = new URL(requestPath, 'http://127.0.0.1')
    const sessionId =
      typeof body.sessionId === 'string' ? body.sessionId : requestUrl.searchParams.get('sessionId') || ''
    requests.push({ path: requestUrl.pathname, sessionId })
    if (requestUrl.pathname === '/recording/start') {
      if (options.startDelayMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, options.startDelayMs))
      }
      if (failedStarts < (options.failStartCount || 0)) {
        failedStarts += 1
        return { status: 500, body: { success: false, error: 'start failed' } }
      }
      const outputPath = typeof body.outputPath === 'string' ? body.outputPath : '/tmp/recording.mp4'
      outputPaths.set(sessionId, outputPath)
      activeSessions.add(sessionId)
      return {
        body: {
          success: true,
          tabId: sessionId.endsWith('b') ? 8 : 7,
          startedAt: 100,
          mimeType: 'video/mp4',
          outputPath,
        },
      }
    }
    if (requestUrl.pathname === '/recording/stop') {
      if (options.stopGate) {
        await options.stopGate
      }
      activeSessions.delete(sessionId)
      return {
        body: {
          success: true,
          tabId: sessionId.endsWith('b') ? 8 : 7,
          duration: 200,
          path: outputPaths.get(sessionId) || '/tmp/recording.mp4',
          size: 4,
          mimeType: 'video/mp4',
        },
      }
    }
    if (requestUrl.pathname === '/recording/cancel') {
      activeSessions.delete(sessionId)
      return { body: { success: true } }
    }
    if (options.statusDelayMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, options.statusDelayMs))
    }
    const status = options.statusOverride?.(sessionId) || {
      isRecording: activeSessions.has(sessionId),
      authoritative: true,
    }
    return { body: { ...status, tabId: 7, startedAt: 100 } }
  }
}

describe('fitToAspectRatio', () => {
  test('common sizes → 16:9', () => {
    const ratio = { width: 16, height: 9 }

    // Already 16:9 — no change
    expect(fitToAspectRatio({ width: 1920, height: 1080 }, ratio)).toMatchInlineSnapshot(`
      {
        "height": 1080,
        "width": 1920,
      }
    `)
    expect(fitToAspectRatio({ width: 1280, height: 720 }, ratio)).toMatchInlineSnapshot(`
      {
        "height": 720,
        "width": 1280,
      }
    `)

    // 16:10 (MacBook default) — too tall, shrink height
    expect(fitToAspectRatio({ width: 1440, height: 900 }, ratio)).toMatchInlineSnapshot(`
      {
        "height": 810,
        "width": 1440,
      }
    `)
    expect(fitToAspectRatio({ width: 1680, height: 1050 }, ratio)).toMatchInlineSnapshot(`
      {
        "height": 945,
        "width": 1680,
      }
    `)

    // 4:3 — too tall, shrink height
    expect(fitToAspectRatio({ width: 1024, height: 768 }, ratio)).toMatchInlineSnapshot(`
      {
        "height": 576,
        "width": 1024,
      }
    `)

    // Ultra-wide 21:9 — too wide, shrink width
    expect(fitToAspectRatio({ width: 2560, height: 1080 }, ratio)).toMatchInlineSnapshot(`
      {
        "height": 1080,
        "width": 1920,
      }
    `)
    expect(fitToAspectRatio({ width: 3440, height: 1440 }, ratio)).toMatchInlineSnapshot(`
      {
        "height": 1440,
        "width": 2560,
      }
    `)

    // Square — too tall, shrink height
    expect(fitToAspectRatio({ width: 1000, height: 1000 }, ratio)).toMatchInlineSnapshot(`
      {
        "height": 563,
        "width": 1000,
      }
    `)
  })

  test('custom aspect ratios', () => {
    // 4:3
    expect(fitToAspectRatio({ width: 1920, height: 1080 }, { width: 4, height: 3 })).toMatchInlineSnapshot(`
      {
        "height": 1080,
        "width": 1440,
      }
    `)

    // 1:1
    expect(fitToAspectRatio({ width: 1920, height: 1080 }, { width: 1, height: 1 })).toMatchInlineSnapshot(`
      {
        "height": 1080,
        "width": 1080,
      }
    `)

    // 9:16 vertical
    expect(fitToAspectRatio({ width: 1920, height: 1080 }, { width: 9, height: 16 })).toMatchInlineSnapshot(`
      {
        "height": 1080,
        "width": 608,
      }
    `)
  })

  test('never increases dimensions', () => {
    const ratio = { width: 16, height: 9 }
    const sizes = [
      { width: 800, height: 600 },
      { width: 1440, height: 900 },
      { width: 2560, height: 1080 },
      { width: 1000, height: 1000 },
    ]
    for (const size of sizes) {
      const result = fitToAspectRatio(size, ratio)
      expect(result.width).toBeLessThanOrEqual(size.width)
      expect(result.height).toBeLessThanOrEqual(size.height)
    }
  })
})

describe('recording MIME propagation', () => {
  test('returns the actual MIME type and container-aligned output path from the relay', async () => {
    const requestedPath = path.join(process.cwd(), 'capture.mp4')
    const effectivePath = path.join(process.cwd(), 'capture.webm')
    const server = http.createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/recording/start') {
        response.end(
          JSON.stringify({
            success: true,
            tabId: 7,
            startedAt: 100,
            mimeType: 'video/webm;codecs=vp8',
            outputPath: effectivePath,
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          success: true,
          tabId: 7,
          duration: 200,
          path: effectivePath,
          size: 4,
          mimeType: 'video/webm;codecs=vp8',
        }),
      )
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Test HTTP server did not bind to a TCP port')
    }

    try {
      await expect(
        startRecording({
          page: {} as never,
          outputPath: requestedPath,
          relayPort: address.port,
        }),
      ).resolves.toEqual({
        isRecording: true,
        startedAt: 100,
        tabId: 7,
        mimeType: 'video/webm;codecs=vp8',
        outputPath: effectivePath,
      })

      await expect(stopRecording({ page: {} as never, relayPort: address.port })).resolves.toEqual({
        path: effectivePath,
        duration: 200,
        size: 4,
        mimeType: 'video/webm;codecs=vp8',
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })
})

describe('recording lifecycle across execute calls', () => {
  test('stop without options follows the only active page, restores its viewport, and clears its old timer', async () => {
    const requests: RecordingRequest[] = []
    const server = await createRecordingTestServer(createSuccessfulRecordingHandler(requests))
    const startPage = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const laterDefaultPage = createTestPage('pw-tab-b', { width: 1024, height: 768 })
    const lifecycleState = createRecordingLifecycleState()
    const startApi = createLifecycleApi({
      pages: [startPage.page, laterDefaultPage.page],
      defaultPage: startPage.page,
      relayPort: server.port,
      lifecycleState,
      executionTimestamps: [{ start: 0.1, end: 0.2 }],
    })
    const laterApi = createLifecycleApi({
      pages: [startPage.page, laterDefaultPage.page],
      defaultPage: laterDefaultPage.page,
      relayPort: server.port,
      lifecycleState,
      executionTimestamps: [{ start: 0.1, end: 0.2 }],
    })

    try {
      await startApi.start({
        page: startPage.page,
        outputPath: '/tmp/cross-execute-stop.mp4',
        maxDurationMs: 100,
      })
      expect(startPage.viewport()).toEqual({ width: 1440, height: 810 })

      await expect(laterApi.stop()).resolves.toMatchObject({
        path: '/tmp/cross-execute-stop.mp4',
        executionTimestamps: [{ start: 0.1, end: 0.2 }],
      })
      expect(startPage.viewport()).toEqual({ width: 1440, height: 900 })
      expect(laterDefaultPage.viewport()).toEqual({ width: 1024, height: 768 })
      expect(lifecycleState.recordings.size).toBe(0)

      await new Promise<void>((resolve) => setTimeout(resolve, 150))
      expect(requests.filter((request) => request.path === '/recording/stop')).toEqual([
        { path: '/recording/stop', sessionId: 'pw-tab-a' },
      ])
    } finally {
      await server.close()
    }
  })

  test('cancel from a later API instance clears the timer and restores the original page', async () => {
    const requests: RecordingRequest[] = []
    const server = await createRecordingTestServer(createSuccessfulRecordingHandler(requests))
    const startPage = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const laterDefaultPage = createTestPage('pw-tab-b', { width: 1024, height: 768 })
    const lifecycleState = createRecordingLifecycleState()
    const startApi = createLifecycleApi({
      pages: [startPage.page, laterDefaultPage.page],
      defaultPage: startPage.page,
      relayPort: server.port,
      lifecycleState,
    })
    const laterApi = createLifecycleApi({
      pages: [startPage.page, laterDefaultPage.page],
      defaultPage: laterDefaultPage.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      await startApi.start({
        page: startPage.page,
        outputPath: '/tmp/cross-execute-cancel.mp4',
        maxDurationMs: 100,
      })
      await laterApi.cancel()

      expect(startPage.viewport()).toEqual({ width: 1440, height: 900 })
      expect(lifecycleState.recordings.size).toBe(0)
      await new Promise<void>((resolve) => setTimeout(resolve, 150))
      expect(requests.filter((request) => request.path === '/recording/cancel')).toEqual([
        { path: '/recording/cancel', sessionId: 'pw-tab-a' },
      ])
      expect(requests.filter((request) => request.path === '/recording/stop')).toEqual([])
    } finally {
      await server.close()
    }
  })

  test('manual stop joins an auto-stop already in flight instead of sending a duplicate request', async () => {
    const requests: RecordingRequest[] = []
    let releaseStop!: () => void
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    const server = await createRecordingTestServer(createSuccessfulRecordingHandler(requests, { stopGate }))
    const page = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const laterDefaultPage = createTestPage('pw-tab-b', { width: 1024, height: 768 })
    const lifecycleState = createRecordingLifecycleState()
    const startApi = createLifecycleApi({
      pages: [page.page, laterDefaultPage.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })
    const laterApi = createLifecycleApi({
      pages: [page.page, laterDefaultPage.page],
      defaultPage: laterDefaultPage.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      await startApi.start({ page: page.page, outputPath: '/tmp/auto-stop.mp4', maxDurationMs: 10 })
      await waitFor(() => requests.some((request) => request.path === '/recording/stop'))
      // Joins while the auto-stop is provably in flight: its response cannot arrive before the
      // gate is released, so this does not depend on how fast the machine is.
      const joined = laterApi.stop()
      releaseStop()
      await expect(joined).resolves.toMatchObject({ path: '/tmp/auto-stop.mp4' })

      expect(requests.filter((request) => request.path === '/recording/stop')).toHaveLength(1)
      expect(page.viewport()).toEqual({ width: 1440, height: 900 })
      expect(lifecycleState.recordings.size).toBe(0)
    } finally {
      await server.close()
    }
  })

  test('keeps finishing lifecycle visible until viewport restoration settles', async () => {
    const requests: RecordingRequest[] = []
    const server = await createRecordingTestServer(createSuccessfulRecordingHandler(requests))
    let releaseRestore!: () => void
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve
    })
    let markRestoreStarted!: () => void
    const restoreStarted = new Promise<void>((resolve) => {
      markRestoreStarted = resolve
    })
    const page = createTestPage(
      'pw-tab-a',
      { width: 1440, height: 900 },
      {
        blockOnViewportChange: { call: 2, wait: restoreGate, onBlocked: markRestoreStarted },
      },
    )
    const lifecycleState = createRecordingLifecycleState()
    const api = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      await api.start({ page: page.page, outputPath: '/tmp/finishing-original.mp4', maxDurationMs: 0 })
      const firstStop = api.stop({ page: page.page })
      await restoreStarted

      let joinedStopSettled = false
      const joinedStop = api.stop({ page: page.page }).finally(() => {
        joinedStopSettled = true
      })
      await expect(
        api.start({ page: page.page, outputPath: '/tmp/finishing-too-early.mp4', maxDurationMs: 0 }),
      ).rejects.toThrow('Recording finish is still in progress for this target')
      await new Promise<void>((resolve) => setTimeout(resolve, 20))

      expect(joinedStopSettled).toBe(false)
      expect(lifecycleState.recordings.size).toBe(1)
      expect(requests.filter((request) => request.path === '/recording/start')).toHaveLength(1)
      expect(requests.filter((request) => request.path === '/recording/stop')).toHaveLength(1)

      releaseRestore()
      await expect(Promise.all([firstStop, joinedStop])).resolves.toEqual([
        expect.objectContaining({ path: '/tmp/finishing-original.mp4' }),
        expect.objectContaining({ path: '/tmp/finishing-original.mp4' }),
      ])
      expect(lifecycleState.recordings.size).toBe(0)
      expect(page.viewport()).toEqual({ width: 1440, height: 900 })

      await api.start({ page: page.page, outputPath: '/tmp/finishing-restart.mp4', maxDurationMs: 0 })
      expect(requests.filter((request) => request.path === '/recording/start')).toHaveLength(2)
      expect(page.viewportChanges()).toEqual([
        { width: 1440, height: 810 },
        { width: 1440, height: 900 },
        { width: 1440, height: 810 },
      ])
      await api.cancel({ page: page.page })
    } finally {
      releaseRestore()
      await server.close()
    }
  })

  test('keeps two target lifecycles, timers, and viewport restoration independent', async () => {
    const requests: RecordingRequest[] = []
    const server = await createRecordingTestServer(createSuccessfulRecordingHandler(requests))
    const pageA = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const pageB = createTestPage('pw-tab-b', { width: 1024, height: 768 })
    const untrackedPage = createTestPage('pw-tab-c', { width: 800, height: 600 })
    const lifecycleState = createRecordingLifecycleState()
    let startTrackingCalls = 0
    let finishTrackingCalls = 0
    const firstApi = createLifecycleApi({
      pages: [pageA.page, pageB.page, untrackedPage.page],
      defaultPage: pageA.page,
      relayPort: server.port,
      lifecycleState,
      onStart: () => {
        startTrackingCalls += 1
      },
      onFinish: () => {
        finishTrackingCalls += 1
      },
    })
    const laterApi = createLifecycleApi({
      pages: [pageA.page, pageB.page, untrackedPage.page],
      defaultPage: pageB.page,
      relayPort: server.port,
      lifecycleState,
      onStart: () => {
        startTrackingCalls += 1
      },
      onFinish: () => {
        finishTrackingCalls += 1
      },
    })

    try {
      await firstApi.start({ page: pageA.page, outputPath: '/tmp/parallel-a.mp4', maxDurationMs: 200 })
      await firstApi.start({ page: pageB.page, outputPath: '/tmp/parallel-b.mp4', maxDurationMs: 200 })
      expect(lifecycleState.recordings.size).toBe(2)
      expect(pageA.viewport()).toEqual({ width: 1440, height: 810 })
      expect(pageB.viewport()).toEqual({ width: 1024, height: 576 })
      await expect(laterApi.stop()).rejects.toThrow('Multiple recordings are active')

      await laterApi.stop({ page: untrackedPage.page })
      expect(lifecycleState.recordings.size).toBe(2)
      expect(startTrackingCalls).toBe(1)
      expect(finishTrackingCalls).toBe(0)

      await laterApi.stop({ page: pageA.page })
      expect(pageA.viewport()).toEqual({ width: 1440, height: 900 })
      expect(pageB.viewport()).toEqual({ width: 1024, height: 576 })
      expect(lifecycleState.recordings.size).toBe(1)

      await laterApi.cancel({ page: pageB.page })
      expect(pageB.viewport()).toEqual({ width: 1024, height: 768 })
      expect(lifecycleState.recordings.size).toBe(0)
      expect(finishTrackingCalls).toBe(1)
      expect(requests.filter((request) => request.path === '/recording/stop')).toEqual([
        { path: '/recording/stop', sessionId: 'pw-tab-c' },
        { path: '/recording/stop', sessionId: 'pw-tab-a' },
      ])
      expect(requests.filter((request) => request.path === '/recording/cancel')).toEqual([
        { path: '/recording/cancel', sessionId: 'pw-tab-b' },
      ])
    } finally {
      await server.close()
    }
  })

  test('reserves a target before resize and the start HTTP round trip', async () => {
    const requests: RecordingRequest[] = []
    const server = await createRecordingTestServer(createSuccessfulRecordingHandler(requests, { startDelayMs: 80 }))
    const page = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const lifecycleState = createRecordingLifecycleState()
    const firstApi = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })
    const secondApi = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      const firstStart = firstApi.start({ page: page.page, outputPath: '/tmp/concurrent-start.mp4', maxDurationMs: 0 })
      await waitFor(() => requests.some((request) => request.path === '/recording/start'))
      await expect(
        secondApi.start({ page: page.page, outputPath: '/tmp/concurrent-start-2.mp4', maxDurationMs: 0 }),
      ).rejects.toThrow('Recording start is still in progress for this target')
      await firstStart

      expect(requests.filter((request) => request.path === '/recording/start')).toHaveLength(1)
      expect(page.viewportChanges()).toEqual([{ width: 1440, height: 810 }])
      await firstApi.cancel({ page: page.page })
    } finally {
      await server.close()
    }
  })

  test('releases the start reservation and restores the viewport when start fails', async () => {
    const requests: RecordingRequest[] = []
    const server = await createRecordingTestServer(createSuccessfulRecordingHandler(requests, { failStartCount: 1 }))
    const page = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const lifecycleState = createRecordingLifecycleState()
    const api = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      await expect(
        api.start({ page: page.page, outputPath: '/tmp/failing-start.mp4', maxDurationMs: 0 }),
      ).rejects.toThrow('Failed to start recording: start failed')
      expect(page.viewport()).toEqual({ width: 1440, height: 900 })
      expect(lifecycleState.recordings.size).toBe(0)

      await expect(
        api.start({ page: page.page, outputPath: '/tmp/retry-start.mp4', maxDurationMs: 0 }),
      ).resolves.toMatchObject({ isRecording: true })
      expect(lifecycleState.recordings.size).toBe(1)
      await api.cancel({ page: page.page })
    } finally {
      await server.close()
    }
  })

  test('reconciles an authoritative external stop, restores the viewport, and clears the timer', async () => {
    const requests: RecordingRequest[] = []
    let extensionIsRecording = true
    const server = await createRecordingTestServer(
      createSuccessfulRecordingHandler(requests, {
        statusOverride: () => ({ isRecording: extensionIsRecording, authoritative: true }),
      }),
    )
    const page = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const lifecycleState = createRecordingLifecycleState()
    let finishTrackingCalls = 0
    const api = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
      onFinish: () => {
        finishTrackingCalls += 1
      },
    })

    try {
      await api.start({ page: page.page, outputPath: '/tmp/external-stop.mp4', maxDurationMs: 50 })
      expect(page.viewport()).toEqual({ width: 1440, height: 810 })

      extensionIsRecording = false
      await expect(api.isRecording()).resolves.toMatchObject({ isRecording: false, authoritative: true })
      expect(lifecycleState.recordings.size).toBe(0)
      expect(page.viewport()).toEqual({ width: 1440, height: 900 })
      expect(finishTrackingCalls).toBe(1)

      await new Promise<void>((resolve) => setTimeout(resolve, 80))
      expect(requests.filter((request) => request.path === '/recording/stop')).toEqual([])
    } finally {
      await server.close()
    }
  })

  test('allows only one concurrent restart after both callers discover a stale lifecycle', async () => {
    const requests: RecordingRequest[] = []
    let extensionIsRecording = true
    const server = await createRecordingTestServer(
      createSuccessfulRecordingHandler(requests, {
        statusDelayMs: 40,
        statusOverride: () => ({ isRecording: extensionIsRecording, authoritative: true }),
      }),
    )
    const page = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const lifecycleState = createRecordingLifecycleState()
    const firstApi = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })
    const secondApi = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      await firstApi.start({ page: page.page, outputPath: '/tmp/stale-original.mp4', maxDurationMs: 0 })
      extensionIsRecording = false
      const results = await Promise.allSettled([
        firstApi.start({ page: page.page, outputPath: '/tmp/stale-restart-a.mp4', maxDurationMs: 0 }),
        secondApi.start({ page: page.page, outputPath: '/tmp/stale-restart-b.mp4', maxDurationMs: 0 }),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejection = results.find((result) => result.status === 'rejected')
      expect(rejection).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ message: 'Recording already in progress for this target' }),
      })
      expect(requests.filter((request) => request.path === '/recording/status')).toHaveLength(2)
      expect(requests.filter((request) => request.path === '/recording/start')).toHaveLength(2)
      expect(lifecycleState.recordings.size).toBe(1)
      expect(page.viewportChanges()).toEqual([
        { width: 1440, height: 810 },
        { width: 1440, height: 900 },
        { width: 1440, height: 810 },
      ])

      await firstApi.cancel({ page: page.page })
    } finally {
      await server.close()
    }
  })

  test('retains lifecycle state when a false status is not authoritative', async () => {
    const requests: RecordingRequest[] = []
    let status: { isRecording: boolean; authoritative?: boolean } = { isRecording: false }
    const server = await createRecordingTestServer(
      createSuccessfulRecordingHandler(requests, { statusOverride: () => status }),
    )
    const page = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const lifecycleState = createRecordingLifecycleState()
    const api = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      await api.start({ page: page.page, outputPath: '/tmp/unknown-status.mp4', maxDurationMs: 0 })
      await expect(api.isRecording()).resolves.toEqual({
        isRecording: false,
        authoritative: undefined,
        startedAt: 100,
        tabId: 7,
      })
      expect(lifecycleState.recordings.size).toBe(1)
      expect(page.viewport()).toEqual({ width: 1440, height: 810 })
      await expect(
        api.start({ page: page.page, outputPath: '/tmp/unknown-status-restart.mp4', maxDurationMs: 0 }),
      ).rejects.toThrow('Recording already in progress for this target')

      status = { isRecording: false, authoritative: true }
      await api.isRecording()
      expect(lifecycleState.recordings.size).toBe(0)
      expect(page.viewport()).toEqual({ width: 1440, height: 900 })
    } finally {
      await server.close()
    }
  })

  test('page close reconciles authoritative inactivity but retains unknown extension state', async () => {
    const requests: RecordingRequest[] = []
    let authoritative = false
    const server = await createRecordingTestServer(
      createSuccessfulRecordingHandler(requests, {
        statusOverride: () => ({ isRecording: false, authoritative }),
      }),
    )
    const page = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const lifecycleState = createRecordingLifecycleState()
    const api = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      await api.start({ page: page.page, outputPath: '/tmp/page-close.mp4', maxDurationMs: 0 })
      page.close()
      await waitFor(() => requests.some((request) => request.path === '/recording/status'))
      expect(lifecycleState.recordings.size).toBe(1)

      authoritative = true
      await expect(api.isRecording({ page: page.page })).resolves.toMatchObject({
        isRecording: false,
        authoritative: true,
      })
      expect(lifecycleState.recordings.size).toBe(0)
    } finally {
      await server.close()
    }
  })

  test('refreshes a closed lifecycle page from the current context before stopping', async () => {
    const requests: RecordingRequest[] = []
    const server = await createRecordingTestServer(createSuccessfulRecordingHandler(requests))
    const originalPage = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const replacementPage = createTestPage('pw-tab-a', { width: 1440, height: 810 })
    const pages = [originalPage.page]
    const lifecycleState = createRecordingLifecycleState()
    const api = createLifecycleApi({
      pages,
      defaultPage: originalPage.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      await api.start({ page: originalPage.page, outputPath: '/tmp/reconnected-page.mp4', maxDurationMs: 0 })
      originalPage.close()
      await waitFor(() => requests.some((request) => request.path === '/recording/status'))
      expect(lifecycleState.recordings.size).toBe(1)
      pages.splice(0, pages.length, replacementPage.page)

      await expect(api.stop()).resolves.toMatchObject({ path: '/tmp/reconnected-page.mp4' })
      expect(replacementPage.viewport()).toEqual({ width: 1440, height: 900 })
      expect(replacementPage.viewportChanges()).toEqual([{ width: 1440, height: 900 }])
      expect(lifecycleState.recordings.size).toBe(0)
      expect(requests.filter((request) => request.path === '/recording/stop')).toEqual([
        { path: '/recording/stop', sessionId: 'pw-tab-a' },
      ])
    } finally {
      await server.close()
    }
  })

  test('does not let public status reconciliation release a terminal operation in flight', async () => {
    const requests: RecordingRequest[] = []
    let releaseStop!: () => void
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    const server = await createRecordingTestServer(
      createSuccessfulRecordingHandler(requests, {
        stopGate,
        statusOverride: () => ({ isRecording: false, authoritative: true }),
      }),
    )
    const page = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const lifecycleState = createRecordingLifecycleState()
    const timestamps = [{ start: 0.1, end: 0.2 }]
    const api = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
      executionTimestamps: timestamps,
    })

    try {
      await api.start({ page: page.page, outputPath: '/tmp/status-stop-race.mp4', maxDurationMs: 0 })
      const stopping = api.stop({ page: page.page })
      await waitFor(() => requests.some((request) => request.path === '/recording/stop'))
      timestamps.splice(0, timestamps.length, { start: 0.3, end: 0.4 })

      await expect(api.isRecording({ page: page.page })).resolves.toMatchObject({
        isRecording: false,
        authoritative: true,
      })
      // The stop is still in flight by construction — the gate below is what ends it — so a
      // status reconciliation must not have released the entry.
      expect(lifecycleState.recordings.size).toBe(1)
      releaseStop()
      await expect(stopping).resolves.toMatchObject({
        executionTimestamps: [{ start: 0.1, end: 0.2 }],
      })
      expect(lifecycleState.recordings.size).toBe(0)
    } finally {
      await server.close()
    }
  })

  test('cleans a stale closed target after terminal requests fail instead of scheduling endless retries', async () => {
    const requests: RecordingRequest[] = []
    let authoritative = false
    const server = await createRecordingTestServer(async (requestPath, body) => {
      const requestUrl = new URL(requestPath, 'http://127.0.0.1')
      const sessionId =
        typeof body.sessionId === 'string' ? body.sessionId : requestUrl.searchParams.get('sessionId') || ''
      requests.push({ path: requestUrl.pathname, sessionId })
      if (requestUrl.pathname === '/recording/start') {
        return {
          body: {
            success: true,
            tabId: 7,
            startedAt: 100,
            mimeType: 'video/mp4',
            outputPath: '/tmp/stale-closed.mp4',
          },
        }
      }
      if (requestUrl.pathname === '/recording/status') {
        return { body: { isRecording: false, authoritative, tabId: 7, startedAt: 100 } }
      }
      return { status: 500, body: { success: false, error: `${requestUrl.pathname} failed` } }
    })
    const page = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const lifecycleState = createRecordingLifecycleState()
    const api = createLifecycleApi({
      pages: [page.page],
      defaultPage: page.page,
      relayPort: server.port,
      lifecycleState,
    })

    try {
      await api.start({ page: page.page, outputPath: '/tmp/stale-closed.mp4', maxDurationMs: 80 })
      page.close()
      await waitFor(() => requests.some((request) => request.path === '/recording/status'))
      expect(lifecycleState.recordings.size).toBe(1)

      authoritative = true
      await waitFor(() => lifecycleState.recordings.size === 0, 500)
      expect(requests.filter((request) => request.path === '/recording/stop')).toHaveLength(1)
      expect(requests.filter((request) => request.path === '/recording/cancel')).toHaveLength(1)

      await new Promise<void>((resolve) => setTimeout(resolve, 1050))
      expect(requests.filter((request) => request.path === '/recording/stop')).toHaveLength(1)
      expect(requests.filter((request) => request.path === '/recording/cancel')).toHaveLength(1)
    } finally {
      await server.close()
    }
  })

  test('retains failed finishes for a safe retry and treats viewport restoration as best-effort', async () => {
    const failingRequests: RecordingRequest[] = []
    let finishRequestsFail = true
    const failingServer = await createRecordingTestServer(async (requestPath, body) => {
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      failingRequests.push({ path: requestPath, sessionId })
      if (requestPath === '/recording/start') {
        return {
          body: {
            success: true,
            tabId: 7,
            startedAt: 100,
            mimeType: 'video/mp4',
            outputPath: '/tmp/failing-stop.mp4',
          },
        }
      }
      if (finishRequestsFail) {
        return { status: 500, body: { success: false, error: `${requestPath} failed` } }
      }
      if (requestPath === '/recording/stop') {
        return {
          body: {
            success: true,
            tabId: 7,
            duration: 200,
            path: '/tmp/failing-stop.mp4',
            size: 4,
            mimeType: 'video/mp4',
          },
        }
      }
      return { body: { success: true } }
    })
    const failingPage = createTestPage('pw-tab-a', { width: 1440, height: 900 })
    const failingState = createRecordingLifecycleState()
    const failingApi = createLifecycleApi({
      pages: [failingPage.page],
      defaultPage: failingPage.page,
      relayPort: failingServer.port,
      lifecycleState: failingState,
    })

    try {
      await failingApi.start({
        page: failingPage.page,
        outputPath: '/tmp/failing-stop.mp4',
        maxDurationMs: 100,
      })
      await expect(failingApi.stop({ page: failingPage.page })).rejects.toThrow(
        'Recording stop and fallback cancellation failed; lifecycle retained for retry',
      )
      expect(failingPage.viewport()).toEqual({ width: 1440, height: 900 })
      expect(failingState.recordings.size).toBe(1)
      expect(failingRequests.filter((request) => request.path === '/recording/stop')).toHaveLength(1)
      expect(failingRequests.filter((request) => request.path === '/recording/cancel')).toHaveLength(1)

      finishRequestsFail = false
      await waitFor(() => failingState.recordings.size === 0, 2000)
      expect(failingRequests.filter((request) => request.path === '/recording/stop')).toHaveLength(2)
      expect(failingPage.viewport()).toEqual({ width: 1440, height: 900 })

      finishRequestsFail = true
      await failingApi.start({
        page: failingPage.page,
        outputPath: '/tmp/failing-cancel.mp4',
        maxDurationMs: 0,
      })
      await expect(failingApi.cancel({ page: failingPage.page })).rejects.toThrow('/recording/cancel failed')
      expect(failingState.recordings.size).toBe(1)
      expect(failingPage.viewport()).toEqual({ width: 1440, height: 900 })

      finishRequestsFail = false
      await failingApi.cancel({ page: failingPage.page })
      expect(failingState.recordings.size).toBe(0)
    } finally {
      await failingServer.close()
    }

    const successfulRequests: RecordingRequest[] = []
    const successfulServer = await createRecordingTestServer(createSuccessfulRecordingHandler(successfulRequests))
    const closedPage = createTestPage('pw-tab-a', { width: 1440, height: 900 }, { failOnViewportChange: 2 })
    const successfulState = createRecordingLifecycleState()
    const cleanupErrors: unknown[] = []
    const successfulApi = createRecordingApi({
      context: { pages: () => [closedPage.page] } as unknown as BrowserContext,
      defaultPage: closedPage.page,
      relayPort: successfulServer.port,
      lifecycleState: successfulState,
      ghostCursorController: new GhostCursorController({ logger: { error: () => {} } }),
      onStart: () => {},
      onFinish: () => {},
      onCleanupError: (error) => cleanupErrors.push(error),
      getExecutionTimestamps: () => [],
    })

    try {
      await successfulApi.start({
        page: closedPage.page,
        outputPath: '/tmp/restore-failure.mp4',
        maxDurationMs: 100,
      })
      await expect(successfulApi.stop({ page: closedPage.page })).resolves.toMatchObject({
        path: '/tmp/restore-failure.mp4',
      })
      expect(successfulState.recordings.size).toBe(0)
      expect(cleanupErrors).toHaveLength(1)
      expect(successfulRequests.filter((request) => request.path === '/recording/cancel')).toEqual([])
    } finally {
      await successfulServer.close()
    }
  })
})
