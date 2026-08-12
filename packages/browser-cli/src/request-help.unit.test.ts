/**
 * Unit tests for the human-handoff wait loop.
 *
 * These drive `requestHelp` against a fake Page rather than a real browser, because the
 * behaviour worth pinning down is the loop's own state machine — how it reacts to an answer, a
 * cancel, a timeout, an abort, a closed page, and above all a navigation that wipes the overlay
 * mid-wait. A real browser would exercise the overlay's rendering, not this.
 *
 * The fake mirrors the one contract the loop depends on: `page.evaluate(fn, arg)` runs `fn`
 * against a stand-in for the page's `globalThis`, and rejects while "navigating" the way a real
 * page does.
 */
import { describe, expect, it, vi } from 'vitest'
import { requestHelp } from './request-help.js'
import type { Page } from './playwright-import.js'

interface Answer {
  resolved: boolean
  message?: string
  reason: string
}

/**
 * A stand-in for the injected `__penguinHelp` bridge plus the page it lives on. Mirrors
 * help-overlay-client.ts: an answer survives re-injection, `isShowing` goes false when the
 * overlay is wiped (navigation) and true again after a re-show.
 */
class FakePage {
  bridgePresent = false
  showing: string | undefined
  answer: Answer | undefined
  answerFor: string | undefined
  navigating = false
  closed = false
  /** Every id ever passed to show() — proves re-injection reused the original request id. */
  readonly shown: string[] = []
  evaluateCalls = 0

  /** Simulates the human clicking a button in the overlay. */
  answerWith(answer: Answer): void {
    this.answer = answer
    this.answerFor = this.showing
  }

  /** Simulates a navigation: the injected bundle and the overlay are gone. */
  navigateAway(): void {
    this.bridgePresent = false
    this.showing = undefined
  }

