/**
 * Offscreen document for Penguin Browser screen recording.
 *
 * WHY OFFSCREEN DOCUMENT?
 * Manifest V3 service workers cannot use MediaRecorder or getUserMedia directly.
 * This hidden document provides access to Web APIs while the service worker orchestrates.
 *
 * RECORDING FLOW:
 *
 * ┌─────────────────┐     HTTP      ┌─────────────────┐    WebSocket    ┌─────────────────┐
 * │  User Code      │ ────────────► │  Relay Server   │ ───────────────►│  Extension      │
 * │  startRecording │               │  /recording/*   │                 │  background.ts  │
 * └─────────────────┘               └─────────────────┘                 └────────┬────────┘
 *                                                                                │
 *                                          ┌─────────────────────────────────────┘
 *                                          ▼
 *                                   ┌─────────────────┐
 *                                   │  Offscreen Doc  │  ◄── MediaRecorder
 *                                   │  (this file)    │
 *                                   └─────────────────┘
 *
 * STEP BY STEP:
 * 1. User calls startRecording() → HTTP POST to relay server
 * 2. Relay server forwards to extension via WebSocket
 * 3. Extension calls chrome.tabCapture.getMediaStreamId() to get capture permission
 *    - Requires --allowlisted-extension-id flag OR user clicking extension icon
 * 4. Extension creates this offscreen document via chrome.offscreen.createDocument()
 * 5. Extension sends streamId to offscreen document
 * 6. Offscreen calls navigator.mediaDevices.getUserMedia() with streamId
 * 7. Offscreen creates MediaRecorder and starts encoding to mp4
 * 8. Chunks are sent back to extension → relay server → written to output file
 *
 * KEY APIS:
 * - chrome.tabCapture.getMediaStreamId() - Extension API, gets capture permission
 * - chrome.offscreen.createDocument()    - Extension API, creates this document
 * - navigator.mediaDevices.getUserMedia() - Web API, gets MediaStream from streamId
 * - MediaRecorder                         - Web API, encodes video to mp4
 */

import type {
  OffscreenMessage,
  OffscreenStartRecordingMessage,
  OffscreenStopRecordingMessage,
  OffscreenIsRecordingMessage,
  OffscreenCancelRecordingMessage,
  OffscreenStartRecordingResult,
  OffscreenStopRecordingResult,
  OffscreenIsRecordingResult,
  OffscreenCancelRecordingResult,
  ChromeTabCaptureAudioConstraints,
  ChromeTabCaptureVideoConstraints,
} from './offscreen-types'

interface OffscreenRecordingState {
  recorder: MediaRecorder
  stream: MediaStream
  startedAt: number
  tabId: number
  pendingChunks: Promise<void>
  chunkError?: Error
  recorderError?: Error
  cancelled: boolean
  started: boolean
}

// Map of tabId -> recording state for concurrent recording support
const recordings = new Map<number, OffscreenRecordingState>()

type OffscreenResult =
  | OffscreenStartRecordingResult
  | OffscreenStopRecordingResult
  | OffscreenIsRecordingResult
  | OffscreenCancelRecordingResult

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse)
  return true // Keep channel open for async response
})

async function handleMessage(message: OffscreenMessage): Promise<OffscreenResult> {
  switch (message.action) {
    case 'startRecording':
      return handleStartRecording(message)
    case 'stopRecording':
      return handleStopRecording(message)
    case 'isRecording':
      return handleIsRecording(message)
    case 'cancelRecording':
      return handleCancelRecording(message)
    default:
      return { success: false, error: 'Unknown action' }
  }
}

