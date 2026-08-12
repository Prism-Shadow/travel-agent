/**
 * Recording relay functionality for the CDP relay server.
 * Handles recording state, chunk accumulation, and file writing.
 */

import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import type {
  StartRecordingParams,
  StopRecordingParams,
  IsRecordingParams,
  CancelRecordingParams,
  StartRecordingResult,
  StopRecordingResult,
  IsRecordingResult,
  CancelRecordingResult,
  RecordingDataMessage,
  RecordingCancelledMessage,
} from './protocol.js'

// Recording state - tracks active recordings and their accumulated chunks
export interface ActiveRecording {
  tabId: number
  sessionId?: string // The sessionId used to start this recording, for lookup when stopping
  outputPath: string
  chunks: Buffer[]
  startedAt: number
  mimeType?: string
  /** Shared result for callers concurrently stopping this recording. */
  stopPromise?: Promise<StopRecordingResult>
  resolveStop?: (result: StopRecordingResult) => void
}

/**
 * Keep the filename container extension aligned with MediaRecorder's actual
 * output. Older extensions do not report a MIME type, so preserve their
 * requested path for backwards compatibility.
 */
export function resolveRecordingOutputPath(outputPath: string, mimeType?: string): string {
  const normalizedMimeType = mimeType?.toLowerCase().split(';', 1)[0].trim()
  const expectedExtension =
    normalizedMimeType === 'video/webm' ? '.webm' : normalizedMimeType === 'video/mp4' ? '.mp4' : undefined
  if (!expectedExtension || path.extname(outputPath).toLowerCase() === expectedExtension) {
    return outputPath
  }

  const currentExtension = path.extname(outputPath)
  return path.join(path.dirname(outputPath), `${path.basename(outputPath, currentExtension)}${expectedExtension}`)
}

export class RecordingRelay {
  private activeRecordings = new Map<number, ActiveRecording>()
  // Track which tabId just sent recordingData metadata - used to route the next binary chunk
  private lastRecordingMetadataTabId: number | null = null
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

  /**
   * Handle incoming binary data (recording chunks) from the extension.
   */
  handleBinaryData(buffer: Buffer): void {
    const tabId = this.lastRecordingMetadataTabId
    this.lastRecordingMetadataTabId = null

    if (tabId !== null) {
      const recording = this.activeRecordings.get(tabId)
      if (recording) {
        recording.chunks.push(buffer)
        this.logger?.log(
          pc.blue(
            `Received recording chunk for tab ${tabId}: ${buffer.length} bytes (total chunks: ${recording.chunks.length})`,
          ),
        )
      } else {
        this.logger?.log(pc.yellow(`Received recording chunk for unknown tab ${tabId}, ignoring`))
      }
    } else {
      this.logger?.log(pc.yellow('Received recording chunk without preceding metadata, ignoring'))
    }
  }

