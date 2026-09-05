/**
 * Screen recording utility for penguin-browser using chrome.tabCapture.
 * Recording happens in the extension context, so it survives page navigation.
 *
 * This module communicates with the relay server which forwards commands to the extension.
 * sessionId (pw-tab-* format) is used to identify which tab to record.
 */

import os from 'node:os'
import path from 'node:path'
import type { BrowserContext, Page } from '@xmorse/playwright-core'
import { shouldUseHeadlessByDefault } from '../browser/browser-config.js'
import type {
  StartRecordingResult,
  StopRecordingResult,
  IsRecordingResult,
  CancelRecordingResult,
  StartStreamParams,
  StartStreamResult,
  StopStreamResult,
  StreamStatusResult,
} from '../relay/protocol.js'
import { GhostCursorController } from '../cursor/ghost-cursor-controller.js'

/**
 * Build headers for the relay's privileged /recording/* HTTP endpoints.
 * Reads PENGUIN_BROWSER_TOKEN from env so in-process callers (executor running
 * inside `penguin-browser serve --token …`) authenticate against their own relay.
 * The `serve` command sets the env var at startup.
 */
function recordingHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = process.env.PENGUIN_BROWSER_TOKEN
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

/**
 * Generate a CLI command that starts a managed Penguin Browser browser with the
 * bundled extension preloaded. This enables screen recording without a manual
 * extension click on fresh automation sessions.
 */
export function getChromeRestartCommand(): string {
  const headlessFlag = shouldUseHeadlessByDefault({ platform: os.platform() }) ? ' --headless' : ''
  return `penguin-browser browser start${headlessFlag}`
}

const DEFAULT_ASPECT_RATIO = { width: 16, height: 9 }

/** Default max recording duration: 15 minutes in milliseconds */
const DEFAULT_MAX_DURATION_MS = 15 * 60 * 1000

/** Delay before retrying a failed terminal operation after its deadline. */
const RECORDING_FINISH_RETRY_MS = 1000

/**
 * Compute the largest viewport that fits inside `current` at the target aspect ratio.
 * Never increases width or height beyond current values — only shrinks the
 * dimension that's "too large" relative to the target ratio.
 */
export function fitToAspectRatio(
  current: { width: number; height: number },
  ratio: { width: number; height: number } = DEFAULT_ASPECT_RATIO,
): { width: number; height: number } {
  const targetRatio = ratio.width / ratio.height
  const currentRatio = current.width / current.height
  if (currentRatio > targetRatio) {
    // Too wide — keep height, shrink width
    return { width: Math.round(current.height * targetRatio), height: current.height }
  }
  // Too tall (or already exact) — keep width, shrink height
  return { width: current.width, height: Math.round(current.width / targetRatio) }
}

/**
 * Check if an error is related to missing activeTab permission for recording.
 */
function isActiveTabPermissionError(error: string): boolean {
  return (
    error.includes('Extension has not been invoked') ||
    error.includes('activeTab') ||
    error.includes('enable recording')
  )
}

export interface StartRecordingOptions {
  /** Target page to record */
  page: Page
  /** CDP tab session ID (pw-tab-* format) to identify which tab to record */
  sessionId?: string
  /** Frame rate (default: 30) */
  frameRate?: number
  /** Video bitrate in bps (default: 2500000 = 2.5 Mbps) */
  videoBitsPerSecond?: number
  /** Audio bitrate in bps (default: 128000 = 128 kbps) */
  audioBitsPerSecond?: number
  /** Include audio from tab (default: false) */
  audio?: boolean
  /** Path to save the video file */
  outputPath: string
  /** Relay server port (default: 19989) */
  relayPort?: number
  /** Aspect ratio to fit viewport to before recording (default: { width: 16, height: 9 }).
   *  Set to null to skip viewport resizing. */
  aspectRatio?: { width: number; height: number } | null
  /** Max recording duration in ms (default: 15 min = 900000). Auto-stops recording
   *  when exceeded to prevent accidentally filling disk. Set to 0 or Infinity to disable. */
  maxDurationMs?: number
}

