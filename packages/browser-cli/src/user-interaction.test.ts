/**
 * `requestUserInteraction`: where each of the six kinds goes, and what comes back.
 *
 * The dispatch is the design (003 §0.2): four kinds are cards in the conversation and leave the
 * agent working, two hand the page over. The tests that matter are the ones about *not* falling
 * back — with no conversation to ask in, a payment confirmation must not quietly become an overlay
 * drawn on the booking page, because that would be asking somebody to trust the page to describe
 * itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { controlSnapshot, resetControlForTests } from './handover-state.js'
import { harnessChannel, requestUserInteraction } from './user-interaction.js'

const ENV = {
  PENGUIN_INTERACTION_URL: 'http://127.0.0.1:7364',
  PENGUIN_INTERACTION_TOKEN: 'turn-token',
  PENGUIN_SESSION_ID: 'session-1',
}

const originalFetch = globalThis.fetch

afterEach(() => {
  resetControlForTests()
  globalThis.fetch = originalFetch
  for (const key of Object.keys(ENV)) delete process.env[key]
  vi.restoreAllMocks()
})

function withHarness(): void {
  Object.assign(process.env, ENV)
}

/** A harness double: records what was posted, answers the wait with a scripted outcome. */
function fakeHarness(outcome: Record<string, unknown>) {
  const posted: Array<{ url: string; body: Record<string, unknown> }> = []
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return new Response(JSON.stringify({ interactionId: 'int-1', kind: 'x' }), { status: 200 })
    }
    return new Response(JSON.stringify({ outcome }), { status: 200 })
  }) as typeof fetch
  return posted
}

describe('where each kind goes', () => {
  it('sends a question to the conversation and returns the answer', async () => {
    withHarness()
    const posted = fakeHarness({ status: 'answered', value: '两位成人' })

    const result = await requestUserInteraction({ kind: 'info_request', ask: '几位乘客？' })

    expect(result).toMatchObject({ resolved: true, status: 'answered', value: '两位成人' })
    expect(posted[0]?.url).toContain('/api/agent/interactions')
    expect(posted[0]?.body).toMatchObject({ sessionId: 'session-1', kind: 'info_request' })
  })

  it('carries the seven fields of a purchase to the card', async () => {
    withHarness()
    const posted = fakeHarness({ status: 'answered', approved: true })

    const result = await requestUserInteraction({
      kind: 'commitment_confirmation',
      ask: '确认这笔付款',
      payment: {
        merchant: { name: '携程', domain: 'ctrip.com' },
        item: 'MU5137 2026-09-02 经济舱',
        amount: { value: 1280, currency: 'CNY' },
        cancellation: { summary: '起飞前 24 小时可退' },
        paymentMethod: { alias: '常用信用卡', last4: '4242' },
      },
    })

    expect(result).toMatchObject({ resolved: true, approved: true })
    expect(posted[0]?.body.payment).toMatchObject({ merchant: { domain: 'ctrip.com' } })
  })

  it('reports a decline as an answer, not a failure', async () => {
    // "No, do not pay that" is the outcome the card exists to be able to receive. An agent that
    // read it as an error would retry.
    withHarness()
    fakeHarness({ status: 'declined', message: '太贵了' })

    const result = await requestUserInteraction({
      kind: 'commitment_confirmation',
      ask: '确认这笔付款',
      payment: {
        merchant: { name: '携程', domain: 'ctrip.com' },
        item: 'MU5137',
        amount: { value: 1280, currency: 'CNY' },
        cancellation: { summary: '可退' },
        paymentMethod: { alias: '常用卡' },
      },
    })
    expect(result.resolved).toBe(false)
    expect(result.status).toBe('declined')
    expect(result.detail).toMatch(/do not do it/i)
  })

  it('reads a card refusal as the caller’s mistake', async () => {
    // The harness refuses cards that would put a dishonest question in front of somebody — a
    // takeover with no reason, a purchase with no cancellation terms. That is a bug in the call,
    // so it throws rather than being reported as "the person said no".
    withHarness()
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'cancellation.summary is required' } }), {
        status: 400,
      })) as typeof fetch

    await expect(requestUserInteraction({ kind: 'info_request', ask: '几位？' })).rejects.toThrow(
      /cancellation/,
    )
  })
})

