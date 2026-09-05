import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeConnection } from '../src/native-connection'
import { nativePort } from './helpers/native-port'
import type { NativeResponse } from 'penguin-browser/src/shared/desktop-connection'

const absent = { protocol: 1, error: 'The paired Travel Agent is not running' } as const
let connect: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  connect = vi.fn()
  vi.stubGlobal('chrome', { runtime: { connectNative: connect } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('native discovery lifetime', () => {
  it('reuses one helper across polling while Desktop is closed and after it opens', async () => {
    const handler = vi.fn<() => NativeResponse>(() => absent)
    const host = nativePort(handler)
    connect.mockReturnValue(host.port)
    const client = new NativeConnection()
    for (let i = 0; i < 20; i++) {
      expect(await client.request({ type: 'connect' })).toEqual(absent)
      await vi.advanceTimersByTimeAsync(3000)
    }
    const ready = { protocol: 1, apps: [{ installationId: 'a'.repeat(32), instanceId: 'b'.repeat(32), name: 'Travel Agent' }] } as const
    handler.mockReturnValue({ ...ready, apps: [...ready.apps] })
    expect(await client.request({ type: 'list' })).toEqual(ready)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(host.disconnect).not.toHaveBeenCalled()
  })

  it('serializes concurrent discovery and settings requests without mixing replies', async () => {
    const host = nativePort()
    connect.mockReturnValue(host.port)
    const client = new NativeConnection()
    const first = client.request({ type: 'list' })
    const second = client.request({ type: 'connect' })
    await vi.advanceTimersByTimeAsync(0)
    expect(host.postMessage.mock.calls).toEqual([[{ type: 'list' }]])
    host.respond({ protocol: 1, apps: [] })
    expect(await first).toEqual({ protocol: 1, apps: [] })
    await vi.advanceTimersByTimeAsync(0)
    expect(host.postMessage).toHaveBeenLastCalledWith({ type: 'connect' })
    host.respond(absent)
    expect(await second).toEqual(absent)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('backs off repeated host failures up to one minute, then recovers', async () => {
    const client = new NativeConnection()
    connect.mockImplementation(() => { throw new Error('Host missing') })
    for (const delay of [3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000]) {
      await expect(client.request({ type: 'list' })).rejects.toThrow('Open Travel Agent')
      const attempts = connect.mock.calls.length
      await vi.advanceTimersByTimeAsync(delay - 1)
      await expect(client.request({ type: 'list' })).rejects.toThrow('Open Travel Agent')
      expect(connect).toHaveBeenCalledTimes(attempts)
      await vi.advanceTimersByTimeAsync(1)
    }
    const host = nativePort(() => absent)
    connect.mockReturnValue(host.port)
    expect(await client.request({ type: 'list' })).toEqual(absent)
    host.close()
    await vi.advanceTimersByTimeAsync(3000)
    const replacement = nativePort(() => ({ protocol: 1, apps: [] }))
    connect.mockReturnValue(replacement.port)
    expect(await client.request({ type: 'list' })).toEqual({ protocol: 1, apps: [] })
  })

  it('rejects an interrupted request and lets queued callers observe the retry delay', async () => {
    const host = nativePort()
    connect.mockReturnValue(host.port)
    const client = new NativeConnection()
    const results = Promise.allSettled([client.request({ type: 'list' }), client.request({ type: 'list' })])
    await vi.advanceTimersByTimeAsync(0)
    host.close()
    expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(connect).toHaveBeenCalledTimes(1)
    expect(host.postMessage).toHaveBeenCalledTimes(1)
  })

  it('kills a timed-out channel and cannot use its late reply for a new request', async () => {
    const old = nativePort()
    connect.mockReturnValue(old.port)
    const client = new NativeConnection()
    const timedOut = expect(client.request({ type: 'list' })).rejects.toThrow('Open Travel Agent')
    await vi.advanceTimersByTimeAsync(5000)
    await timedOut
    expect(old.disconnect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    const next = nativePort()
    connect.mockReturnValue(next.port)
    const pending = client.request({ type: 'list' })
    await vi.advanceTimersByTimeAsync(0)
    old.respond(absent)
    next.respond({ protocol: 1, apps: [] })
    expect(await pending).toEqual({ protocol: 1, apps: [] })
    expect(vi.getTimerCount()).toBe(0)
  })
})