export interface StopRecordingOptions {
  /** Target page that is being recorded */
  page: Page
  /** CDP tab session ID (pw-tab-* format) to identify which tab to stop recording */
  sessionId?: string
  /** Relay server port (default: 19989) */
  relayPort?: number
}

export interface RecordingState {
  isRecording: boolean
  /** Whether a false status came from a reachable extension. */
  authoritative?: boolean
  startedAt?: number
  tabId?: number
  /** Media container selected by the browser recorder. */
  mimeType?: string
  /** Effective path after matching its extension to mimeType. */
  outputPath?: string
}

export interface ExecutionTimestamp {
  start: number
  end: number
}

interface RecordingTargetOptions {
  page?: Page
  sessionId?: string
}

type RecordingLifecycleKey = string | Page

interface RecordingStopResult {
  path: string
  duration: number
  size: number
  mimeType?: string
  executionTimestamps: ExecutionTimestamp[]
}

type RecordingLifecycleFinish =
  | { kind: 'stop'; promise: Promise<RecordingStopResult> }
  | { kind: 'cancel'; promise: Promise<void> }

interface ActiveRecordingLifecycle {
  key: RecordingLifecycleKey
  page: Page
  sessionId?: string
  phase: 'starting' | 'recording' | 'finishing'
  preRecordingViewport: { width: number; height: number } | null
  maxDurationAt: number | null
  maxDurationTimer: ReturnType<typeof setTimeout> | null
  finish: RecordingLifecycleFinish | null
  cleanup: Promise<void> | null
  pageCloseListener: (() => void) | null
}

/**
 * Mutable recording state owned by a PlaywrightExecutor session. The executor
 * creates a fresh recording API for every execute() call, so timers and viewport
 * restoration data must live outside an individual API instance.
 */
export interface RecordingLifecycleState {
  recordings: Map<RecordingLifecycleKey, ActiveRecordingLifecycle>
}

export function createRecordingLifecycleState(): RecordingLifecycleState {
  return { recordings: new Map<RecordingLifecycleKey, ActiveRecordingLifecycle>() }
}

interface CreateRecordingApiOptions {
  context: BrowserContext
  defaultPage: Page
  relayPort: number
  ghostCursorController: GhostCursorController
  lifecycleState?: RecordingLifecycleState
  onStart: () => void
  onFinish: () => void
  onCleanupError?: (error: unknown) => void
  getExecutionTimestamps: () => ExecutionTimestamp[]
}

interface StartRecordingWithDefaultsOptions extends Omit<StartRecordingOptions, 'relayPort'> {}
interface StopRecordingWithDefaultsOptions extends Omit<StopRecordingOptions, 'relayPort' | 'page'> {
  page?: Page
}
interface IsRecordingWithDefaultsOptions {
  page?: Page
  sessionId?: string
}
interface CancelRecordingWithDefaultsOptions {
  page?: Page
  sessionId?: string
}

function resolveRecordingTargetPage(options: {
  context: BrowserContext
  defaultPage: Page
  ghostCursorController: GhostCursorController
  target?: RecordingTargetOptions
}): Page {
  return options.ghostCursorController.resolveRecordingTargetPage({
    context: options.context,
    defaultPage: options.defaultPage,
    target: options.target,
  })
}

function withRecordingDefaults<T extends { page?: Page; sessionId?: string }, R>(options: {
  relayPort: number
  defaultPage: Page
  fn: (opts: Omit<T, 'page' | 'sessionId'> & { page: Page; relayPort: number; sessionId?: string }) => Promise<R>
}): (input?: T) => Promise<R> {
  const { relayPort, defaultPage, fn } = options
  return async (input: T = {} as T) => {
    const targetPage = input.page || defaultPage
    const sessionId = input.sessionId || targetPage.sessionId() || undefined
    return fn({ ...input, page: targetPage, sessionId, relayPort })
  }
}

