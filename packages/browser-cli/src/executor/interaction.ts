/**
 * General web-interaction primitives — the recurring ways a form fights back.
 *
 * These are deliberately **not** per-site adapters. A selector recipe for one booking site is a
 * hand-maintained artifact that rots the moment the site redeploys, and the class names such a
 * recipe would pin (`_i35uMwXbSrObIydlLne`, `DjfnmDOTlIzAMQQ7xsRp`) are build hashes — guaranteed
 * to change. What generalises is not *where* the controls are but *how forms misbehave*:
 *
 * - an autocomplete panel stays open and swallows the click meant for the submit button;
 * - a date field is not a text input but a popup calendar of cells;
 * - submitting lands on an auth wall or a challenge instead of results.
 *
 * Those three hold on every booking site, so they are worth solving once, in code. Everything
 * genuinely site-specific — which field is the destination, what the confirm button says — is
 * left to the agent, which reads it from the accessibility tree the way a person reads the page.
 * Accessible names exist to be understood by whoever is looking; that is exactly why they are an
 * order of magnitude more stable than hashed class names, and why locating by them is not
 * "adapting to a site" at all.
 *
 * Anything a run *discovers* about a specific site ("this dropdown blocks the search button")
 * belongs in the agent's Memory, written by the agent and re-verified on use — not compiled in
 * here. A learned hint is a hypothesis about a page that may since have changed, so the skill
 * treats it as something to confirm against the current snapshot, never as fact.
 */
import type { Locator, Page } from '../browser/playwright-import.js'

/** How an attempted submission actually ended. */
export type OutcomeKind = 'ok' | 'auth_wall' | 'challenge' | 'error'

export interface Outcome {
  kind: OutcomeKind
  url: string
  title: string
  /** What the classification keyed on, so a wrong call is debuggable rather than mysterious. */
  evidence: string
}

/** Substrings that mean "sign in first", across the sites this project touches and beyond. */
const AUTH_URL_HINTS = ['passport.', '/login', '/signin', '/sign-in', 'accounts.', '/auth/']
const AUTH_TEXT_HINTS = ['请登录', '登录后', 'sign in to continue', 'please log in']

/** Substrings that mean "prove you are human". Distinct from auth: a human must act, not just own an account. */
const CHALLENGE_TEXT_HINTS = [
  '安全验证',
  '滑块',
  '请完成验证',
  '拖动滑块',
  'captcha',
  'verify you are human',
  'unusual traffic',
]

function containsAny(haystack: string, needles: string[]): string | undefined {
  const lower = haystack.toLowerCase()
  return needles.find((needle) => lower.includes(needle.toLowerCase()))
}

/**
 * Classifies where a page ended up.
 *
 * Auth walls and challenges are kept apart because the responses differ completely: an auth wall
 * is resolved once, at task start, by the person being present (this project's "presence check");
 * a challenge is a mid-run handoff with a live clock. Collapsing them would send a 60-second
 * captcha down the path meant for a login that can wait.
 */
export async function classifyOutcome(page: Page, sampleChars = 40_000): Promise<Outcome> {
  const url = page.url()
  const title = await page.title().catch(() => '')

  const urlHint = containsAny(url, AUTH_URL_HINTS)
  if (urlHint) return { kind: 'auth_wall', url, title, evidence: `url contains "${urlHint}"` }

  const body = (await page.content().catch(() => '')).slice(0, sampleChars)

  const challengeHint = containsAny(body, CHALLENGE_TEXT_HINTS) ?? containsAny(title, CHALLENGE_TEXT_HINTS)
  if (challengeHint) return { kind: 'challenge', url, title, evidence: `page mentions "${challengeHint}"` }

  const authHint = containsAny(body, AUTH_TEXT_HINTS) ?? containsAny(title, AUTH_TEXT_HINTS)
  if (authHint) return { kind: 'auth_wall', url, title, evidence: `page mentions "${authHint}"` }

  return { kind: 'ok', url, title, evidence: 'no auth or challenge markers' }
}

/** Playwright reports interception as "<el> … intercepts pointer events". */
function isInterception(error: unknown): boolean {
  return /intercepts pointer events/i.test(error instanceof Error ? error.message : String(error))
}

