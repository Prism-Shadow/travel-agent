/**
 * Human handoff: hand control back to the person for one step the agent must not or cannot do
 * itself — a verification code, a slider captcha, an OTP, a payment confirmation — then resume.
 *
 * Why this exists as a primitive rather than "print a message and hope": a handoff has to carry
 * four things, and losing any one of them breaks the flow.
 *
 * - **What to do.** `prompt`, plus an optional highlighted target so the human does not have to
 *   hunt for the field.
 * - **A way back.** The overlay's confirm button, polled from here.
 * - **A channel for the human to talk back.** `message` — see below.
 * - **A defined end.** `timeoutMs`, which resolves rather than throws, so the caller decides
 *   what a lapsed handoff means (suspend and resume later, in this project's design).
 *
 * The `message` field is not a nicety. It lets the human change direction while handing control
 * back — "code entered, and also look for an earlier flight" — instead of only unblocking.
 * PenguinHarness already has the semantics for that: a `[user_steering]` message, delivered
 * between turns, absorbed into the current task rather than starting a new one. The caller
 * forwards `message` into that channel; nothing new needs inventing.
 *
 * Navigation is the hard part. Solving a captcha usually *causes* a navigation, which wipes the
 * injected overlay and any exposed binding along with it. So the wait is a poll loop that
 * re-injects whenever the overlay went missing without an answer, and the overlay keeps an
 * already-given answer across re-injection (see `help-overlay-client.ts`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from './playwright-import.js'

/** How often the wait loop asks the page whether the human answered. */
const POLL_INTERVAL_MS = 400

/** Default budget for a handoff. Long enough for an SMS code to arrive and be typed. */
export const DEFAULT_HELP_TIMEOUT_MS = 120_000

export interface RequestHelpOptions {
  page: Page
  /** What the human should do. Write it as an instruction, not a description of the problem. */
  prompt: string
  /** CSS selector of the element to highlight and scroll into view. Best-effort. */
  targetSelector?: string
  /** Budget before the handoff lapses; defaults to {@link DEFAULT_HELP_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Aborts the wait (the overlay is removed and `reason` is `aborted`). */
  signal?: AbortSignal
}

export interface RequestHelpResult {
  /** True only when the human confirmed. Cancel, timeout and abort are all false. */
  resolved: boolean
  /** Free text the human left. Forward it to the agent as steering. */
  message?: string
  reason: 'done' | 'cancelled' | 'timeout' | 'aborted' | 'page_closed'
  /** Wall-clock the human took, for traces. */
  waitedMs: number
}

/** Shape exposed by the injected bundle on the page's `globalThis`. */
interface HelpBridge {
  show: (request: { id: string; prompt: string; targetSelector?: string }) => void
  result: (id: string) => { resolved: boolean; message?: string; reason: string } | undefined
  isShowing: (id: string) => boolean
  dismiss: () => void
}

let overlayCode: string | undefined

function getHelpOverlayCode(): string {
  if (overlayCode) return overlayCode
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  overlayCode = fs.readFileSync(
    path.join(currentDir, '..', 'dist', 'help-overlay-client.js'),
    'utf-8',
  )
  return overlayCode
}

async function ensureOverlayInjected(page: Page): Promise<void> {
  const present = await page.evaluate(
    () => !!(globalThis as unknown as { __penguinHelp?: HelpBridge }).__penguinHelp,
  )
  if (!present) await page.evaluate(getHelpOverlayCode())
}

let sequence = 0

/** Unique per wait, so a re-injected overlay can tell "still my request" from a stale one. */
function nextRequestId(): string {
  sequence += 1
  return `help-${process.pid}-${Date.now()}-${sequence}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Shows the handoff overlay and waits for the human.
 *
 * Never throws for the ordinary outcomes: cancel, timeout, abort and a closed page all come
 * back as `resolved: false` with a `reason`, because a lapsed handoff is a state the caller
 * has to handle, not an exception. Only a genuinely broken page (evaluate rejecting for a
 * reason other than teardown) propagates.
 */
export async function requestHelp(options: RequestHelpOptions): Promise<RequestHelpResult> {
  const { page, prompt, targetSelector, signal } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_HELP_TIMEOUT_MS
  const id = nextRequestId()
  const startedAt = Date.now()
  const waited = () => Date.now() - startedAt

  const request = { id, prompt, targetSelector }
  await ensureOverlayInjected(page)
  await page.evaluate(
    (req) => (globalThis as unknown as { __penguinHelp: HelpBridge }).__penguinHelp.show(req),
    request,
  )

  const dismiss = async (): Promise<void> => {
    try {
      await page.evaluate(() =>
        (globalThis as unknown as { __penguinHelp?: HelpBridge }).__penguinHelp?.dismiss(),
      )
    } catch {
      // The page may be gone or mid-navigation; the overlay dies with it either way.
    }
  }

  for (;;) {
    if (signal?.aborted) {
      await dismiss()
      return { resolved: false, reason: 'aborted', waitedMs: waited() }
    }
    if (waited() >= timeoutMs) {
      await dismiss()
      return { resolved: false, reason: 'timeout', waitedMs: waited() }
    }
    if (page.isClosed()) {
      return { resolved: false, reason: 'page_closed', waitedMs: waited() }
    }

    let poll: { answer?: { resolved: boolean; message?: string; reason: string }; showing: boolean }
    try {
      poll = await page.evaluate((requestId) => {
        const bridge = (globalThis as unknown as { __penguinHelp?: HelpBridge }).__penguinHelp
        if (!bridge) return { showing: false }
        return { answer: bridge.result(requestId), showing: bridge.isShowing(requestId) }
      }, id)
    } catch {
      // Mid-navigation evaluates reject; that is the common case here, not an error. Fall
      // through to the re-injection branch on the next tick.
      if (page.isClosed()) {
        return { resolved: false, reason: 'page_closed', waitedMs: waited() }
      }
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    if (poll.answer) {
      await dismiss()
      return {
        resolved: poll.answer.resolved,
        message: poll.answer.message,
        reason: poll.answer.reason === 'done' ? 'done' : 'cancelled',
        waitedMs: waited(),
      }
    }

    if (!poll.showing) {
      // The page navigated (or re-rendered the overlay away) with no answer recorded: put it
      // back. This is the whole reason the wait polls instead of awaiting a page binding.
      try {
        await ensureOverlayInjected(page)
        await page.evaluate(
          (req) => (globalThis as unknown as { __penguinHelp: HelpBridge }).__penguinHelp.show(req),
          request,
        )
      } catch {
        // Still navigating — retry on the next tick.
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }
}