export function createRecordingApi(options: CreateRecordingApiOptions): {
  start: (opts?: StartRecordingWithDefaultsOptions) => Promise<RecordingState>
  stop: (opts?: StopRecordingWithDefaultsOptions) => Promise<RecordingStopResult>
  isRecording: (opts?: IsRecordingWithDefaultsOptions) => Promise<RecordingState>
  cancel: (opts?: CancelRecordingWithDefaultsOptions) => Promise<void>
} {
  const {
    context,
    defaultPage,
    relayPort,
    ghostCursorController,
    lifecycleState = createRecordingLifecycleState(),
    onStart,
    onFinish,
    onCleanupError = () => {},
    getExecutionTimestamps,
  } = options

  const startWithDefaults = withRecordingDefaults<StartRecordingWithDefaultsOptions, RecordingState>({
    relayPort,
    defaultPage,
    fn: startRecording,
  })
  const stopWithDefaults = withRecordingDefaults<
    StopRecordingWithDefaultsOptions,
    { path: string; duration: number; size: number; mimeType?: string }
  >({
    relayPort,
    defaultPage,
    fn: stopRecording,
  })
  const refreshLifecyclePage = (lifecycle: ActiveRecordingLifecycle): Page => {
    if (!lifecycle.sessionId) {
      return lifecycle.page
    }
    const currentPage = context
      .pages()
      .find((candidate) => !candidate.isClosed() && candidate.sessionId() === lifecycle.sessionId)
    if (!currentPage || currentPage === lifecycle.page) {
      return lifecycle.page
    }
    const closeListener = lifecycle.pageCloseListener
    if (closeListener) {
      lifecycle.page.off('close', closeListener)
    }
    lifecycle.page = currentPage
    if (closeListener) {
      currentPage.once('close', closeListener)
    }
    return currentPage
  }
  const resolveLifecycleTarget = (target?: RecordingTargetOptions): { page: Page; sessionId?: string } => {
    if (!target?.page && !target?.sessionId) {
      if (lifecycleState.recordings.size > 1) {
        throw new Error('Multiple recordings are active; specify page or sessionId')
      }
      const active = lifecycleState.recordings.values().next().value
      if (active) {
        return { page: refreshLifecyclePage(active), sessionId: active.sessionId }
      }
    }
    const requestedSessionId = target?.sessionId || target?.page?.sessionId() || undefined
    const trackedLifecycle = requestedSessionId ? lifecycleState.recordings.get(requestedSessionId) : undefined
    if (trackedLifecycle) {
      return { page: refreshLifecyclePage(trackedLifecycle), sessionId: trackedLifecycle.sessionId }
    }
    const targetPage = resolveRecordingTargetPage({ context, defaultPage, ghostCursorController, target })
    return { page: targetPage, sessionId: target?.sessionId || targetPage.sessionId() || undefined }
  }

  const getLifecycleKey = (targetPage: Page, sessionId?: string): RecordingLifecycleKey => {
    return sessionId || targetPage.sessionId() || targetPage
  }

  const isRecordingWithDefaults = async (opts: IsRecordingWithDefaultsOptions = {}): Promise<RecordingState> => {
    const { page: targetPage, sessionId } = resolveLifecycleTarget(opts)
    const lifecycle = lifecycleState.recordings.get(getLifecycleKey(targetPage, sessionId))
    if (lifecycle?.phase === 'recording') {
      return (await reconcileInactiveLifecycle(lifecycle)).status
    }
    return isRecording({ page: targetPage, sessionId, relayPort })
  }

  const cancelWithDefaults = async (opts: CancelRecordingWithDefaultsOptions = {}): Promise<void> => {
    const { page: targetPage, sessionId } = resolveLifecycleTarget(opts)
    await cancelRecording({ page: targetPage, sessionId, relayPort })
  }

  const clearMaxDurationTimer = (lifecycle?: ActiveRecordingLifecycle): void => {
    if (!lifecycle?.maxDurationTimer) {
      return
    }
    clearTimeout(lifecycle.maxDurationTimer)
    lifecycle.maxDurationTimer = null
  }

  const scheduleMaxDurationTimer = (lifecycle: ActiveRecordingLifecycle): void => {
    clearMaxDurationTimer(lifecycle)
    if (lifecycle.maxDurationAt === null) {
      return
    }
    const remainingMs = lifecycle.maxDurationAt - Date.now()
    const delayMs = remainingMs > 0 ? remainingMs : RECORDING_FINISH_RETRY_MS
    lifecycle.maxDurationTimer = setTimeout(() => {
      lifecycle.maxDurationTimer = null
      if (lifecycle.finish) {
        return
      }
      stop({ page: lifecycle.page, sessionId: lifecycle.sessionId }).catch(() => {})
    }, delayMs)
  }

  const restoreViewport = async (
    targetPage: Page,
    preRecordingViewport: { width: number; height: number } | null,
  ): Promise<void> => {
    if (!preRecordingViewport) {
      return
    }
    await targetPage.setViewportSize(preRecordingViewport)
  }

  const restoreViewportBestEffort = async (
    targetPage: Page,
    preRecordingViewport: { width: number; height: number } | null,
  ): Promise<boolean> => {
    try {
      await restoreViewport(targetPage, preRecordingViewport)
      return true
    } catch (error) {
      onCleanupError(error)
      return false
    }
  }

  const hasRecordingOtherThan = (lifecycle: ActiveRecordingLifecycle): boolean => {
    return Array.from(lifecycleState.recordings.values()).some((candidate) => {
      return candidate !== lifecycle && candidate.phase !== 'starting'
    })
  }

  const hasActiveRecording = (): boolean => {
    return Array.from(lifecycleState.recordings.values()).some((candidate) => candidate.phase !== 'starting')
  }

  const detachPageCloseListener = (lifecycle: ActiveRecordingLifecycle): void => {
    if (!lifecycle.pageCloseListener) {
      return
    }
    lifecycle.page.off('close', lifecycle.pageCloseListener)
    lifecycle.pageCloseListener = null
  }

  const prepareLifecycleCleanup = (lifecycle: ActiveRecordingLifecycle): void => {
    clearMaxDurationTimer(lifecycle)
    lifecycle.maxDurationAt = null
    detachPageCloseListener(lifecycle)
  }

  const finishLifecycle = (lifecycle: ActiveRecordingLifecycle, targetPage: Page): Promise<void> => {
    if (lifecycle.cleanup) {
      return lifecycle.cleanup
    }
    const wasRecording = lifecycle.phase === 'recording'
    lifecycle.phase = 'finishing'
    prepareLifecycleCleanup(lifecycle)
    const cleanup = restoreViewportBestEffort(targetPage, lifecycle.preRecordingViewport).then(() => {
      if (lifecycleState.recordings.get(lifecycle.key) !== lifecycle) {
        return
      }
      lifecycleState.recordings.delete(lifecycle.key)
      lifecycle.finish = null
      if (wasRecording && !hasActiveRecording()) {
        onFinish()
      }
    })
    lifecycle.cleanup = cleanup
    return cleanup
  }

  const reconcileInactiveLifecycle = async (
    lifecycle: ActiveRecordingLifecycle,
    finishOwner?: RecordingLifecycleFinish['kind'],
  ): Promise<{ inactive: boolean; status: RecordingState }> => {
    const status = await isRecording({
      page: lifecycle.page,
      sessionId: lifecycle.sessionId,
      relayPort,
    })
    if (status.isRecording || status.authoritative !== true) {
      return { inactive: false, status }
    }
    if (lifecycle.finish && lifecycle.finish.kind !== finishOwner) {
      return { inactive: false, status }
    }
    await finishLifecycle(lifecycle, lifecycle.page)
    return { inactive: true, status }
  }

  const finishLifecycleAfterError = async (
    lifecycle: ActiveRecordingLifecycle,
    targetPage: Page,
    originalError: unknown,
  ): Promise<never> => {
    await finishLifecycle(lifecycle, targetPage)
    throw originalError
  }

  const start = async (opts?: StartRecordingWithDefaultsOptions): Promise<RecordingState> => {
    if (!opts) {
      throw new Error('Recording options with outputPath are required')
    }
    const targetPage = resolveRecordingTargetPage({ context, defaultPage, ghostCursorController, target: opts })
    const sessionId = opts?.sessionId || targetPage.sessionId() || undefined
    const lifecycleKey = getLifecycleKey(targetPage, sessionId)
    const existingLifecycle = lifecycleState.recordings.get(lifecycleKey)
    if (existingLifecycle) {
      if (existingLifecycle.phase === 'starting') {
        throw new Error('Recording start is still in progress for this target')
      }
      if (existingLifecycle.phase === 'finishing') {
        throw new Error('Recording finish is still in progress for this target')
      }
      refreshLifecyclePage(existingLifecycle)
      const { inactive } = await reconcileInactiveLifecycle(existingLifecycle)
      if (!inactive) {
        throw new Error('Recording already in progress for this target')
      }
      if (lifecycleState.recordings.has(lifecycleKey)) {
        throw new Error('Recording already in progress for this target')
      }
    }
    const lifecycle: ActiveRecordingLifecycle = {
      key: lifecycleKey,
      page: targetPage,
      sessionId,
      phase: 'starting',
      preRecordingViewport: null,
      maxDurationAt: null,
      maxDurationTimer: null,
      finish: null,
      cleanup: null,
      pageCloseListener: null,
    }
    lifecycleState.recordings.set(lifecycleKey, lifecycle)

    // Resize viewport to target aspect ratio (default 16:9) before recording.
    // Only shrinks — never increases width or height beyond current values.
    const aspectRatio = opts.aspectRatio === undefined ? DEFAULT_ASPECT_RATIO : opts.aspectRatio
    const result: RecordingState = await (async () => {
      try {
        const preRecordingViewport: { width: number; height: number } | null = await (async () => {
          if (!aspectRatio) {
            return null
          }
          const current = targetPage.viewportSize()
          if (current) {
            const fitted = fitToAspectRatio(current, aspectRatio)
            if (fitted.width !== current.width || fitted.height !== current.height) {
              await targetPage.setViewportSize(fitted)
              return current
            }
          }
          return null
        })()
        lifecycle.preRecordingViewport = preRecordingViewport
        return await startWithDefaults({ ...opts, page: targetPage, sessionId })
      } catch (error) {
        lifecycleState.recordings.delete(lifecycleKey)
        await restoreViewportBestEffort(targetPage, lifecycle.preRecordingViewport)
        throw error
      }
    })()

    const shouldStartTimestampTracking = !hasRecordingOtherThan(lifecycle)
    lifecycle.phase = 'recording'
    if (shouldStartTimestampTracking) {
      onStart()
    }

    // Schedule auto-stop to prevent unbounded recordings filling disk.
    // Default 15 min. Set maxDurationMs to 0 or Infinity to disable.
    const maxMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
    if (maxMs > 0 && maxMs < Infinity) {
      lifecycle.maxDurationAt = Date.now() + maxMs
      scheduleMaxDurationTimer(lifecycle)
    }

    if (targetPage.isClosed()) {
      try {
        await cancelWithDefaults({ page: targetPage, sessionId })
        await finishLifecycle(lifecycle, targetPage)
      } catch (error) {
        try {
          await reconcileInactiveLifecycle(lifecycle)
        } catch (statusError) {
          onCleanupError(statusError)
        }
      }
      throw new Error('Recording target page closed while recording was starting')
    }
    const pageCloseListener = () => {
      void reconcileInactiveLifecycle(lifecycle).catch((error) => {
        onCleanupError(error)
      })
    }
    lifecycle.pageCloseListener = pageCloseListener
    targetPage.once('close', pageCloseListener)

    return result
  }

  const stop = async (opts?: StopRecordingWithDefaultsOptions): Promise<RecordingStopResult> => {
    const { page: targetPage, sessionId } = resolveLifecycleTarget(opts)
    const lifecycleKey = getLifecycleKey(targetPage, sessionId)
    const lifecycle = lifecycleState.recordings.get(lifecycleKey)
    if (lifecycle?.phase === 'starting') {
      throw new Error('Recording start is still in progress')
    }
    if (lifecycle?.finish) {
      if (lifecycle.finish.kind !== 'stop') {
        throw new Error('Recording cancellation already in progress')
      }
      return await lifecycle.finish.promise
    }
    if (lifecycle?.phase === 'finishing') {
      throw new Error('Recording finish is still in progress')
    }

    clearMaxDurationTimer(lifecycle)
    const executionTimestamps = [...getExecutionTimestamps()]
    const stopPromise: Promise<RecordingStopResult> = (async () => {
      try {
        const result = await stopWithDefaults({ ...opts, page: targetPage, sessionId })
        if (lifecycle) {
          await finishLifecycle(lifecycle, targetPage)
        } else if (!hasActiveRecording()) {
          onFinish()
        }
        return { ...result, executionTimestamps }
      } catch (error) {
        if (!lifecycle) {
          throw error
        }
        const cleanupErrors: unknown[] = []
        try {
          await cancelWithDefaults({ ...opts, page: targetPage, sessionId })
        } catch (cancelError) {
          cleanupErrors.push(cancelError)
        }
        if (cleanupErrors.length === 0) {
          return await finishLifecycleAfterError(lifecycle, targetPage, error)
        }
        const inactive = await (async () => {
          try {
            return (await reconcileInactiveLifecycle(lifecycle, 'stop')).inactive
          } catch (statusError) {
            cleanupErrors.push(statusError)
            return false
          }
        })()
        if (inactive) {
          throw new AggregateError(
            [error, ...cleanupErrors],
            'Recording stop and fallback cancellation failed after the recording became inactive',
          )
        }
        const viewportRestored = await restoreViewportBestEffort(targetPage, lifecycle.preRecordingViewport)
        if (viewportRestored) {
          lifecycle.preRecordingViewport = null
        }
        lifecycle.finish = null
        scheduleMaxDurationTimer(lifecycle)
        throw new AggregateError(
          [error, ...cleanupErrors],
          'Recording stop and fallback cancellation failed; lifecycle retained for retry',
        )
      }
    })()
    if (lifecycle) {
      lifecycle.finish = { kind: 'stop', promise: stopPromise }
    }
    return await stopPromise
  }

  const cancel = async (opts?: CancelRecordingWithDefaultsOptions): Promise<void> => {
    const { page: targetPage, sessionId } = resolveLifecycleTarget(opts)
    const lifecycleKey = getLifecycleKey(targetPage, sessionId)
    const lifecycle = lifecycleState.recordings.get(lifecycleKey)
    if (lifecycle?.phase === 'starting') {
      throw new Error('Recording start is still in progress')
    }
    if (lifecycle?.finish) {
      if (lifecycle.finish.kind !== 'cancel') {
        throw new Error('Recording stop already in progress')
      }
      await lifecycle.finish.promise
      return
    }
    if (lifecycle?.phase === 'finishing') {
      throw new Error('Recording finish is still in progress')
    }

    clearMaxDurationTimer(lifecycle)
    const cancelPromise: Promise<void> = (async () => {
      try {
        await cancelWithDefaults({ ...opts, page: targetPage, sessionId })
        if (lifecycle) {
          await finishLifecycle(lifecycle, targetPage)
        } else if (!hasActiveRecording()) {
          onFinish()
        }
      } catch (error) {
        if (!lifecycle) {
          throw error
        }
        const inactive = await (async () => {
          try {
            return (await reconcileInactiveLifecycle(lifecycle, 'cancel')).inactive
          } catch {
            return false
          }
        })()
        if (inactive) {
          throw error
        }
        const viewportRestored = await restoreViewportBestEffort(targetPage, lifecycle.preRecordingViewport)
        if (viewportRestored) {
          lifecycle.preRecordingViewport = null
        }
        lifecycle.finish = null
        scheduleMaxDurationTimer(lifecycle)
        throw error
      }
    })()
    if (lifecycle) {
      lifecycle.finish = { kind: 'cancel', promise: cancelPromise }
    }
    await cancelPromise
  }

  return {
    start,
    stop,
    isRecording: isRecordingWithDefaults,
    cancel,
  }
}

