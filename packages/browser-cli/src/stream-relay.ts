/**
 * Streaming relay functionality for the CDP relay server.
 *
 * Reuses the recording pipeline (extension chrome.tabCapture + MediaRecorder
 * sends fragmented MP4 chunks over WS) but instead of accumulating chunks in
 * memory like RecordingRelay, pipes each chunk to an ffmpeg child process that
 * re-encodes in real time and pushes to one or more RTMP destinations.
 *
 * IMPORTANT findings baked into this design:
 * - The extension prefers fragmented MP4 and falls back to WebM when the
 *   browser does not support MP4. Both containers pipe into `ffmpeg -i pipe:0`
 *   because ffmpeg probes the init/header chunk without seeking.
 * - The input is already H.264/AAC but VFR with uncontrolled keyframes, so we
 *   must re-encode to satisfy RTMP platform keyframe rules (X Live: <=3s,
 *   Twitch: 2s recommended). We use a 2s GOP which satisfies both.
 * - No WS protocol changes: streaming reuses startRecording/stopRecording/
 *   recordingData messages, so old extensions keep working.
 * - ffmpeg lives in the relay process, so streams survive CLI exit and run
 *   indefinitely (the 15-min recording auto-stop is client-side only).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import pc from 'picocolors'
import type {
  StartStreamParams,
  StartStreamResult,
  StopStreamParams,
  StopStreamResult,
  StreamStatusResult,
  StreamStats,
  StartRecordingResult,
  StopRecordingParams,
  RecordingDataMessage,
  RecordingCancelledMessage,
} from './protocol.js'
import { detectEncoder } from './ffmpeg.js'

/** Max bytes allowed to sit in ffmpeg's stdin buffer before we consider the
 *  encoder stalled (dead RTMP endpoint, encoder too slow) and kill the stream.
 *  Never buffer unbounded in the relay process. */
const MAX_STDIN_BUFFERED_BYTES = 32 * 1024 * 1024

/** Number of ffmpeg stderr lines kept for error reporting */
const STDERR_RING_SIZE = 30

export interface StreamFfmpegOptions {
  rtmpUrls: string[]
  width: number
  height: number
  fps: number
  videoBitrateKbps: number
  audioBitrateKbps: number
  /** true = use tab audio from the capture; false = inject silent audio track */
  audio: boolean
  /** x264 preset, only applied for libx264 */
  preset: string
  /** ffmpeg -c:v value, e.g. libx264 or h264_videotoolbox */
  codec: string
  /** Keyframe interval in seconds. Default 3 (X Live recommended, also its max).
   *  Twitch recommends 2. */
  keyframeSeconds: number
}

/**
 * Build the ffmpeg argv for live RTMP streaming. Pure function, exported for
 * snapshot testing.
 *
 * - GOP = keyframeSeconds*fps. Default 3s matches X Live's recommended encoder
 *   settings (and its max). Pass 2 for Twitch's recommendation.
 * - `-tune zerolatency` only for libx264 (hardware encoders reject it)
 * - When audio is disabled we inject anullsrc because X Live rejects streams
 *   without an audio track. `-shortest` makes the infinite silent source stop
 *   when the video input ends.
 * - Multiple destinations use the tee muxer with onfail=ignore so one dead
 *   endpoint doesn't kill the others. tee requires `-flags +global_header`.
 */
