import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { RecordingRelay, resolveRecordingOutputPath } from '../src/media/recording-relay.js'

describe('resolveRecordingOutputPath', () => {
  test('matches the filename extension to the actual media container', () => {
    const recordingsDir = path.join('recordings')
    expect([
      resolveRecordingOutputPath(path.join(recordingsDir, 'capture.mp4'), 'video/webm;codecs=vp8'),
      resolveRecordingOutputPath(path.join(recordingsDir, 'capture.webm'), 'video/mp4;codecs=avc1.42E01E'),
      resolveRecordingOutputPath(path.join(recordingsDir, 'capture'), 'video/webm'),
      resolveRecordingOutputPath(path.join(recordingsDir, 'capture.mp4'), undefined),
      resolveRecordingOutputPath(path.join(recordingsDir, 'capture.custom'), 'video/unknown'),
    ]).toEqual([
      path.join(recordingsDir, 'capture.webm'),
      path.join(recordingsDir, 'capture.mp4'),
      path.join(recordingsDir, 'capture.webm'),
      path.join(recordingsDir, 'capture.mp4'),
      path.join(recordingsDir, 'capture.custom'),
    ])
  })
})

describe('RecordingRelay MIME propagation', () => {
  test('writes WebM fallback bytes to a .webm path and reports the actual MIME type', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'penguin-recording-relay-'))
    const requestedPath = path.join(tempDir, 'capture.mp4')
    const expectedPath = path.join(tempDir, 'capture.webm')
    const chunk = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
    let relay: RecordingRelay

    const sendToExtension = async ({ method }: { method: string }): Promise<unknown> => {
      if (method === 'startRecording') {
        return {
          success: true,
          tabId: 7,
          startedAt: 100,
          mimeType: 'video/webm;codecs=vp8',
        }
      }
      if (method === 'stopRecording') {
        relay.handleRecordingData({ method: 'recordingData', params: { tabId: 7 } })
        relay.handleBinaryData(chunk)
        relay.handleRecordingData({ method: 'recordingData', params: { tabId: 7, final: true } })
        return { success: true, tabId: 7, duration: 1 }
      }
      throw new Error(`Unexpected extension method: ${method}`)
    }

    relay = new RecordingRelay(sendToExtension, () => true)

    try {
      await expect(relay.startRecording({ outputPath: requestedPath })).resolves.toEqual({
        success: true,
        tabId: 7,
        startedAt: 100,
        mimeType: 'video/webm;codecs=vp8',
        outputPath: expectedPath,
      })

      await expect(relay.stopRecording({})).resolves.toMatchObject({
        success: true,
        tabId: 7,
        path: expectedPath,
        size: chunk.length,
        mimeType: 'video/webm;codecs=vp8',
      })
      expect(fs.readFileSync(expectedPath)).toEqual(chunk)
      expect(fs.existsSync(requestedPath)).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('marks recording status authoritative only after an extension response', async () => {
    const connectedRelay = new RecordingRelay(
      async () => ({ isRecording: true, tabId: 7, startedAt: 100 }),
      () => true,
    )
    const disconnectedRelay = new RecordingRelay(
      async () => ({ isRecording: true }),
      () => false,
    )
    const failingRelay = new RecordingRelay(
      async () => {
        throw new Error('extension timed out')
      },
      () => true,
    )

    await expect(connectedRelay.isRecording({ sessionId: 'pw-tab-7' })).resolves.toEqual({
      isRecording: true,
      tabId: 7,
      startedAt: 100,
      authoritative: true,
    })
    await expect(disconnectedRelay.isRecording({})).resolves.toEqual({
      isRecording: false,
      authoritative: false,
    })
    await expect(failingRelay.isRecording({})).resolves.toEqual({
      isRecording: false,
      authoritative: false,
    })
  })

  test('concurrent stops send one extension request and share the final recording result', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'penguin-recording-concurrent-stop-'))
    const outputPath = path.join(tempDir, 'capture.mp4')
    const chunk = Buffer.from('final recording bytes')
    let relay: RecordingRelay
    let stopRequests = 0
    let resolveExtensionStop: ((result: { success: true; tabId: number; duration: number }) => void) | undefined

    const extensionStop = new Promise<{ success: true; tabId: number; duration: number }>((resolve) => {
      resolveExtensionStop = resolve
    })
    const sendToExtension = async ({ method }: { method: string }): Promise<unknown> => {
      if (method === 'startRecording') {
        return { success: true, tabId: 9, startedAt: 100, mimeType: 'video/mp4' }
      }
      if (method === 'stopRecording') {
        stopRequests += 1
        return extensionStop
      }
      throw new Error(`Unexpected extension method: ${method}`)
    }
    relay = new RecordingRelay(sendToExtension, () => true)

    try {
      await relay.startRecording({ outputPath })
      const firstStop = relay.stopRecording({})
      await Promise.resolve()

      expect(stopRequests).toBe(1)
      relay.handleRecordingData({ method: 'recordingData', params: { tabId: 9 } })
      relay.handleBinaryData(chunk)
      relay.handleRecordingData({ method: 'recordingData', params: { tabId: 9, final: true } })
      const secondStop = relay.stopRecording({})
      resolveExtensionStop?.({ success: true, tabId: 9, duration: 1 })

      const [firstResult, secondResult] = await Promise.all([firstStop, secondStop])
      expect(firstResult).toEqual(secondResult)
      expect(firstResult).toMatchObject({
        success: true,
        tabId: 9,
        path: outputPath,
        size: chunk.length,
        mimeType: 'video/mp4',
      })
      expect(fs.readFileSync(outputPath)).toEqual(chunk)
      await expect(relay.stopRecording({})).resolves.toEqual({
        success: false,
        error: 'No active recording found',
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('a stop arriving after cancellation joins the pending extension response', async () => {
    vi.useFakeTimers()
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'penguin-recording-concurrent-cancel-'))
    let stopRequests = 0
    let resolveExtensionStop: ((result: { success: true; tabId: number; duration: number }) => void) | undefined
    const extensionStop = new Promise<{ success: true; tabId: number; duration: number }>((resolve) => {
      resolveExtensionStop = resolve
    })
    const relay = new RecordingRelay(
      async ({ method }) => {
        if (method === 'startRecording') {
          return { success: true, tabId: 11, startedAt: 100, mimeType: 'video/mp4' }
        }
        stopRequests += 1
        return extensionStop
      },
      () => true,
    )

    try {
      await relay.startRecording({ outputPath: path.join(tempDir, 'capture.mp4') })
      const firstStop = relay.stopRecording({})
      await Promise.resolve()
      relay.handleRecordingCancelled({ method: 'recordingCancelled', params: { tabId: 11 } })
      const secondStop = relay.stopRecording({})
      resolveExtensionStop?.({ success: true, tabId: 11, duration: 1 })

      await expect(Promise.all([firstStop, secondStop])).resolves.toEqual([
        { success: false, error: 'Recording was cancelled' },
        { success: false, error: 'Recording was cancelled' },
      ])
      expect(stopRequests).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test.each([
    {
      name: 'extension failure',
      sendStop: async () => ({ success: false as const, error: 'encoder stop failed' }),
      advanceTimers: async () => {},
      expectedError: 'encoder stop failed',
    },
    {
      name: 'final-data timeout',
      sendStop: async () => ({ success: true as const, tabId: 10, duration: 1 }),
      advanceTimers: async () => {
        await vi.advanceTimersByTimeAsync(30000)
      },
      expectedError: 'Timeout waiting for recording data',
    },
  ])(
    'concurrent stops share one $name result and clear pending state',
    async ({ sendStop, advanceTimers, expectedError }) => {
      vi.useFakeTimers()
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'penguin-recording-concurrent-failure-'))
      let stopRequests = 0
      const relay = new RecordingRelay(
        async ({ method }) => {
          if (method === 'startRecording') {
            return { success: true, tabId: 10, startedAt: 100, mimeType: 'video/mp4' }
          }
          stopRequests += 1
          return sendStop()
        },
        () => true,
      )

      try {
        await relay.startRecording({ outputPath: path.join(tempDir, 'capture.mp4') })
        const firstStop = relay.stopRecording({})
        const secondStop = relay.stopRecording({})
        await advanceTimers()

        await expect(Promise.all([firstStop, secondStop])).resolves.toEqual([
          { success: false, error: expectedError },
          { success: false, error: expectedError },
        ])
        expect(stopRequests).toBe(1)
        expect(vi.getTimerCount()).toBe(0)
        await expect(relay.stopRecording({})).resolves.toEqual({
          success: false,
          error: 'No active recording found',
        })
      } finally {
        vi.useRealTimers()
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    },
  )

  test.each([
    {
      name: 'extension failure result',
      stopResult: async () => ({ success: false, error: 'encoder stop failed' }),
      expectedError: 'encoder stop failed',
    },
    {
      name: 'extension transport error',
      stopResult: async () => {
        throw new Error('extension disconnected')
      },
      expectedError: 'extension disconnected',
    },
  ])('clears the final-data timer after $name', async ({ stopResult, expectedError }) => {
    vi.useFakeTimers()
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'penguin-recording-stop-failure-'))
    const relay = new RecordingRelay(
      async ({ method }) => {
        if (method === 'startRecording') {
          return { success: true, tabId: 8, startedAt: 100, mimeType: 'video/mp4' }
        }
        return await stopResult()
      },
      () => true,
    )

    try {
      await relay.startRecording({ outputPath: path.join(tempDir, 'capture.mp4') })
      await expect(relay.stopRecording({})).resolves.toEqual({ success: false, error: expectedError })
      expect(vi.getTimerCount()).toBe(0)
      await expect(relay.stopRecording({})).resolves.toEqual({
        success: false,
        error: 'No active recording found',
      })
    } finally {
      vi.useRealTimers()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