/**
 * Start recording the page.
 * The recording is handled by the extension, so it survives page navigation.
 */
export async function startRecording(options: StartRecordingOptions): Promise<RecordingState> {
  const {
    sessionId,
    frameRate = 30,
    videoBitsPerSecond = 2500000,
    audioBitsPerSecond = 128000,
    audio = false,
    outputPath,
    relayPort = 19989,
  } = options

  // Resolve relative paths to absolute using the caller's cwd.
  // The relay server may have a different cwd, so we must resolve here.
  const absoluteOutputPath = path.resolve(outputPath)

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/start`, {
    method: 'POST',
    headers: recordingHeaders(),
    body: JSON.stringify({
      sessionId,
      frameRate,
      videoBitsPerSecond,
      audioBitsPerSecond,
      audio,
      outputPath: absoluteOutputPath,
    }),
  })

  const result = (await response.json()) as StartRecordingResult

  if (!result.success) {
    const errorMsg = result.error || 'Unknown error'

    // If the error is about missing activeTab permission, provide helpful guidance
    if (isActiveTabPermissionError(errorMsg)) {
      const restartCmd = getChromeRestartCommand()
      throw new Error(
        `Failed to start recording: ${errorMsg}\n\n` +
          `For automated recording, start a managed Penguin Browser browser with the bundled extension loaded:\n\n` +
          `  ${restartCmd}\n\n` +
          `Or click the Travel Browser extension icon on the tab once to grant permission.`,
      )
    }

    throw new Error(`Failed to start recording: ${errorMsg}`)
  }

  return {
    isRecording: true,
    startedAt: result.startedAt,
    tabId: result.tabId,
    mimeType: result.mimeType,
    outputPath: result.outputPath ?? absoluteOutputPath,
  }
}

/**
 * Stop recording and save to file.
 * Returns the path to the saved video file.
 */
export async function stopRecording(
  options: StopRecordingOptions,
): Promise<{ path: string; duration: number; size: number; mimeType?: string }> {
  const { sessionId, relayPort = 19989 } = options

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/stop`, {
    method: 'POST',
    headers: recordingHeaders(),
    body: JSON.stringify({ sessionId }),
  })

  const result = (await response.json()) as StopRecordingResult

  if (!result.success) {
    throw new Error(`Failed to stop recording: ${result.error}`)
  }

  return { path: result.path, duration: result.duration, size: result.size, mimeType: result.mimeType }
}