describe('with no conversation to ask in', () => {
  it('does not fall back to drawing a payment card on the booking page', async () => {
    // The whole point of the split. A summary rendered by the page being paid is worthless as
    // evidence of what was agreed.
    const result = await requestUserInteraction({
      kind: 'commitment_confirmation',
      ask: '确认这笔付款',
      payment: {
        merchant: { name: '携程', domain: 'ctrip.com' },
        item: 'MU5137',
        amount: { value: 1280, currency: 'CNY' },
        cancellation: { summary: '可退' },
        paymentMethod: { alias: '常用卡' },
      },
    })
    expect(result.status).toBe('unavailable')
    expect(result.detail).toMatch(/belongs in the conversation/i)
  })

  it('tells the agent to have the person type the code themselves', async () => {
    const result = await requestUserInteraction({
      kind: 'secret_entry',
      ask: '需要短信验证码',
      field: 'otp',
      purpose: '3DS',
    })
    expect(result.status).toBe('unavailable')
    expect(result.detail).toMatch(/never types one for them/i)
  })

  it('tells a snippet where a card has to be raised from instead', async () => {
    // Executed snippets run in the relay, which is shared between conversations and holds no
    // conversation's credential. "Unavailable" alone would read as a bug; this says what to do.
    const result = await requestUserInteraction({
      kind: 'selection',
      ask: '选一个',
      caller: 'executor',
      options: [
        { id: 'a', label: 'A', rationale: '唯一直飞' },
        { id: 'b', label: 'B', rationale: '便宜 400' },
      ],
    })
    expect(result.status).toBe('unavailable')
    expect(result.detail).toMatch(/interaction request --kind selection/)
    expect(result.detail).toMatch(/human_challenge and browser_takeover/)
  })

  it('has no channel when only half the environment is there', () => {
    process.env.PENGUIN_INTERACTION_URL = ENV.PENGUIN_INTERACTION_URL
    expect(harnessChannel(process.env)).toBeNull()
  })
})

describe('the two kinds that touch the page', () => {
  /** A page double whose overlay answers immediately. */
  function fakePage(answer: { resolved: boolean; message?: string; reason: string }) {
    let shown = false
    return {
      isClosed: () => false,
      evaluate: async (fn: unknown, arg?: unknown) => {
        void arg
        const source = String(fn)
        // Matched on the call, not on a word: the poll's own body mentions `showing`, so a looser
        // check would read the poll as the show and answer it with nothing.
        if (source.includes('.result(')) {
          return shown ? { answer, showing: false } : { showing: false }
        }
        if (source.includes('.show(')) {
          shown = true
          return undefined
        }
        // The injection check (already present) and the dismissal.
        return true
      },
    } as never
  }

  it('refuses a takeover with no reason, before anything is shown', async () => {
    await expect(
      requestUserInteraction({
        kind: 'browser_takeover',
        ask: '请接管',
        page: fakePage({ resolved: true, reason: 'done' }),
        sessionId: 'session-1',
      }),
    ).rejects.toThrow(/needs a reason/i)
    // And the machine did not move: nothing was handed over.
    expect(controlSnapshot('session-1').state).toBe('agent_control')
  })

  it('needs a page at all', async () => {
    await expect(
      requestUserInteraction({ kind: 'human_challenge', ask: '请完成滑块' }),
    ).rejects.toThrow(/needs one/i)
  })

  it('gives the page back afterwards, whatever the outcome', async () => {
    // Leaving the machine in user_control would refuse every later write for the rest of the
    // session — a handoff that succeeded would look exactly like one that never ended.
    const result = await requestUserInteraction({
      kind: 'human_challenge',
      ask: '请完成滑块验证',
      page: fakePage({ resolved: true, message: '好了', reason: 'done' }),
      sessionId: 'session-1',
      timeoutMs: 2_000,
    })
    expect(result.resolved).toBe(true)
    expect(result.message).toBe('好了')
    expect(controlSnapshot('session-1').state).toBe('agent_control')
  })

  it('comes back to agent control even when the person cancelled', async () => {
    const result = await requestUserInteraction({
      kind: 'browser_takeover',
      ask: '请接管',
      reason: '站点用自绘控件，没有可自动化的元素',
      page: fakePage({ resolved: false, reason: 'cancelled' }),
      sessionId: 'session-1',
      timeoutMs: 2_000,
    })
    expect(result.status).toBe('declined')
    expect(controlSnapshot('session-1').state).toBe('agent_control')
  })
})
