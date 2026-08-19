/**
 * Text-side redaction: replacing a filled value everywhere it surfaces as text.
 *
 * The relay renders what the agent reads — snapshots, cleaned HTML, page markdown — and the values
 * the main process has typed into the page must not ride out through them. Main cannot do that
 * replacement itself (it does not render these outputs), and the relay must not be handed the
 * values (it lives in a process the agent can reach). The resolution is a *fingerprint*: main
 * publishes `HMAC(salt, value)` truncated, plus the value's exact length and a coarse character
 * shape, and shares the salt over the relay's own control channel. The relay can then test any
 * candidate substring for equality without ever being told what it is looking for.
 *
 * Honesty about strength, straight from the redaction design's table: **text matching is strong and exact**
 * — a value that appears verbatim is found, whatever element it is in. What it cannot catch is a
 * value the page re-rendered in a different *form* (grouped digits, masked middles the page did
 * itself, an image). The pixel side is handled separately by bounding-box masks, and the OCR
 * fallback behind `redaction.ocr` is explicitly best-effort and off by default.
 *
 * Everything here is a pure function over strings, so the exact behaviour that ships is the exact
 * behaviour tested.
 */
import { createHmac } from 'node:crypto'

/** What main publishes per sensitive value. Mirrors the desktop's `SensitiveFingerprint`. */
export interface RedactionEntry {
  id: string
  /** The field's *name* — `id_number` — used in the replacement text. */
  field: string
  /** Truncated hex HMAC of the value under the shared salt. */
  fingerprint: string
  /** Exact character length (code points), so only equal-length windows are hashed. */
  length: number
  /** Coarse classes, one per position: `d` digit, `a` letter, `s` space, `.` other. */
  shape: string
}

/** The same shape function main uses. The two must agree or nothing ever matches. */
export function shapeOf(value: string): string {
  let out = ''
  for (const char of value) {
    if (/\d/.test(char)) out += 'd'
    else if (/\s/.test(char)) out += 's'
    else if (/[A-Za-z一-鿿]/.test(char)) out += 'a'
    else out += '.'
  }
  return out
}

export function fingerprintOf(salt: Buffer, value: string): string {
  return createHmac('sha256', salt).update(value, 'utf8').digest('hex').slice(0, 32)
}

/** What a found value is replaced with. The field name, never any part of the value. */
export function redactionLabel(field: string): string {
  return `[REDACTED:${field}]`
}

/**
 * Replaces every occurrence of every registered value in `text`.
 *
 * The scan is affordable because the fingerprint entries prune it three ways before any HMAC is
 * computed: a window must have the exact length, the exact shape, and sit on a plausible boundary
 * (a digit run is only tested as a whole run — `id_number` inside a longer number is a different
 * number). The HMAC is only the final confirmation, and in the common case of a page with no
 * sensitive text it never runs at all.
 */
export function redactText(text: string, entries: readonly RedactionEntry[], salt: Buffer): string {
  if (entries.length === 0 || text === '') return text
  const chars = [...text]

  // Collect matches first, replace back-to-front so indices stay valid.
  const matches: Array<{ start: number; end: number; field: string }> = []
  for (const entry of entries) {
    if (entry.length < 4) continue // shorter than this and the fingerprint outs itself by search
    for (let start = 0; start + entry.length <= chars.length; start += 1) {
      const slice = chars.slice(start, start + entry.length)
      const candidate = slice.join('')
      if (shapeOf(candidate) !== entry.shape) continue
      // Boundary rule: a candidate that starts or ends mid-run of the same character class is a
      // fragment of something longer, not the value.
      if (sameClass(chars[start - 1], slice[0]!) || sameClass(chars[start + entry.length], slice[entry.length - 1]!)) {
        continue
      }
      if (fingerprintOf(salt, candidate) !== entry.fingerprint) continue
      matches.push({ start, end: start + entry.length, field: entry.field })
    }
  }

  if (matches.length === 0) return text
  matches.sort((a, b) => b.start - a.start)
  let out = chars
  let lastStart = Number.POSITIVE_INFINITY
  for (const match of matches) {
    if (match.end > lastStart) continue // overlapping double-match of the same region
    out = [...out.slice(0, match.start), ...redactionLabel(match.field), ...out.slice(match.end)]
    lastStart = match.start
  }
  return out.join('')
}

function sameClass(a: string | undefined, b: string): boolean {
  if (a === undefined) return false
  return shapeOf(a) === shapeOf(b)
}

/**
 * The screenshot decision (the last row of the redaction table, made executable).
 *
 * Pixels cannot be fingerprint-matched, so a screenshot is safe only where every live sensitive
 * value has a known box to cover. The rule errs the same way everything else in this design errs:
 * a box for everything → mask and ship; anything unlocated → **refuse the image**, because "a
 * screenshot that might contain a card number" is not a product feature.
 */
export interface ScreenshotVerdict {
  allowed: boolean
  /** Boxes to paint over before the image leaves, when allowed. */
  masks: Array<{ x: number; y: number; width: number; height: number }>
  /** Field names with no box, when refused. Names only — the reason the person reads. */
  unlocated: string[]
}

export function judgeScreenshot(input: {
  live: Array<{ field: string; box?: { x: number; y: number; width: number; height: number } }>
}): ScreenshotVerdict {
  const masks: ScreenshotVerdict['masks'] = []
  const unlocated: string[] = []
  for (const element of input.live) {
    if (element.box) masks.push(element.box)
    else unlocated.push(element.field)
  }
  if (unlocated.length > 0) return { allowed: false, masks: [], unlocated }
  return { allowed: true, masks, unlocated: [] }
}
