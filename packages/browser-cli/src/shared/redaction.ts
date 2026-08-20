/**
 * Text-side redaction: replacing a filled value everywhere it surfaces as text.
 *
 * The relay renders what the agent reads — snapshots, cleaned HTML, page markdown — and the values
 * the main process has typed into the page must not ride out through them. Main cannot do that
 * replacement itself (it does not render these outputs), and the relay should not be handed the
 * values as plaintext (it lives in a process the agent can reach). The resolution is a *fingerprint*: main
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
 * This is not a secrecy boundary. A process holding both salt and fingerprint can test guesses,
 * and the executor can deliberately read L2 values through raw CDP anyway. The fingerprint keeps
 * plaintext out of the control message and passive logs; D3 remains the boundary required before
 * the producer gates can open.
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

/** Text outputs need the entries and the salt that makes their fingerprints comparable. */
export interface TextRedactionContext {
  entries: readonly RedactionEntry[]
  salt: Buffer
}

/** The complete state needed by both text outputs and screenshots. */
export interface RedactionContext extends TextRedactionContext {
  live: Array<{
    id: string
    field: string
    box?: { x: number; y: number; width: number; height: number }
  }>
}

/** The process-boundary representation published by desktop main. */
export type PublishedRedactionState =
  | { active: false }
  | {
      active: true
      salt: string
      entries: RedactionEntry[]
      live: Array<{
        id: string
        field: string
        box?: { x: number; y: number; width: number; height: number }
      }>
    }

/**
 * Decodes desktop main's answer without trusting it to be complete.
 *
 * A partial answer is more dangerous than no answer: accepting three entries while a fourth was
 * malformed would make the ordinary rendering path leak that fourth value. The decoder therefore
 * rejects the entire response unless the text and screenshot lists describe exactly the same live
 * registrations.
 */
export function decodeRedactionState(value: unknown): RedactionContext | undefined {
  const invalid = (reason: string): never => {
    throw new Error(`Invalid in-app browser redaction state: ${reason}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('expected an object')
  const record = value as Record<string, unknown>

  if (record.active === false) {
    if (Object.keys(record).some((key) => key !== 'active')) invalid('inactive state carried data')
    return undefined
  }
  if (record.active !== true) invalid('active must be a boolean')

  const saltString = record.salt
  if (typeof saltString !== 'string') invalid('salt was missing')
  const salt = Buffer.from(saltString as string, 'base64')
  if (salt.length !== 32 || salt.toString('base64') !== saltString) invalid('salt was not canonical 32-byte base64')
  const rawEntries = record.entries
  const rawLive = record.live
  if (!Array.isArray(rawEntries) || !Array.isArray(rawLive)) invalid('live registrations were missing')
  const entryCandidates = rawEntries as unknown[]
  const liveCandidates = rawLive as unknown[]
  if (entryCandidates.length === 0 || liveCandidates.length === 0) invalid('active state was empty')

  const entries: RedactionEntry[] = []
  const entriesById = new Map<string, RedactionEntry>()
  for (const candidate of entryCandidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) invalid('entry was not an object')
    const entry = candidate as Record<string, unknown>
    if (typeof entry.id !== 'string' || !entry.id) invalid('entry id was missing')
    if (typeof entry.field !== 'string' || !entry.field) invalid('entry field was missing')
    if (typeof entry.fingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(entry.fingerprint)) {
      invalid('entry fingerprint was malformed')
    }
    if (!Number.isSafeInteger(entry.length) || (entry.length as number) < 1) invalid('entry length was malformed')
    if (
      typeof entry.shape !== 'string' ||
      [...entry.shape].length !== entry.length ||
      !/^[das.]+$/.test(entry.shape)
    ) {
      invalid('entry shape was malformed')
    }
    const id = entry.id as string
    const field = entry.field as string
    const fingerprint = entry.fingerprint as string
    const length = entry.length as number
    const shape = entry.shape as string
    if (entriesById.has(id)) invalid('entry ids were not unique')
    const decoded: RedactionEntry = {
      id,
      field,
      fingerprint,
      length,
      shape,
    }
    entries.push(decoded)
    entriesById.set(decoded.id, decoded)
  }

  const live: RedactionContext['live'] = []
  const liveIds = new Set<string>()
  for (const candidate of liveCandidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) invalid('live item was not an object')
    const item = candidate as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || liveIds.has(item.id)) invalid('live ids were malformed')
    if (typeof item.field !== 'string' || !item.field) invalid('live field was missing')
    const id = item.id as string
    const field = item.field as string
    const entry = entriesById.get(id)
    if (!entry || entry.field !== field) invalid('text and screenshot registrations disagreed')

    let box: RedactionContext['live'][number]['box']
    if (item.box !== undefined) {
      if (!item.box || typeof item.box !== 'object' || Array.isArray(item.box)) invalid('box was not an object')
      const rawBox = item.box as Record<string, unknown>
      if (
        !Number.isFinite(rawBox.x) ||
        !Number.isFinite(rawBox.y) ||
        !Number.isFinite(rawBox.width) ||
        !Number.isFinite(rawBox.height) ||
        (rawBox.width as number) <= 0 ||
        (rawBox.height as number) <= 0
      ) {
        invalid('box was malformed')
      }
      box = {
        x: rawBox.x as number,
        y: rawBox.y as number,
        width: rawBox.width as number,
        height: rawBox.height as number,
      }
    }
    liveIds.add(id)
    live.push({ id, field, ...(box ? { box } : {}) })
  }
  if (liveIds.size !== entriesById.size) invalid('text and screenshot registrations were incomplete')

  return { entries, salt, live }
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
  // Only ASCII alphanumerics form identifier runs here. Treating every letter alike made Chinese
  // prose adjacent to a passport number (`证件E123…`) look like one giant word and skipped the
  // exact match. CJK has no whitespace word boundary, so that false negative is the common case.
  return /[0-9A-Za-z]/.test(a) && /[0-9A-Za-z]/.test(b)
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