export function buildStreamFfmpegArgs(options: StreamFfmpegOptions): string[] {
  const { rtmpUrls, width, height, fps, videoBitrateKbps, audioBitrateKbps, audio, preset, codec, keyframeSeconds } =
    options

  if (rtmpUrls.length === 0) {
    throw new Error('At least one RTMP destination is required')
  }

  const gop = Math.round(fps * keyframeSeconds)

  const inputArgs = audio ? ['-i', 'pipe:0'] : ['-i', 'pipe:0', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']

  const mapArgs = audio ? ['-map', '0:v:0', '-map', '0:a:0'] : ['-map', '0:v:0', '-map', '1:a:0', '-shortest']

  const codecArgs: string[] = (() => {
    const base = [
      '-c:v',
      codec,
      '-b:v',
      `${videoBitrateKbps}k`,
      '-maxrate',
      `${videoBitrateKbps}k`,
      '-bufsize',
      `${videoBitrateKbps * 2}k`,
      '-pix_fmt',
      'yuv420p',
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
    ]
    if (codec === 'libx264') {
      return [...base, '-preset', preset, '-tune', 'zerolatency', '-sc_threshold', '0']
    }
    if (codec === 'h264_videotoolbox') {
      return [...base, '-realtime', 'true']
    }
    return base
  })()

  const outputArgs: string[] = (() => {
    if (rtmpUrls.length === 1) {
      return ['-f', 'flv', rtmpUrls[0]]
    }
    // - onfail=ignore: a failed slave doesn't terminate ffmpeg
    // - use_fifo: each slave gets its own thread+FIFO, so a connected-but-stalled
    //   destination can't block the tee muxer and stall the other outputs
    // - tee-special characters (| [ ] \) in URLs must be backslash-escaped or
    //   they corrupt the tee specification
    const tee = rtmpUrls.map((url) => `[f=flv:onfail=ignore]${escapeTeeUrl(url)}`).join('|')
    return [
      '-flags',
      '+global_header',
      '-f',
      'tee',
      '-use_fifo',
      '1',
      '-fifo_options',
      'attempt_recovery=1:recover_any_error=1',
      tee,
    ]
  })()

  return [
    '-hide_banner',
    '-nostdin',
    ...inputArgs,
    ...mapArgs,
    '-vf',
    `scale=${width}:${height}`,
    '-r',
    String(fps),
    ...codecArgs,
    '-c:a',
    'aac',
    '-b:a',
    `${audioBitrateKbps}k`,
    '-ar',
    '44100',
    '-ac',
    '2',
    ...outputArgs,
  ]
}

/** Escape characters that are special to ffmpeg's tee muxer slave syntax. */
export function escapeTeeUrl(url: string): string {
  return url.replace(/([\\|\[\]])/g, '\\$1')
}

/**
 * Redact the stream key from an RTMP URL for logging/status.
 * RTMP URLs contain secrets (rtmp://host/app/STREAM_KEY) - never log them fully.
 * File paths (used in tests) are returned as-is.
 */
export function redactStreamUrl(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return url
  }
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}/…`
  } catch {
    return url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/]+).*$/i, '$1/…')
  }
}

/** Parse an ffmpeg progress line like:
 *  `frame=  123 fps= 30 q=28.0 size=1024KiB time=00:00:04.10 bitrate=2045.6kbits/s drop=0 speed=1x` */
export function parseFfmpegProgressLine(line: string): {
  fps?: number
  bitrateKbps?: number
  droppedFrames?: number
} | null {
  if (!line.includes('frame=')) {
    return null
  }
  const fpsMatch = line.match(/\bfps=\s*([\d.]+)/)
  const bitrateMatch = line.match(/\bbitrate=\s*([\d.]+)kbits\/s/)
  const dropMatch = line.match(/\bdrop=\s*(\d+)/)
  return {
    fps: fpsMatch ? Number(fpsMatch[1]) : undefined,
    bitrateKbps: bitrateMatch ? Number(bitrateMatch[1]) : undefined,
    droppedFrames: dropMatch ? Number(dropMatch[1]) : undefined,
  }
}

interface ActiveStream {
  tabId: number
  sessionId?: string
  ffmpeg: ChildProcessWithoutNullStreams
  /** Redacted destinations, safe for logs and status */
  destinations: string[]
  /** Raw destination URLs (contain stream keys!) - only used to sanitize
   *  ffmpeg stderr, never logged or returned. */
  rawUrls: string[]
  startedAt: number
  stats: StreamStats
  stderrRing: string[]
  /** Set while stopStream is waiting for the final chunk + ffmpeg exit */
  stopping: boolean
  /** Error recorded during the stop flow (extension stop failed, timeout,
   *  forced kill). When set, the close handler reports failure, never a
   *  false success. */
  stopFailure?: string
  /** Shared stop promise so concurrent stopStream() calls all settle with the
   *  same result instead of overwriting each other's resolver. */
  stopPromise?: Promise<StopStreamResult>
  resolveStop?: (result: StopStreamResult) => void
}

export class StreamRelay {
  private activeStreams = new Map<number, ActiveStream>()
  // Which tabId just sent recordingData metadata - routes the next binary chunk.
  // Each relay (RecordingRelay, StreamRelay) tracks its own; tabId sets are
  // disjoint because the extension refuses a second capture of the same tab.
  private lastMetadataTabId: number | null = null
  /** Error info from the last stream that died unexpectedly, for status reporting */
  private lastStreamError: { tabId: number; error: string } | null = null
  private sendToExtension: (params: { method: string; params?: unknown; timeout?: number }) => Promise<unknown>
  private isExtensionConnected: () => boolean
  private logger?: { log(...args: unknown[]): void; error(...args: unknown[]): void }

  constructor(
    sendToExtension: (params: { method: string; params?: unknown; timeout?: number }) => Promise<unknown>,
    isExtensionConnected: () => boolean,
    logger?: { log(...args: unknown[]): void; error(...args: unknown[]): void },
  ) {
    this.sendToExtension = sendToExtension
    this.isExtensionConnected = isExtensionConnected
    this.logger = logger
  }

  /** Handle incoming binary data (capture chunks) from the extension.
   *  Returns true when the chunk belonged to an active stream. */
  handleBinaryData(buffer: Buffer): boolean {
    const tabId = this.lastMetadataTabId
    this.lastMetadataTabId = null

    if (tabId === null) {
      return false
    }
    const stream = this.activeStreams.get(tabId)
    if (!stream) {
      return false
    }

    stream.stats.chunksReceived += 1
    stream.stats.bytesReceived += buffer.length

    const stdin = stream.ffmpeg.stdin
    if (!stdin.writable) {
      return true
    }

    // Backpressure: if ffmpeg can't keep up (dead RTMP endpoint, slow encoder),
    // stdin buffers grow. Never buffer unbounded - kill the stream instead.
    if (stdin.writableLength > MAX_STDIN_BUFFERED_BYTES) {
      this.failStream(stream, `ffmpeg stalled: ${stdin.writableLength} bytes buffered in stdin`)
      return true
    }

    stdin.write(buffer)
    return true
  }

  /** Handle recordingData message from extension. Returns true when it belonged
   *  to an active stream (so cdp-relay can skip logging noise). */
  handleRecordingData(message: RecordingDataMessage): boolean {
    const { tabId, final } = message.params
    const stream = this.activeStreams.get(tabId)

    if (!stream) {
      return false
    }

    if (!final) {
      this.lastMetadataTabId = tabId
      return true
    }

    // Final message: extension stopped capturing. Close ffmpeg stdin so it
    // flushes and exits; the 'close' handler resolves the pending stop.
    this.logger?.log(pc.blue(`Stream final chunk received for tab ${tabId}, closing ffmpeg stdin`))
    stream.ffmpeg.stdin.end()
    return true
  }

  handleRecordingCancelled(message: RecordingCancelledMessage): boolean {
    const { tabId } = message.params
    const stream = this.activeStreams.get(tabId)
    if (!stream) {
      return false
    }
    this.logger?.log(pc.yellow(`Stream capture cancelled for tab ${tabId}`))
    this.failStream(stream, 'Capture was cancelled')
    return true
  }

  hasActiveStreamForTab(tabId: number): boolean {
    return this.activeStreams.has(tabId)
  }

  async startStream(params: StartStreamParams): Promise<StartStreamResult> {
    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }
    if (!params.rtmpUrls || params.rtmpUrls.length === 0) {
      return { success: false, error: 'rtmpUrls is required' }
    }

    // Defaults match X Live's recommended encoder settings:
    // 1920x1080, 9000 kbps H.264, 30 fps, 3s keyframes, AAC 128k 44100Hz stereo
    const resolution = params.resolution || '1920x1080'
    const resolutionMatch = resolution.match(/^(\d+)x(\d+)$/)
    if (!resolutionMatch) {
      return { success: false, error: `Invalid resolution "${resolution}", expected WxH like 1920x1080` }
    }
    const width = Number(resolutionMatch[1])
    const height = Number(resolutionMatch[2])
    const fps = params.fps || 30
    const videoBitrateKbps = params.videoBitrateKbps || 9000
    const audioBitrateKbps = params.audioBitrateKbps || 128
    const audio = params.audio !== false
    const preset = params.preset || 'veryfast'
    const codec = params.codec || (await detectEncoder()).codec
    const keyframeSeconds = params.keyframeSeconds || 3

    const ffmpegArgs = buildStreamFfmpegArgs({
      rtmpUrls: params.rtmpUrls,
      width,
      height,
      fps,
      videoBitrateKbps,
      audioBitrateKbps,
      audio,
      preset,
      codec,
      keyframeSeconds,
    })

    const destinations = params.rtmpUrls.map(redactStreamUrl)
    this.logger?.log(
      pc.blue(
        `Starting stream: ffmpeg ${ffmpegArgs.slice(0, -1).join(' ')} <dest redacted: ${destinations.join(', ')}>`,
      ),
    )

    // Spawn ffmpeg first so we fail fast on missing binary or bad args
    let ffmpeg: ChildProcessWithoutNullStreams
    try {
      ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: `Failed to spawn ffmpeg: ${errorMessage}` }
    }

    const spawnError = await new Promise<string | null>((resolve) => {
      const onSpawn = () => {
        ffmpeg.removeListener('error', onError)
        resolve(null)
      }
      const onError = (err: Error) => {
        ffmpeg.removeListener('spawn', onSpawn)
        resolve(err.message.includes('ENOENT') ? 'ffmpeg not found. Install ffmpeg to use streaming.' : err.message)
      }
      ffmpeg.once('spawn', onSpawn)
      ffmpeg.once('error', onError)
    })
    if (spawnError) {
      return { success: false, error: spawnError }
    }

    // Ask the extension to start capturing the tab (same WS message as recording)
    let result: StartRecordingResult
    try {
      result = (await this.sendToExtension({
        method: 'startRecording',
        params: {
          sessionId: params.sessionId,
          frameRate: fps,
          audio,
          videoBitsPerSecond: videoBitrateKbps * 1000,
          audioBitsPerSecond: audioBitrateKbps * 1000,
        },
        timeout: 10000,
      })) as StartRecordingResult
    } catch (error: unknown) {
      ffmpeg.kill('SIGKILL')
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }

    if (!result || !result.success) {
      ffmpeg.kill('SIGKILL')
      return { success: false, error: result?.error || 'Extension returned empty result' }
    }

    const stream: ActiveStream = {
      tabId: result.tabId,
      sessionId: params.sessionId,
      ffmpeg,
      destinations,
      rawUrls: params.rtmpUrls,
      startedAt: result.startedAt,
      stats: { chunksReceived: 0, bytesReceived: 0 },
      stderrRing: [],
      stopping: false,
    }
    this.activeStreams.set(result.tabId, stream)
    this.lastStreamError = null
    this.wireFfmpegHandlers(stream)

    this.logger?.log(
      pc.green(
        `Stream started for tab ${result.tabId} → ${destinations.join(', ')} (${width}x${height}@${fps}fps, ${videoBitrateKbps}kbps, codec ${codec})`,
      ),
    )

    return { success: true, tabId: result.tabId, startedAt: result.startedAt, destinations }
  }

  private wireFfmpegHandlers(stream: ActiveStream): void {
    const { ffmpeg, tabId } = stream

    ffmpeg.stdout.on('data', () => {
      // flv goes to the destinations, stdout should be empty; drain anyway
    })

    let stderrRemainder = ''
    ffmpeg.stderr.on('data', (data: Buffer) => {
      stderrRemainder += data.toString()
      // ffmpeg progress lines end with \r, errors with \n
      const lines = stderrRemainder.split(/[\r\n]+/)
      stderrRemainder = lines.pop() || ''
      for (const line of lines) {
        const rawLine = line.trim()
        if (!rawLine) {
          continue
        }
        // ffmpeg errors (connection/auth failures) echo the full output URL
        // including the stream key. Redact before storing: stderrRing flows
        // into logs and /stream/status.
        const trimmed = stream.rawUrls.reduce((acc, url) => {
          return acc.replaceAll(url, redactStreamUrl(url))
        }, rawLine)
        const progress = parseFfmpegProgressLine(trimmed)
        if (progress) {
          stream.stats.ffmpegFps = progress.fps ?? stream.stats.ffmpegFps
          stream.stats.ffmpegBitrateKbps = progress.bitrateKbps ?? stream.stats.ffmpegBitrateKbps
          stream.stats.droppedFrames = progress.droppedFrames ?? stream.stats.droppedFrames
          stream.stats.lastFfmpegLine = trimmed
        } else {
          stream.stderrRing.push(trimmed)
          if (stream.stderrRing.length > STDERR_RING_SIZE) {
            stream.stderrRing.shift()
          }
        }
      }
    })

    ffmpeg.stdin.on('error', () => {
      // EPIPE when ffmpeg dies mid-write; the 'close' handler does the cleanup
    })

    ffmpeg.on('close', (code) => {
      const current = this.activeStreams.get(tabId)
      if (current !== stream) {
        return
      }

      if (stream.stopping) {
        const duration = Date.now() - stream.startedAt
        this.activeStreams.delete(tabId)

        // Never report a false success: a stop-flow failure (extension stop
        // error, timeout + SIGKILL) or a nonzero exit means the stream did
        // not end gracefully.
        if (stream.stopFailure) {
          this.logger?.error(pc.red(`Stream stop failed for tab ${tabId}: ${stream.stopFailure}`))
          stream.resolveStop?.({ success: false, error: stream.stopFailure })
          return
        }
        if (code !== 0) {
          const stderrTail = stream.stderrRing.slice(-5).join('\n')
          const error = `ffmpeg exited with code ${code} during stop${stderrTail ? `:\n${stderrTail}` : ''}`
          this.logger?.error(pc.red(`Stream stop failed for tab ${tabId}: ${error}`))
          stream.resolveStop?.({ success: false, error })
          return
        }

        this.logger?.log(pc.green(`Stream ended for tab ${tabId} (${duration}ms, ${stream.stats.bytesReceived} bytes)`))
        stream.resolveStop?.({
          success: true,
          tabId,
          duration,
          bytesReceived: stream.stats.bytesReceived,
        })
        return
      }

      // Unexpected exit: RTMP endpoint died, encoder crash, etc.
      const stderrTail = stream.stderrRing.slice(-5).join('\n')
      const error = `ffmpeg exited unexpectedly (code ${code})${stderrTail ? `:\n${stderrTail}` : ''}`
      this.logger?.error(pc.red(`Stream for tab ${tabId} died: ${error}`))
      this.activeStreams.delete(tabId)
      this.lastStreamError = { tabId, error }
      // Stop the extension capture so chunks stop flowing
      this.sendToExtension({ method: 'cancelRecording', params: { sessionId: stream.sessionId }, timeout: 5000 }).catch(
        () => {},
      )
    })
  }

  private failStream(stream: ActiveStream, error: string): void {
    this.logger?.error(pc.red(`Stream for tab ${stream.tabId} failed: ${error}`))
    this.activeStreams.delete(stream.tabId)
    this.lastStreamError = { tabId: stream.tabId, error }
    stream.ffmpeg.kill('SIGKILL')
    stream.resolveStop?.({ success: false, error })
    this.sendToExtension({ method: 'cancelRecording', params: { sessionId: stream.sessionId }, timeout: 5000 }).catch(
      () => {},
    )
  }

  private findStream(sessionId?: string): ActiveStream | undefined {
    if (sessionId) {
      for (const stream of this.activeStreams.values()) {
        if (stream.sessionId === sessionId) {
          return stream
        }
      }
      return undefined
    }
    return this.activeStreams.values().next().value
  }

  async stopStream(params: StopStreamParams): Promise<StopStreamResult> {
    const stream = this.findStream(params.sessionId)
    if (!stream) {
      const errorMsg = params.sessionId
        ? `No active stream found for sessionId: ${params.sessionId}`
        : 'No active stream found'
      return { success: false, error: errorMsg }
    }

    // Concurrent stop calls share one promise. Never overwrite resolveStop:
    // the second caller would orphan the first one's promise forever.
    if (stream.stopPromise) {
      return stream.stopPromise
    }

    stream.stopping = true

    let timeoutId: ReturnType<typeof setTimeout>
    stream.stopPromise = new Promise<StopStreamResult>((resolve) => {
      stream.resolveStop = (result) => {
        clearTimeout(timeoutId)
        resolve(result)
      }
      timeoutId = setTimeout(() => {
        // ffmpeg refused to exit after final chunk: mark the failure BEFORE
        // killing, so the 'close' handler reports failure instead of success.
        stream.stopFailure = 'Timeout waiting for ffmpeg to exit'
        this.logger?.error(pc.red(`Stream stop timeout for tab ${stream.tabId}, killing ffmpeg`))
        stream.ffmpeg.kill('SIGKILL')
        // Absolute fallback if even 'close' never fires
        setTimeout(() => {
          if (this.activeStreams.get(stream.tabId) === stream) {
            this.activeStreams.delete(stream.tabId)
            resolve({ success: false, error: 'Timeout waiting for ffmpeg to exit' })
          }
        }, 5000)
      }, 30000)
    })

    const requestExtensionStop = async (): Promise<void> => {
      if (!this.isExtensionConnected()) {
        stream.ffmpeg.stdin.end()
        return
      }
      try {
        const stopParams: StopRecordingParams = stream.sessionId ? { sessionId: stream.sessionId } : {}
        const result = (await this.sendToExtension({
          method: 'stopRecording',
          params: stopParams,
          timeout: 10000,
        })) as { success: boolean; error?: string } | undefined
        if (!result?.success) {
          // Extension reports failures as { success: false } without throwing.
          // No final chunk will arrive: mark the failure and close stdin so
          // ffmpeg flushes and exits instead of hanging until the timeout.
          stream.stopFailure = `Extension stopRecording failed: ${result?.error || 'empty result'}`
          this.logger?.error('Stop stream:', stream.stopFailure)
          stream.ffmpeg.stdin.end()
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        stream.stopFailure = `Extension stopRecording failed: ${errorMessage}`
        this.logger?.error('Stop stream: extension stopRecording failed:', error)
        stream.ffmpeg.stdin.end()
      }
    }

    await requestExtensionStop()

    return stream.stopPromise
  }

  streamStatus(params: { sessionId?: string }): StreamStatusResult {
    const stream = this.findStream(params.sessionId)
    if (!stream) {
      const result: StreamStatusResult = { streaming: false }
      if (this.lastStreamError) {
        result.tabId = this.lastStreamError.tabId
        result.error = this.lastStreamError.error
      }
      return result
    }
    return {
      streaming: true,
      tabId: stream.tabId,
      startedAt: stream.startedAt,
      destinations: stream.destinations,
      stats: { ...stream.stats },
    }
  }

  /** Kill all active streams (extension disconnected, relay shutting down). */
  destroyAll(reason: string): void {
    for (const stream of [...this.activeStreams.values()]) {
      this.logger?.log(pc.yellow(`Destroying stream for tab ${stream.tabId}: ${reason}`))
      this.activeStreams.delete(stream.tabId)
      this.lastStreamError = { tabId: stream.tabId, error: reason }
      stream.ffmpeg.kill('SIGKILL')
      stream.resolveStop?.({ success: false, error: reason })
    }
  }

  get hasActiveStreams(): boolean {
    return this.activeStreams.size > 0
  }
}
