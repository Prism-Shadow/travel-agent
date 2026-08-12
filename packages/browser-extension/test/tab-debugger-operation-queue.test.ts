import { describe, expect, it } from 'vitest'
import { TabDebuggerOperationQueue } from '../src/tab-debugger-operation-queue.js'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('TabDebuggerOperationQueue', () => {
  it('coalesces consecutive attach requests for the same tab', async () => {
    const queue = new TabDebuggerOperationQueue<string>()
    const gate = deferred<string>()
    let calls = 0

    const first = queue.attach(7, async () => {
      calls++
      return await gate.promise
    })
    const second = queue.attach(7, async () => {
      calls++
      return 'unexpected'
    })

    expect(second).toBe(first)
    gate.resolve('attached')
    await expect(first).resolves.toBe('attached')
    expect(calls).toBe(1)
  })

  it('waits for detach before starting a later attach', async () => {
    const queue = new TabDebuggerOperationQueue<string>()
    const detachGate = deferred()
    const events: string[] = []

    const detach = queue.detach(7, async () => {
      events.push('detach:start')
      await detachGate.promise
      events.push('detach:end')
    })
    const attach = queue.attach(7, async () => {
      events.push('attach')
      return 'attached'
    })

    await Promise.resolve()
    expect(events).toEqual(['detach:start'])
    detachGate.resolve()
    await Promise.all([detach, attach])
    expect(events).toEqual(['detach:start', 'detach:end', 'attach'])
  })

  it('creates a new attach after an intervening detach', async () => {
    const queue = new TabDebuggerOperationQueue<string>()
    const firstAttachGate = deferred<string>()
    const events: string[] = []

    const firstAttach = queue.attach(7, async () => {
      events.push('attach:1:start')
      const result = await firstAttachGate.promise
      events.push('attach:1:end')
      return result
    })
    const detach = queue.detach(7, async () => {
      events.push('detach')
    })
    const secondAttach = queue.attach(7, async () => {
      events.push('attach:2')
      return 'second'
    })

    expect(secondAttach).not.toBe(firstAttach)
    firstAttachGate.resolve('first')
    await Promise.all([firstAttach, detach, secondAttach])
    expect(events).toEqual(['attach:1:start', 'attach:1:end', 'detach', 'attach:2'])
    await expect(secondAttach).resolves.toBe('second')
  })

  it('continues after a rejected operation', async () => {
    const queue = new TabDebuggerOperationQueue<string>()
    const failedAttach = queue.attach(7, async () => {
      throw new Error('attach failed')
    })
    const detach = queue.detach(7, async () => {})

    await expect(failedAttach).rejects.toThrow('attach failed')
    await expect(detach).resolves.toBeUndefined()
  })

  it('runs different tabs independently', async () => {
    const queue = new TabDebuggerOperationQueue<string>()
    const firstTabGate = deferred<string>()
    const events: string[] = []

    const firstTab = queue.attach(7, async () => {
      events.push('tab7:start')
      return await firstTabGate.promise
    })
    const secondTab = queue.attach(8, async () => {
      events.push('tab8')
      return 'tab8'
    })

    await expect(secondTab).resolves.toBe('tab8')
    expect(events).toEqual(['tab7:start', 'tab8'])
    firstTabGate.resolve('tab7')
    await firstTab
  })
})
