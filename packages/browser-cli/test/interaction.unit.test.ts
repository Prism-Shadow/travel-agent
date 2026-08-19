/**
 * Unit tests for the parts of the interaction primitives that are pure.
 *
 * The click/fill paths need a real page and are covered by driving an actual booking form; what
 * is testable here is the judgement each primitive encodes — how an outcome is classified, and
 * which labels a calendar cell might carry.
 */
import { describe, expect, it } from 'vitest'
import { classifyOutcome, dateCellLabels, type Outcome } from '../src/executor/interaction.js'

/** Minimal stand-in: classifyOutcome only reads url, title and content. */
function fakePage(url: string, title: string, body = ''): Parameters<typeof classifyOutcome>[0] {
  return {
    url: () => url,
    title: async () => title,
    content: async () => body,
  } as unknown as Parameters<typeof classifyOutcome>[0]
}

async function classify(url: string, title: string, body = ''): Promise<Outcome> {
  return classifyOutcome(fakePage(url, title, body))
}

describe('classifyOutcome', () => {
  it('reports a normal results page as ok', async () => {
    const outcome = await classify('https://hotels.ctrip.com/hotels/list?cityId=228', '东京酒店预订')
    expect(outcome.kind).toBe('ok')
  })

  it('detects an auth wall from the URL', async () => {
    const outcome = await classify('https://passport.ctrip.com/user/login?backurl=x', '登录首页')
    expect(outcome.kind).toBe('auth_wall')
    expect(outcome.evidence).toContain('passport.')
  })

  it('detects an auth wall on other hosts too — the rule is not site-specific', async () => {
    for (const url of [
      'https://www.example.com/signin?next=/book',
      'https://accounts.example.org/x',
      'https://site.test/auth/start',
    ]) {
      expect((await classify(url, 'Sign in')).kind).toBe('auth_wall')
    }
  })

  // Kept apart from auth on purpose: an auth wall waits for the person to be present, a
  // challenge has a live clock and needs a handoff now.
  it('separates a human-verification challenge from an auth wall', async () => {
    const outcome = await classify('https://hotels.example.com/list', '验证', '<div>请完成验证，拖动滑块</div>')
    expect(outcome.kind).toBe('challenge')
  })

  it('a challenge wins over an auth hint when both appear', async () => {
    const outcome = await classify('https://example.com/list', '', '<p>安全验证</p><p>请登录</p>')
    expect(outcome.kind).toBe('challenge')
  })

  it('detects an auth wall from page text when the URL looks innocent', async () => {
    const outcome = await classify('https://example.com/list', '', '<div>请登录后查看价格</div>')
    expect(outcome.kind).toBe('auth_wall')
  })

  it('always says what it keyed on, so a wrong call is debuggable', async () => {
    for (const outcome of [
      await classify('https://x.test/login', 't'),
      await classify('https://x.test/ok', 't', 'captcha'),
      await classify('https://x.test/ok', 't'),
    ]) {
      expect(outcome.evidence.trim()).not.toBe('')
    }
  })

  it('survives a page that cannot be read', async () => {
    const broken = {
      url: () => 'https://x.test/ok',
      title: async () => {
        throw new Error('detached')
      },
      content: async () => {
        throw new Error('detached')
      },
    } as unknown as Parameters<typeof classifyOutcome>[0]
    expect((await classifyOutcome(broken)).kind).toBe('ok')
  })
})

describe('dateCellLabels', () => {
  it('offers the localised renderings a calendar might use, most specific first', () => {
    const labels = dateCellLabels(new Date(2026, 7, 20))
    expect(labels[0]).toBe('2026年8月20日')
    expect(labels).toContain('2026-08-20')
    expect(labels.some((label) => /August/.test(label))).toBe(true)
  })

  it('does not zero-pad the Chinese form — that is how the cells are labelled', () => {
    expect(dateCellLabels(new Date(2026, 0, 5))[0]).toBe('2026年1月5日')
  })

  it('zero-pads the ISO form', () => {
    expect(dateCellLabels(new Date(2026, 0, 5))).toContain('2026-01-05')
  })
})