/**
 * Check if recording is currently active.
 */
export async function isRecording(options: {
  page: Page
  sessionId?: string
  relayPort?: number
}): Promise<RecordingState> {
  const { sessionId, relayPort = 19989 } = options

  const url = new URL(`http://127.0.0.1:${relayPort}/recording/status`)
  if (sessionId) {
    url.searchParams.set('sessionId', sessionId)
  }
  // GET request — only the Authorization header matters here
  const response = await fetch(url.toString(), { headers: recordingHeaders() })
  if (!response.ok) {
    throw new Error(`Failed to check recording status: HTTP ${response.status}`)
  }
  const result = (await response.json()) as IsRecordingResult
  if (typeof result.isRecording !== 'boolean') {
    throw new Error('Failed to check recording status: invalid relay response')
  }

  return {
    isRecording: result.isRecording,
    authoritative: result.authoritative,
    startedAt: result.startedAt,
    tabId: result.tabId,
  }
}

// ============================================================================
// Live RTMP streaming (reuses the tabCapture pipeline; the relay pipes chunks
// to ffmpeg instead of writing a file). ffmpeg runs inside the relay process,
// so streams keep running after the CLI or executor call returns.
// ============================================================================

export interface StartStreamOptions extends Omit<StartStreamParams, 'sessionId'> {
  /** Target page to stream (defaults to the executor's current page) */
  page?: Page
  /** CDP tab session ID (pw-tab-*) to identify which tab to stream */
  sessionId?: string
}