async function handleStartRecording(params: OffscreenStartRecordingMessage): Promise<OffscreenStartRecordingResult> {
  const { tabId } = params

  if (recordings.has(tabId)) {
    return { success: false, error: `Recording already in progress for tab ${tabId}` }
  }

  let stream: MediaStream | undefined
  let recording: OffscreenRecordingState | undefined

  try {
    // Build Chrome-specific tabCapture constraints
    // These use Chrome's proprietary API that TypeScript doesn't have built-in types for
    const audioConstraints: ChromeTabCaptureAudioConstraints | false = params.audio
      ? {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: params.streamId,
          },
        }
      : false

    const videoConstraints: ChromeTabCaptureVideoConstraints = {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: params.streamId,
        minFrameRate: params.frameRate || 30,
        maxFrameRate: params.frameRate || 30,
      },
    }

    // Get media stream from the streamId provided by tabCapture.getMediaStreamId
    // Cast to MediaStreamConstraints since Chrome accepts the extended constraints
    stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: videoConstraints,
    } as MediaStreamConstraints)

    const mimeType = selectRecordingMimeType(params.audio ?? false)
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: params.videoBitsPerSecond || 2500000,
      audioBitsPerSecond: params.audioBitsPerSecond || 128000,
    })

    const startedAt = Date.now()

    recording = {
      recorder,
      stream,
      startedAt,
      tabId,
      pendingChunks: Promise.resolve(),
      cancelled: false,
      started: false,
    }
    recordings.set(tabId, recording)
    const activeRecording = recording

    // Blob conversion is asynchronous. Queue chunks per recording so a slow
    // conversion cannot reorder them, and so stop can wait for the tail chunk.
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0 || activeRecording.cancelled) {
        return
      }
      enqueueRecordingChunk(activeRecording, event.data)
    }

    recorder.onerror = (event: Event) => {
      const error = toError((event as ErrorEvent).error, `MediaRecorder failed for tab ${tabId}`)
      activeRecording.recorderError = error
      console.error(`MediaRecorder error for tab ${tabId}:`, error)
      void handleCancelRecordingForTab(tabId, activeRecording.started)
    }

    recorder.onstop = () => {
      console.log(`MediaRecorder stopped for tab ${tabId}`)
    }

    // Wait for MediaRecorder to actually start before returning. This ensures
    // the encoder is initialized and ready to capture frames.
    await waitForRecorderStart(recorder, tabId)
    activeRecording.started = true

    return { success: true, tabId, startedAt, mimeType: recorder.mimeType || mimeType }
  } catch (error: unknown) {
    if (recording) {
      cleanupRecording(recording)
    } else if (stream) {
      stopStream(stream)
    }
    console.error(`Failed to start recording for tab ${tabId}:`, error)
    return { success: false, error: toError(error, 'Failed to start recording').message }
  }
}

async function handleStopRecording(params: OffscreenStopRecordingMessage): Promise<OffscreenStopRecordingResult> {
  const { tabId } = params
  const recording = recordings.get(tabId)

  if (!recording) {
    return { success: false, error: `No active recording for tab ${tabId}` }
  }

  try {
    const { recorder, startedAt } = recording

    // MediaRecorder fires the final dataavailable before stop. Once stop has
    // fired, await the serial conversion/send queue so final can never overtake
    // the last media chunk.
    await waitForRecorderStop(recorder)
    await recording.pendingChunks

    if (recording.recorderError) {
      throw recording.recorderError
    }
    if (recording.chunkError) {
      throw recording.chunkError
    }
    if (recording.cancelled) {
      throw new Error(`Recording was cancelled for tab ${tabId}`)
    }

    const duration = Date.now() - startedAt

    // Await delivery of the final marker as part of the stop transaction.
    await chrome.runtime.sendMessage({
      action: 'recordingChunk',
      tabId,
      final: true,
    })

    cleanupRecording(recording)

    return { success: true, tabId, duration }
  } catch (error: unknown) {
    cleanupRecording(recording)
    console.error(`Failed to stop recording for tab ${tabId}:`, error)
    return { success: false, error: toError(error, 'Failed to stop recording').message }
  }
}

function handleIsRecording(params: OffscreenIsRecordingMessage): OffscreenIsRecordingResult {
  const { tabId } = params
  const recording = recordings.get(tabId)

  if (!recording) {
    return { isRecording: false, tabId }
  }

  return {
    isRecording: recording.recorder?.state === 'recording',
    tabId,
    startedAt: recording.startedAt,
  }
}

async function handleCancelRecording(params: OffscreenCancelRecordingMessage): Promise<OffscreenCancelRecordingResult> {
  const { tabId } = params
  return handleCancelRecordingForTab(tabId)
}