/** A plain actionability timeout: found, but never judged visible/enabled/stable in time. */
function isActionabilityTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Timeout .* exceeded/i.test(message) && !isInterception(error)
}

/**
 * Clicks at the element's centre — but only after confirming the element really is what sits
 * there.
 *
 * This exists for a specific, common false negative: Playwright's "stable" check requires the
 * bounding box to hold still across two frames, and a page with a perpetual animation anywhere in
 * the ancestor chain never satisfies it. The element is visible, enabled and genuinely on top;
 * the click simply never fires.
 *
 * Crucially this is *not* `{ force: true }`. Force dispatches wherever the coordinates land,
 * including into an overlay — on a booking page that is how an agent clicks something it never
 * meant to. Here `elementFromPoint` verifies the target (or a descendant of it) owns that pixel,
 * and the click is abandoned when it does not.
 */
async function clickAtCentreIfTopmost(page: Page, target: Locator): Promise<boolean> {
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined)
    const box = await target.boundingBox({ timeout: 3000 })
    if (!box || box.width === 0 || box.height === 0) return false
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    const ownsPoint = await target.evaluate(
      (element, point) => {
        const top = document.elementFromPoint(point.x, point.y)
        return !!top && (top === element || element.contains(top) || top.contains(element))
      },
      { x, y },
    )
    if (!ownsPoint) return false

    await page.mouse.click(x, y)
    return true
  } catch {
    return false
  }
}

export interface ClickThroughOptions {
  /** Per-attempt click budget. Kept short: an intercepted click fails fast and is worth retrying. */
  timeoutMs?: number
  /** How long to wait for the control to exist at all. Generous — rendering can be slow. */
  appearTimeoutMs?: number
  /** How many dismiss-and-retry rounds before giving up. */
  attempts?: number
  /** Somewhere harmless to move focus to, to close whatever is floating. Defaults to `body`. */
  dismissBy?: () => Promise<void>
}

/**
 * Clicks a target that a floating layer keeps stealing the click from.
 *
 * The pattern this solves: type into a destination field, an autocomplete panel opens, and the
 * submit button is now *visually* clickable but sits under an invisible overlay. Playwright
 * retries for its whole timeout and then fails — correctly, since blindly forcing the click would
 * dispatch it into the overlay.
 *
 * The fix is what a person does without thinking: dismiss the floating thing, then click. Escape
 * first (cheapest, works for most menus), then a neutral click to blur, then retry. `force` is
 * never used — a forced click lands somewhere unpredictable, and on a booking page unpredictable
 * clicks cost money.
 */
export async function clickThrough(
  page: Page,
  target: Locator,
  options: ClickThroughOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 4000
  const attempts = options.attempts ?? 4
  let lastError: unknown

  // Waiting for the control to *exist* and retrying past an overlay are different problems with
  // opposite budgets: appearing can take many seconds on a slow render, while an intercepted
  // click should fail fast so the overlay can be dismissed and the click retried. Sharing one
  // short timeout for both makes a page that simply renders late look like a permanent failure.
  await target.first().waitFor({ state: 'attached', timeout: options.appearTimeoutMs ?? 30_000 })

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await target.click({ timeout: timeoutMs })
      return
    } catch (error) {
      lastError = error
      if (isActionabilityTimeout(error) && (await clickAtCentreIfTopmost(page, target))) return
      if (!isInterception(error)) throw error
      if (options.dismissBy) {
        await options.dismissBy()
      } else {
        await page.keyboard.press('Escape').catch(() => undefined)
        // A click in the page's own margin blurs whatever is open without hitting a control.
        await page.mouse.click(4, 4).catch(() => undefined)
      }
      await page.waitForTimeout(400)
    }
  }
  throw lastError
}

export interface FillWithSuggestionOptions {
  /** Accessible name of the field, e.g. `目的地`. */
  fieldName: string
  value: string
  /**
   * Which suggestion to take. Defaults to the first whose text contains `value` — the same
   * judgement a person makes, and the reason this is not a per-site rule.
   */
  chooseText?: string
  /** How long to let suggestions appear. */
  settleMs?: number
}

/**
 * Fills a combobox-style field and commits a suggestion.
 *
 * Committing matters twice over: the field's real value is often only set when a suggestion is
 * taken (typing alone leaves the form unsubmittable), and an open panel is exactly what steals
 * the later click on submit. Keyboard first — `ArrowDown`+`Enter` is how these widgets are meant
 * to be driven and does not depend on where the panel rendered — with a text click as fallback.
 */
