/**
 * Text redaction and the screenshot rule, tested with the values that must never surface.
 *
 * The fingerprints here are computed the way main computes them, because the property under test
 * is the *pair*: main publishes a fingerprint it derived from the value, the relay matches
 * candidates against it, and the two implementations agreeing on shape and hash is what makes a
 * fill on one side disappear from a snapshot on the other.
 */
import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'

import {
  fingerprintOf,
  judgeScreenshot,
  redactText,
  redactionLabel,
  shapeOf,
  type RedactionEntry,
} from './redaction.js'

const SALT = randomBytes(32)
const ID_NUMBER = '310101199001011234'
const PHONE = '13800005678'
const PASSPORT = 'E12345678'

function entryFor(field: string, value: string): RedactionEntry {
  return {
    id: `se-${field}`,
    field,
    fingerprint: fingerprintOf(SALT, value),
    length: [...value].length,
    shape: shapeOf(value),
  }
}

describe('redactText', () => {
  test('replaces the value wherever the page echoed it, with the field name', () => {
    const page = `确认页\n证件号：${ID_NUMBER}\n订单摘要里再次出现 ${ID_NUMBER}。`
    const redacted = redactText(page, [entryFor('id_number', ID_NUMBER)], SALT)
    expect(redacted).not.toContain(ID_NUMBER)
    expect(redacted.match(/\[REDACTED:id_number\]/g)).toHaveLength(2)
  })

  test('handles several registered values at once', () => {
    const page = `${ID_NUMBER} / ${PHONE} / ${PASSPORT}`
    const redacted = redactText(
      page,
      [
        entryFor('id_number', ID_NUMBER),
        entryFor('phone_number', PHONE),
        entryFor('passport_number', PASSPORT),
      ],
      SALT,
    )
    expect(redacted).toBe(
      `${redactionLabel('id_number')} / ${redactionLabel('phone_number')} / ${redactionLabel('passport_number')}`,
    )
  })

  test('does not touch a digit run that merely contains the value', () => {
    // A longer number that happens to embed the id is a different number; replacing a fragment of
    // it would corrupt the page's text and reveal that a match existed.
    const page = `9${ID_NUMBER}9`
    expect(redactText(page, [entryFor('id_number', ID_NUMBER)], SALT)).toBe(page)
  })

  test('does not fire on a same-shape, different-value string', () => {
    const other = '310101199001011235'
    expect(redactText(other, [entryFor('id_number', ID_NUMBER)], SALT)).toBe(other)
  })

  test('never carries the value itself in the entries it matches with', () => {
    const entry = entryFor('id_number', ID_NUMBER)
    expect(JSON.stringify(entry)).not.toContain(ID_NUMBER)
    expect(entry.fingerprint).toHaveLength(32)
  })

  test('leaves a page with nothing registered untouched, cheaply', () => {
    const page = '航班 MU5137，价格 1280 元'
    expect(redactText(page, [], SALT)).toBe(page)
  })

  test('skips values too short to search for safely', () => {
    // Fingerprint-matching a 3-character value would let a caller binary-search the space; the
    // rule is that anything that short is L3-shaped and never registered anyway.
    const short = { ...entryFor('cvv', '123'), length: 3, shape: 'ddd' }
    expect(redactText('123', [short], SALT)).toBe('123')
  })

  test('matches across CJK boundaries, where there are no spaces to anchor on', () => {
    const page = `姓名小明，证件${ID_NUMBER}提交`
    const redacted = redactText(page, [entryFor('id_number', ID_NUMBER)], SALT)
    expect(redacted).toBe(`姓名小明，证件${redactionLabel('id_number')}提交`)
  })
})

describe('the golden pair', () => {
  // Keep byte-identical with desktop/test/vault-redaction-agreement.test.ts: the two packages
  // implement shape and fingerprint independently, and these constants are what force them to
  // stay the same. An implementation that drifts fails its own golden test, with a diff, instead
  // of silently never matching what the other side published.
  const GOLDEN_SALT = Buffer.from('penguin-redaction-agreement-salt-2026!!!', 'utf8')
  const GOLDEN = [
    {
      value: '310101199001011234',
      shape: 'dddddddddddddddddd',
      fingerprint: '62c14bee086c63d70d253b047ee24b4e',
    },
    { value: 'E12345678', shape: 'adddddddd', fingerprint: '278c4f26d96792d7922c810d76485a8e' },
  ] as const

  test('computes the pinned shapes', () => {
    for (const golden of GOLDEN) expect(shapeOf(golden.value)).toBe(golden.shape)
    expect(shapeOf('南京西路 1266 号')).toBe('aaaasddddsa')
  })

  test('computes the pinned fingerprints under the golden salt', () => {
    for (const golden of GOLDEN) {
      expect(fingerprintOf(GOLDEN_SALT, golden.value)).toBe(golden.fingerprint)
    }
  })
})

describe('judgeScreenshot', () => {
  test('masks every located value and allows the image', () => {
    const verdict = judgeScreenshot({
      live: [
        { field: 'id_number', box: { x: 10, y: 20, width: 200, height: 30 } },
        { field: 'phone_number', box: { x: 10, y: 60, width: 180, height: 30 } },
      ],
    })
    expect(verdict.allowed).toBe(true)
    expect(verdict.masks).toHaveLength(2)
  })

  test('refuses the image outright when any value has no box — never a maybe-leaky picture', () => {
    const verdict = judgeScreenshot({
      live: [
        { field: 'id_number', box: { x: 10, y: 20, width: 200, height: 30 } },
        { field: 'otp' }, // registered during a secret phase, position unknown
      ],
    })
    expect(verdict).toEqual({ allowed: false, masks: [], unlocated: ['otp'] })
  })

  test('allows a page with nothing sensitive on it', () => {
    expect(judgeScreenshot({ live: [] })).toEqual({ allowed: true, masks: [], unlocated: [] })
  })
})