  /**
   * Handle recordingData message from extension.
   */
  handleRecordingData(message: RecordingDataMessage): void {
    const { tabId, final } = message.params
    const recording = this.activeRecordings.get(tabId)

    if (!final) {
      this.lastRecordingMetadataTabId = tabId
    }

    if (recording && final) {
      const hasPendingStop = Boolean(recording.stopPromise)
      try {
        const totalSize = recording.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const combined = Buffer.concat(recording.chunks)
        fs.writeFileSync(recording.outputPath, combined)

        const duration = Date.now() - recording.startedAt
        this.logger?.log(pc.green(`Recording saved: ${recording.outputPath} (${totalSize} bytes, ${duration}ms)`))

        if (recording.resolveStop) {
          recording.resolveStop({
            success: true,
            tabId,
            duration,
            path: recording.outputPath,
            size: totalSize,
            mimeType: recording.mimeType,
          })
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.logger?.error('Failed to write recording:', error)
        if (recording.resolveStop) {
          recording.resolveStop({ success: false, error: errorMessage })
        }
      }

      // A pending stop owns cleanup in its finally block. Keep the recording
      // discoverable until the extension response also arrives so a stop call
      // made after final data can still join the same operation.
      if (!hasPendingStop) {
        this.activeRecordings.delete(tabId)
      }
    }
  }

  /**
   * Handle recordingCancelled message from extension.
   */
  handleRecordingCancelled(message: RecordingCancelledMessage): void {
    const { tabId } = message.params
    const recording = this.activeRecordings.get(tabId)
    if (recording) {
      const hasPendingStop = Boolean(recording.stopPromise)
      this.logger?.log(pc.yellow(`Recording cancelled for tab ${tabId}`))
      if (recording.resolveStop) {
        recording.resolveStop({ success: false, error: 'Recording was cancelled' })
      }
      if (!hasPendingStop) {
        this.activeRecordings.delete(tabId)
      }
    }
  }

  async startRecording(params: StartRecordingParams & { outputPath: string }): Promise<StartRecordingResult> {
    const { outputPath, ...recordingParams } = params

    if (!outputPath) {
      return { success: false, error: 'outputPath is required' }
    }

    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }

    const dir = path.dirname(outputPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    try {
      const result = (await this.sendToExtension({
        method: 'startRecording',
        params: recordingParams,
        timeout: 10000,
      })) as StartRecordingResult

      if (!result) {
        return { success: false, error: 'Extension returned empty result' }
      }

      if (result.success) {
        const resolvedOutputPath = resolveRecordingOutputPath(outputPath, result.mimeType)
        this.activeRecordings.set(result.tabId, {
          tabId: result.tabId,
          sessionId: recordingParams.sessionId,
          outputPath: resolvedOutputPath,
          chunks: [],
          startedAt: result.startedAt,
          mimeType: result.mimeType,
        })
        if (resolvedOutputPath !== outputPath) {
          this.logger?.log(
            pc.yellow(
              `Recording container ${result.mimeType} does not match ${path.extname(outputPath) || 'an extensionless path'}; output changed to ${resolvedOutputPath}`,
            ),
          )
        }
        this.logger?.log(
          pc.green(
            `Recording started for tab ${result.tabId} (sessionId: ${recordingParams.sessionId || 'none'}), output: ${resolvedOutputPath}`,
          ),
        )
        return { ...result, outputPath: resolvedOutputPath }
      }

      return result
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Start recording error:', error)
      return { success: false, error: errorMessage }
    }
  }

  async stopRecording(params: StopRecordingParams): Promise<StopRecordingResult> {
    const findRecording = (): ActiveRecording | undefined => {
      if (params.sessionId) {
        for (const recording of this.activeRecordings.values()) {
          if (recording.sessionId === params.sessionId) {
            return recording
          }
        }
        return undefined
      }
      return this.activeRecordings.values().next().value
    }

    const recording = findRecording()

    if (!recording) {
      const errorMsg = params.sessionId
        ? `No active recording found for sessionId: ${params.sessionId}`
        : 'No active recording found'
      return { success: false, error: errorMsg }
    }

    // A stop already in flight owns the extension request, final-data wait,
    // timeout, and cleanup. Join it instead of replacing resolveStop and
    // orphaning the first caller.
    if (recording.stopPromise) {
      return recording.stopPromise
    }

    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let stopSettled = false
    const clearPendingStop = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      recording.resolveStop = undefined
    }
    recording.stopPromise = new Promise<StopRecordingResult>((resolve) => {
      const wrappedResolve = (result: StopRecordingResult) => {
        if (stopSettled) return
        stopSettled = true
        clearPendingStop()
        resolve(result)
      }
      recording.resolveStop = wrappedResolve
      timeoutId = setTimeout(() => {
        wrappedResolve({ success: false, error: 'Timeout waiting for recording data' })
      }, 30000)
    })
    const finalPromise = recording.stopPromise
    const requestExtensionStop = async (): Promise<StopRecordingResult> => {
      try {
        const result = (await this.sendToExtension({
          method: 'stopRecording',
          params,
          timeout: 10000,
        })) as StopRecordingResult

        if (!result?.success) {
          recording.resolveStop?.(result || { success: false, error: 'Extension returned empty result' })
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (recording.resolveStop) {
          this.logger?.error('Stop recording error:', error)
          recording.resolveStop({ success: false, error: errorMessage })
        }
      }

      return finalPromise
    }

    // Defer the transport call by one microtask so stopPromise is visible even
    // when a test double or transport synchronously dispatches final data.
    recording.stopPromise = Promise.resolve()
      .then(requestExtensionStop)
      .finally(() => {
        clearPendingStop()
        if (this.activeRecordings.get(recording.tabId) === recording) {
          this.activeRecordings.delete(recording.tabId)
        }
      })

    return recording.stopPromise
  }

  async isRecording(params: IsRecordingParams): Promise<IsRecordingResult> {
    if (!this.isExtensionConnected()) {
      return { isRecording: false, authoritative: false }
    }

    try {
      const result = (await this.sendToExtension({
        method: 'isRecording',
        params,
        timeout: 5000,
      })) as IsRecordingResult
      return { ...result, authoritative: true }
    } catch {
      return { isRecording: false, authoritative: false }
    }
  }

  async cancelRecording(params: CancelRecordingParams): Promise<CancelRecordingResult> {
    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }

    try {
      return (await this.sendToExtension({
        method: 'cancelRecording',
        params,
        timeout: 5000,
      })) as CancelRecordingResult
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Cancel recording error:', error)
      return { success: false, error: errorMessage }
    }
  }
}