// Helper function to cancel recording for a specific tab - used by error handlers too
async function handleCancelRecordingForTab(
  tabId: number,
  notifyBackground = true,
): Promise<OffscreenCancelRecordingResult> {
  const recording = recordings.get(tabId)

  if (!recording) {
    return { success: true, tabId }
  }

  try {
    cleanupRecording(recording)

    if (notifyBackground) {
      await chrome.runtime.sendMessage({
        action: 'recordingCancelled',
        tabId,
      })
    }

    return { success: true, tabId }
  } catch (error: unknown) {
    // Cleanup is idempotent and must also run if notification fails.
    cleanupRecording(recording)
    console.error(`Failed to cancel recording for tab ${tabId}:`, error)
    return { success: false, error: toError(error, 'Failed to cancel recording').message }
  }
}

function enqueueRecordingChunk(recording: OffscreenRecordingState, blob: Blob): void {
  recording.pendingChunks = recording.pendingChunks.then(async () => {
    if (recording.cancelled || recording.chunkError) {
      return
    }

    try {
      const arrayBuffer = await blob.arrayBuffer()
      if (recording.cancelled) {
        return
      }

      const uint8Array = new Uint8Array(arrayBuffer)
      await chrome.runtime.sendMessage({
        action: 'recordingChunk',
        tabId: recording.tabId,
        data: Array.from(uint8Array),
      })
    } catch (error: unknown) {
      recording.chunkError = toError(error, `Failed to process recording chunk for tab ${recording.tabId}`)
      console.error(`Failed to process recording chunk for tab ${recording.tabId}:`, error)
    }
  })
}

function selectRecordingMimeType(audio: boolean): string {
  const candidates = audio
    ? [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
    : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
  if (!mimeType) {
    throw new Error('This browser does not support an available screen recording format')
  }
  return mimeType
}

function waitForRecorderStart(recorder: MediaRecorder, tabId: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanupListeners = () => {
      clearTimeout(timeout)
      recorder.removeEventListener('start', onStart)
      recorder.removeEventListener('error', onError)
    }
    const onStart = () => {
      cleanupListeners()
      console.log(`MediaRecorder started for tab ${tabId}`)
      resolve()
    }
    const onError = (event: Event) => {
      cleanupListeners()
      reject(toError((event as ErrorEvent).error, `MediaRecorder failed to start for tab ${tabId}`))
    }
    const timeout = setTimeout(() => {
      cleanupListeners()
      reject(new Error('MediaRecorder failed to start within 5 seconds'))
    }, 5000)

    recorder.addEventListener('start', onStart)
    recorder.addEventListener('error', onError)
    try {
      // Start with 1 second chunks.
      recorder.start(1000)
    } catch (error: unknown) {
      cleanupListeners()
      reject(error)
    }
  })
}

function waitForRecorderStop(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === 'inactive') {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const cleanupListeners = () => {
      clearTimeout(timeout)
      recorder.removeEventListener('stop', onStop)
      recorder.removeEventListener('error', onError)
    }
    const onStop = () => {
      cleanupListeners()
      resolve()
    }
    const onError = (event: Event) => {
      cleanupListeners()
      reject(toError((event as ErrorEvent).error, 'MediaRecorder failed while stopping'))
    }
    const timeout = setTimeout(() => {
      cleanupListeners()
      reject(new Error('MediaRecorder failed to stop within 5 seconds'))
    }, 5000)

    recorder.addEventListener('stop', onStop)
    recorder.addEventListener('error', onError)
    try {
      recorder.stop()
    } catch (error: unknown) {
      cleanupListeners()
      reject(error)
    }
  })
}

function cleanupRecording(recording: OffscreenRecordingState): void {
  recording.cancelled = true

  if (recording.recorder.state !== 'inactive') {
    try {
      recording.recorder.stop()
    } catch (error: unknown) {
      console.error(`Failed to stop MediaRecorder for tab ${recording.tabId}:`, error)
    }
  }
  stopStream(recording.stream)

  if (recordings.get(recording.tabId) === recording) {
    recordings.delete(recording.tabId)
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error
  }
  if (typeof error === 'string' && error) {
    return new Error(error)
  }
  return new Error(fallbackMessage)
}

console.log('Penguin Browser offscreen document loaded')