/** Start streaming a tab to one or more RTMP destinations. */
export async function startStream(
  options: StartStreamOptions & { relayPort?: number },
): Promise<StartStreamResult & { success: true }> {
  const { page: _page, relayPort = 19989, ...params } = options

  const response = await fetch(`http://127.0.0.1:${relayPort}/stream/start`, {
    method: 'POST',
    headers: recordingHeaders(),
    body: JSON.stringify(params),
  })

  const result = (await response.json()) as StartStreamResult

  if (!result.success) {
    const errorMsg = result.error || 'Unknown error'
    if (isActiveTabPermissionError(errorMsg)) {
      const restartCmd = getChromeRestartCommand()
      throw new Error(
        `Failed to start stream: ${errorMsg}\n\n` +
          `For automated streaming, start a managed Penguin Browser browser with the bundled extension loaded:\n\n` +
          `  ${restartCmd}\n\n` +
          `Or click the Travel Browser extension icon on the tab once to grant permission.`,
      )
    }
    throw new Error(`Failed to start stream: ${errorMsg}`)
  }

  return result
}

/** Stop an active stream. Closes ffmpeg gracefully and waits for it to exit. */
export async function stopStream(options: {
  page?: Page
  sessionId?: string
  relayPort?: number
}): Promise<{ duration: number; bytesReceived: number }> {
  const { sessionId, relayPort = 19989 } = options

  const response = await fetch(`http://127.0.0.1:${relayPort}/stream/stop`, {
    method: 'POST',
    headers: recordingHeaders(),
    body: JSON.stringify({ sessionId }),
  })

  const result = (await response.json()) as StopStreamResult

  if (!result.success) {
    throw new Error(`Failed to stop stream: ${result.error}`)
  }

  return { duration: result.duration, bytesReceived: result.bytesReceived }
}

