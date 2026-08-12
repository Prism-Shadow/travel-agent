import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface OffscreenMessage {
  action: 'startRecording' | 'stopRecording' | 'isRecording' | 'cancelRecording'
  tabId: number
  streamId?: string
  audio?: boolean
}

interface BlobLike {
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

interface FakeRecorderOptions {
  mimeType?: string
  videoBitsPerSecond?: number
  audioBitsPerSecond?: number
}

type MessageListener = (message: OffscreenMessage, sender: unknown, sendResponse: (response: any) => void) => boolean

class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = []
  static supportedTypes = new Set<string>(['video/mp4'])
  static stopChunk: BlobLike | undefined
  static isTypeSupported = vi.fn((mimeType: string) => FakeMediaRecorder.supportedTypes.has(mimeType))

  readonly mimeType: string
  readonly options: FakeRecorderOptions
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((event: { data: BlobLike }) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onstop: ((event: Event) => void) | null = null

  constructor(_stream: unknown, options: FakeRecorderOptions = {}) {
    super()
    this.options = options
    this.mimeType = options.mimeType ?? ''
    FakeMediaRecorder.instances.push(this)
  }

  start(): void {
    this.state = 'recording'
    this.dispatchEvent(new Event('start'))
  }

  stop(): void {
    if (this.state === 'inactive') {
      throw new Error('MediaRecorder is already inactive')
    }

    this.state = 'inactive'
    if (FakeMediaRecorder.stopChunk) {
      this.ondataavailable?.({ data: FakeMediaRecorder.stopChunk })
    }
    const stopEvent = new Event('stop')
    this.dispatchEvent(stopEvent)
    this.onstop?.(stopEvent)
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('offscreen recording lifecycle', () => {
  let listener: MessageListener
  let sendMessage: ReturnType<typeof vi.fn>
  let getUserMedia: ReturnType<typeof vi.fn>
  let streams: Array<{ getTracks: () => Array<{ stop: ReturnType<typeof vi.fn> }> }>

  beforeEach(async () => {
    vi.resetModules()
    FakeMediaRecorder.instances = []
    FakeMediaRecorder.supportedTypes = new Set(['video/mp4'])
    FakeMediaRecorder.stopChunk = undefined
    FakeMediaRecorder.isTypeSupported.mockClear()

    streams = []
    getUserMedia = vi.fn(async () => {
      const track = { stop: vi.fn() }
      const stream = { getTracks: () => [track] }
      streams.push(stream)
      return stream
    })
    sendMessage = vi.fn(async () => undefined)

    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((registeredListener: MessageListener) => {
            listener = registeredListener
          }),
        },
        sendMessage,
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // Keep this path dynamic so the penguin-browser TypeScript build does not
    // pull extension sources outside its rootDir. Vitest still transforms it.
    const offscreenModulePath = new URL('../../browser-extension/src/offscreen.ts', import.meta.url).href
    await import(offscreenModulePath)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function dispatch(message: OffscreenMessage): Promise<any> {
    return new Promise((resolve) => {
      expect(listener(message, {}, resolve)).toBe(true)
    })
  }

  async function start(tabId = 7, audio = false): Promise<any> {
    return dispatch({ action: 'startRecording', tabId, streamId: `stream-${tabId}`, audio })
  }

  test('waits for final Blob conversion and chunk delivery before sending final', async () => {
    const arrayBufferDeferred = createDeferred<ArrayBuffer>()
    const chunkDeliveryDeferred = createDeferred<void>()
    const arrayBuffer = vi.fn(() => arrayBufferDeferred.promise)
    FakeMediaRecorder.stopChunk = { size: 3, arrayBuffer }
    sendMessage.mockImplementation((message: any) => {
      if (message.data) {
        return chunkDeliveryDeferred.promise
      }
      return Promise.resolve()
    })

    expect(await start()).toMatchObject({ success: true, tabId: 7 })
    const stopPromise = dispatch({ action: 'stopRecording', tabId: 7 })

    await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce())
    expect(sendMessage).not.toHaveBeenCalled()

    arrayBufferDeferred.resolve(Uint8Array.from([1, 2, 3]).buffer)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    expect(sendMessage.mock.calls[0][0]).toMatchObject({ action: 'recordingChunk', tabId: 7, data: [1, 2, 3] })
    expect(sendMessage.mock.calls.some(([message]) => message.final)).toBe(false)

    chunkDeliveryDeferred.resolve()
    await expect(stopPromise).resolves.toMatchObject({ success: true, tabId: 7 })
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      { action: 'recordingChunk', tabId: 7, data: [1, 2, 3] },
      { action: 'recordingChunk', tabId: 7, final: true },
    ])
    expect(streams[0].getTracks()[0].stop).toHaveBeenCalledOnce()
    await expect(dispatch({ action: 'isRecording', tabId: 7 })).resolves.toEqual({ isRecording: false, tabId: 7 })
  })

  test('does not send final and still cleans up when a chunk conversion fails', async () => {
    FakeMediaRecorder.stopChunk = {
      size: 1,
      arrayBuffer: vi.fn().mockRejectedValue(new Error('conversion failed')),
    }

    expect(await start()).toMatchObject({ success: true })
    await expect(dispatch({ action: 'stopRecording', tabId: 7 })).resolves.toEqual({
      success: false,
      error: 'conversion failed',
    })

    expect(sendMessage.mock.calls.some(([message]) => message.final)).toBe(false)
    expect(streams[0].getTracks()[0].stop).toHaveBeenCalledOnce()
    await expect(dispatch({ action: 'isRecording', tabId: 7 })).resolves.toEqual({ isRecording: false, tabId: 7 })
  })

  test('cancel stops recorder and tracks, sends cancellation, and clears the recording', async () => {
    expect(await start()).toMatchObject({ success: true })
    const recorder = FakeMediaRecorder.instances[0]

    await expect(dispatch({ action: 'cancelRecording', tabId: 7 })).resolves.toEqual({ success: true, tabId: 7 })

    expect(recorder.state).toBe('inactive')
    expect(streams[0].getTracks()[0].stop).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith({ action: 'recordingCancelled', tabId: 7 })
    await expect(dispatch({ action: 'isRecording', tabId: 7 })).resolves.toEqual({ isRecording: false, tabId: 7 })

    // Starting the same tab again proves its prior state was removed from the map.
    await expect(start()).resolves.toMatchObject({ success: true, tabId: 7 })
    await dispatch({ action: 'cancelRecording', tabId: 7 })
  })

  test('selects the first supported MIME fallback', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['video/webm;codecs=vp8'])

    await expect(start()).resolves.toMatchObject({
      success: true,
      tabId: 7,
      mimeType: 'video/webm;codecs=vp8',
    })
    expect(FakeMediaRecorder.instances[0].options.mimeType).toBe('video/webm;codecs=vp8')
    expect(FakeMediaRecorder.isTypeSupported.mock.calls.map(([mimeType]) => mimeType)).toEqual([
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
    ])

    await dispatch({ action: 'cancelRecording', tabId: 7 })
  })
})