  isClosed(): boolean {
    return this.closed
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async evaluate(fn: any, arg?: any): Promise<any> {
    this.evaluateCalls += 1
    if (this.navigating) throw new Error('Execution context was destroyed')

    const source = String(fn)
    // Injection: the loop evaluates the bundle source as a bare string.
    if (typeof fn === 'string') {
      this.bridgePresent = true
      return undefined
    }
    // Presence probe.
    if (source.includes('!!') && source.includes('__penguinHelp')) {
      return this.bridgePresent
    }
    // show()
    if (source.includes('.show(')) {
      if (!this.bridgePresent) throw new Error('bridge missing')
      const id = (arg as { id: string }).id
      this.shown.push(id)
      // An already-answered request is not redrawn (help-overlay-client.show).
      if (!(this.answerFor === id && this.answer)) this.showing = id
      return undefined
    }
    // dismiss()
    if (source.includes('dismiss()')) {
      this.showing = undefined
      return undefined
    }
    // The poll.
    if (!this.bridgePresent) return { showing: false }
    const requestId = arg as string
    return {
      answer: this.answerFor === requestId ? this.answer : undefined,
      showing: this.showing === requestId && !this.answer,
    }
  }
}

function asPage(fake: FakePage): Page {
  return fake as unknown as Page
}

describe('requestHelp', () => {
  it('returns the human’s confirmation and their message', async () => {
    const fake = new FakePage()
    const promise = requestHelp({ page: asPage(fake), prompt: '请输入短信验证码', timeoutMs: 5000 })
    await vi.waitFor(() => expect(fake.showing).toBeDefined())
    fake.answerWith({ resolved: true, message: '顺便看看更早的班次', reason: 'done' })

    const result = await promise
    expect(result.resolved).toBe(true)
    expect(result.message).toBe('顺便看看更早的班次')
    expect(result.reason).toBe('done')
    expect(result.waitedMs).toBeGreaterThanOrEqual(0)
  })

  it('reports a cancel as unresolved, still carrying the message', async () => {
    const fake = new FakePage()
    const promise = requestHelp({ page: asPage(fake), prompt: '确认订单', timeoutMs: 5000 })
    await vi.waitFor(() => expect(fake.showing).toBeDefined())
    fake.answerWith({ resolved: false, message: '价格不对，别订', reason: 'cancelled' })

    const result = await promise
    expect(result.resolved).toBe(false)
    expect(result.reason).toBe('cancelled')
    expect(result.message).toBe('价格不对，别订')
  })

  // The load-bearing case: solving a captcha usually navigates, which wipes the injected
  // overlay. The loop must put it back under the *same* request id and keep waiting.
  it('re-injects the overlay after a navigation wipes it, reusing the request id', async () => {
    const fake = new FakePage()
    const promise = requestHelp({ page: asPage(fake), prompt: '请完成滑块验证', timeoutMs: 8000 })
    await vi.waitFor(() => expect(fake.showing).toBeDefined())
    const originalId = fake.shown[0]

    fake.navigateAway()
    expect(fake.showing).toBeUndefined()

    // The loop notices the overlay is gone and re-injects.
    await vi.waitFor(() => expect(fake.showing).toBe(originalId), { timeout: 4000 })
    expect(fake.bridgePresent).toBe(true)
    expect(new Set(fake.shown)).toEqual(new Set([originalId]))

    fake.answerWith({ resolved: true, reason: 'done' })
    await expect(promise).resolves.toMatchObject({ resolved: true, reason: 'done' })
  })

  it('keeps waiting while evaluate rejects mid-navigation, then resolves', async () => {
    const fake = new FakePage()
    const promise = requestHelp({ page: asPage(fake), prompt: '请登录', timeoutMs: 8000 })
    await vi.waitFor(() => expect(fake.showing).toBeDefined())

    fake.navigating = true
    const callsDuringNavigation = fake.evaluateCalls
    await vi.waitFor(() => expect(fake.evaluateCalls).toBeGreaterThan(callsDuringNavigation), {
      timeout: 3000,
    })
    fake.navigating = false

    fake.answerWith({ resolved: true, reason: 'done' })
    await expect(promise).resolves.toMatchObject({ resolved: true })
  })

  // A lapsed handoff is a state the caller has to handle (suspend and resume later), not an
  // exception — so it resolves rather than throws.
  it('resolves with reason "timeout" instead of throwing when the human never answers', async () => {
    const fake = new FakePage()
    const result = await requestHelp({ page: asPage(fake), prompt: '请确认', timeoutMs: 700 })
    expect(result).toMatchObject({ resolved: false, reason: 'timeout' })
    expect(result.waitedMs).toBeGreaterThanOrEqual(700)
    // The overlay is cleaned up so a lapsed request leaves nothing on the user's page.
    expect(fake.showing).toBeUndefined()
  })

  it('resolves with reason "aborted" when the signal fires', async () => {
    const fake = new FakePage()
    const controller = new AbortController()
    const promise = requestHelp({
      page: asPage(fake),
      prompt: '请确认',
      timeoutMs: 10_000,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(fake.showing).toBeDefined())
    controller.abort()

    await expect(promise).resolves.toMatchObject({ resolved: false, reason: 'aborted' })
    expect(fake.showing).toBeUndefined()
  })

  it('resolves with reason "page_closed" when the tab goes away', async () => {
    const fake = new FakePage()
    const promise = requestHelp({ page: asPage(fake), prompt: '请确认', timeoutMs: 10_000 })
    await vi.waitFor(() => expect(fake.showing).toBeDefined())
    fake.closed = true

    await expect(promise).resolves.toMatchObject({ resolved: false, reason: 'page_closed' })
  })

  it('passes the highlight target through to the overlay', async () => {
    const fake = new FakePage()
    const showArgs: unknown[] = []
    const original = fake.evaluate.bind(fake)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fake.evaluate = async (fn: any, arg?: any) => {
      if (typeof fn !== 'string' && String(fn).includes('.show(')) showArgs.push(arg)
      return original(fn, arg)
    }

    const promise = requestHelp({
      page: asPage(fake),
      prompt: '请在高亮的输入框里填验证码',
      targetSelector: '#captcha',
      timeoutMs: 5000,
    })
    await vi.waitFor(() => expect(showArgs.length).toBeGreaterThan(0))
    expect(showArgs[0]).toMatchObject({ targetSelector: '#captcha' })

    fake.answerWith({ resolved: true, reason: 'done' })
    await promise
  })
})