/** Get status and encoder stats for the active stream (if any). */
export async function streamStatus(options: {
  page?: Page
  sessionId?: string
  relayPort?: number
}): Promise<StreamStatusResult> {
  const { sessionId, relayPort = 19989 } = options

  const url = new URL(`http://127.0.0.1:${relayPort}/stream/status`)
  if (sessionId) {
    url.searchParams.set('sessionId', sessionId)
  }
  const response = await fetch(url.toString(), { headers: recordingHeaders() })
  return (await response.json()) as StreamStatusResult
}

/**
 * Create the `stream` API exposed in the executor sandbox. Resolves the target
 * tab's pw-tab-* sessionId from the page like the recording API does. Unlike
 * recording there is no viewport resize or max-duration timer: streams pick an
 * explicit output resolution (ffmpeg scales) and run indefinitely.
 */
export function createStreamApi(options: { defaultPage: Page; relayPort: number }): {
  start: (opts: StartStreamOptions) => Promise<StartStreamResult & { success: true }>
  stop: (opts?: { page?: Page; sessionId?: string }) => Promise<{ duration: number; bytesReceived: number }>
  status: (opts?: { page?: Page; sessionId?: string }) => Promise<StreamStatusResult>
} {
  const { defaultPage, relayPort } = options

  const resolveSessionId = (opts?: { page?: Page; sessionId?: string }): string | undefined => {
    const targetPage = opts?.page || defaultPage
    return opts?.sessionId || targetPage.sessionId() || undefined
  }

  return {
    start: async (opts) => {
      return startStream({ ...opts, sessionId: resolveSessionId(opts), relayPort })
    },
    stop: async (opts = {}) => {
      return stopStream({ ...opts, sessionId: resolveSessionId(opts), relayPort })
    },
    status: async (opts = {}) => {
      return streamStatus({ ...opts, sessionId: resolveSessionId(opts), relayPort })
    },
  }
}

/**
 * Cancel recording without saving.
 */
export async function cancelRecording(options: { page: Page; sessionId?: string; relayPort?: number }): Promise<void> {
  const { sessionId, relayPort = 19989 } = options

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/cancel`, {
    method: 'POST',
    headers: recordingHeaders(),
    body: JSON.stringify({ sessionId }),
  })

  const result = (await response.json()) as CancelRecordingResult

  if (!result.success) {
    throw new Error(`Failed to cancel recording: ${result.error}`)
  }
}