export async function fillWithSuggestion(
  page: Page,
  options: FillWithSuggestionOptions,
): Promise<{ committed: 'keyboard' | 'click' | 'none'; value: string }> {
  const { fieldName, value } = options
  const settleMs = options.settleMs ?? 2000
  const field = page.getByRole('textbox', { name: fieldName }).first()

  await clickThrough(page, field)
  await field.fill(value)
  await page.waitForTimeout(settleMs)

  await page.keyboard.press('ArrowDown').catch(() => undefined)
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter').catch(() => undefined)
  await page.waitForTimeout(600)

  const afterKeyboard = await field.inputValue().catch(() => '')
  if (afterKeyboard.trim() !== '') return { committed: 'keyboard', value: afterKeyboard }

  const suggestion = page.getByText(options.chooseText ?? value, { exact: false }).first()
  if (await suggestion.count().then((count) => count > 0).catch(() => false)) {
    await clickThrough(page, suggestion)
    await page.waitForTimeout(500)
    return { committed: 'click', value: await field.inputValue().catch(() => '') }
  }
  return { committed: 'none', value: afterKeyboard }
}

/**
 * Localised aria-labels a date cell might carry, most specific first.
 *
 * Calendars label their cells for screen readers, which is the one description of a date that is
 * meant to be read rather than parsed — so it is what to match on. Several renderings are tried
 * because the format is a locale choice, not a site choice.
 */
export function dateCellLabels(date: Date): string[] {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return [
    `${year}年${month}月${day}日`,
    iso,
    `${year}/${month}/${day}`,
    date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  ]
}

/**
 * Opens the calendar attached to a date field and picks a day.
 *
 * A date field is a popup, not a text input: typing into it is ignored or silently reformatted by
 * most implementations, so the only reliable route is the one a person takes — open it, click the
 * day. Returns the label that matched, which is what a run should record if it wants to remember
 * how this site labels its cells.
 */
export async function pickDate(
  page: Page,
  options: { fieldName: string; date: Date; settleMs?: number },
): Promise<{ matchedLabel: string }> {
  const settleMs = options.settleMs ?? 1200
  await clickThrough(page, page.getByRole('textbox', { name: options.fieldName }).first())
  await page.waitForTimeout(settleMs)

  for (const label of dateCellLabels(options.date)) {
    const cell = page.locator(`[aria-label^="${label}"]`).first()
    if (await cell.count().then((count) => count > 0).catch(() => false)) {
      await clickThrough(page, cell)
      return { matchedLabel: label }
    }
  }
  throw new Error(
    `No calendar cell found for ${options.date.toISOString().slice(0, 10)}. Tried: ` +
      `${dateCellLabels(options.date).join(' | ')}. Take a snapshot and check how this calendar ` +
      `labels its cells — then record the working form in memory for next time.`,
  )
}

/**
 * Submits and reports what happened, rather than assuming it worked.
 *
 * The observe-act-**verify** loop matters most here: a submit that lands on a login wall looks
 * exactly like a submit that worked, right up until the results are read and turn out to be a
 * sign-in form.
 */
export async function submitAndClassify(
  page: Page,
  options: { buttonName: string; settleMs?: number },
): Promise<Outcome & { resultPage: Page; openedNewTab: boolean }> {
  const settleMs = options.settleMs ?? 6000

  // Search forms very often open their results in a new tab. Watching for it has to start
  // *before* the click, or the page appears while nobody is listening and the run goes on
  // inspecting the form it just submitted — which still looks fine, and is the wrong page.
  const popup = page
    .context()
    .waitForEvent('page', { timeout: settleMs + 4000 })
    .catch(() => null)

  await clickThrough(page, page.getByRole('button', { name: options.buttonName }).first(), {
    timeoutMs: 6000,
  })

  const opened = await popup
  const resultPage = opened ?? page
  await resultPage.waitForLoadState('domcontentloaded').catch(() => undefined)
  await resultPage.waitForTimeout(settleMs)

  const outcome = await classifyOutcome(resultPage)
  return { ...outcome, resultPage, openedNewTab: opened !== null }
}
