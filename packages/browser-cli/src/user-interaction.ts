/**
 * How the agent asks a person for something — six kinds, two destinations.
 *
 * This replaces `requestHelp`, which had one destination: an overlay drawn on the page the person
 * was already looking at. That was the right primitive for a captcha and the wrong one for
 * everything else, and "everything else" is most of it. Confirming a price, choosing between three
 * flights, answering "how many passengers?" — none of those needs the browser, and putting them
 * there is what made *hand the user the browser* the default path the whole design is trying to
 * undo (003 §0.2).
 *
 * So the primitive dispatches on where the person has to act:
 *
 * | kind | Where it goes | What happens to the agent |
 * | --- | --- | --- |
 * | `info_request` / `selection` / `commitment_confirmation` | a card in the conversation | keeps working |
 * | `secret_entry` | a card, and the person types the code into the page or their bank's app | pauses |
 * | `human_challenge` | the overlay, on the page | hands the page over, briefly |
 * | `browser_takeover` | the overlay, with a stated reason | hands the page over — last resort |
 *
 * The card kinds travel to the harness over the interaction endpoint whose address and token are in
 * this process's environment (see the server's `interaction/tokens.ts`), because the card belongs in
 * the conversation and the conversation is the harness's. When that environment is absent — a
 * developer running the CLI by hand, an agent outside the app — the call does not silently degrade
 * into an overlay: it returns `unavailable` and says so, because a payment confirmation drawn on
 * the booking page is exactly the thing this design refuses to do.
 */
import { requestHelp, type RequestHelpResult } from './request-help.js'
import type { Page } from './playwright-import.js'
import { applyControlEvent, drainWrites } from './handover-state.js'

export type InteractionKind =
  | 'info_request'
  | 'selection'
  | 'commitment_confirmation'
  | 'secret_entry'
  | 'human_challenge'
  | 'browser_takeover'

/** One option on a selection card. `rationale` is required — see the transaction layer. */
export interface InteractionOption {
  id: string
  label: string
  rationale: string
  plan?: Record<string, unknown>
}

/** The seven fields of a purchase (003 §8.1). Missing any of them refuses the card. */
export interface PaymentSummaryInput {
  merchant: { name: string; domain: string }
  item: string
  amount: { value: number; currency: string }
  cancellation: { summary: string; url?: string }
  paymentMethod: { alias: string; brand?: string; last4?: string }
  expiresAt?: string
}

export interface RequestInteractionOptions {
  kind: InteractionKind
  /** Imperative: what the person should do. */
  ask: string
  /** One line of context. Never a value. */
  summary?: string
  /** The page, for the two kinds that draw on it. Defaults to the session's own. */
  page?: Page
  timeoutMs?: number
  signal?: AbortSignal
  /** `selection` */
  options?: InteractionOption[]
  /** `commitment_confirmation` */
  payment?: PaymentSummaryInput
  offeredTolerance?: { amountIncrease: number }
  /** `secret_entry` */
  field?: 'cvv' | 'otp' | 'three_d_secure' | 'card_number' | 'payment_password' | 'passkey'
  purpose?: string
  /** `human_challenge` / `browser_takeover` */
  targetSelector?: string
  /** `browser_takeover`: required, non-empty. */
  reason?: string
  /** The session whose control state a handover moves. Defaults to the executor's session id. */
  sessionId?: string
  /**
   * Where this call is running.
   *
   * `'executor'` means inside an executed snippet — that code runs in the **relay** process, which
   * is shared between conversations and deliberately holds no conversation's credential. The two
   * page kinds work there (they draw on the page in front of the person); a card has to be raised
   * from the agent's own command, and saying so is more useful than a bare "unavailable".
   */
  caller?: 'cli' | 'executor'
}

export interface InteractionResult {
  /** True only when the person answered affirmatively. Decline, lapse and abort are all false. */
  resolved: boolean
  status: 'answered' | 'declined' | 'timeout' | 'aborted' | 'unavailable'
  /** Free text they typed, or the message they left when handing the page back. */
  value?: string
  values?: Record<string, string>
  /** `selection`: which option. */
  optionId?: string
  /** `commitment_confirmation`: whether they approved the purchase. */
  approved?: boolean
  message?: string
  /** The card's id, for logs and for a second look at the outcome. */
  interactionId?: string
  /** Why it ended, in words the agent can act on. */
  detail?: string
  waitedMs: number
}

/** Where the harness listens, and the credential for this turn. Absent outside the app. */
interface HarnessChannel {
  baseUrl: string
  token: string
  sessionId: string
}

export function harnessChannel(env: NodeJS.ProcessEnv = process.env): HarnessChannel | null {
  const baseUrl = env.PENGUIN_INTERACTION_URL?.trim()
  const token = env.PENGUIN_INTERACTION_TOKEN?.trim()
  const sessionId = env.PENGUIN_SESSION_ID?.trim()
  if (!baseUrl || !token || !sessionId) return null
  return { baseUrl, token, sessionId }
}

const CARD_KINDS: ReadonlySet<InteractionKind> = new Set([
  'info_request',
  'selection',
  'commitment_confirmation',
  'secret_entry',
])

/** What to tell the agent when there is no conversation to put a card in. */
function unavailable(options: RequestInteractionOptions, waitedMs: number): InteractionResult {
  if (options.caller === 'executor') {
    return {
      resolved: false,
      status: 'unavailable',
      waitedMs,
      detail:
        `A ${options.kind} card belongs to the conversation, and executed snippets run in the ` +
        `relay process, which is shared between conversations and holds no conversation's ` +
        `credential. Raise it from your own command instead: ` +
        `penguin-browser interaction request --kind ${options.kind} --ask "…". Only ` +
        `human_challenge and browser_takeover work from inside a snippet.`,
    }
  }
  const guidance =
    options.kind === 'commitment_confirmation'
      ? 'A payment confirmation belongs in the conversation, not on the booking page. Stop here ' +
        'and tell the person what you found, with the amount, the merchant and the cancellation ' +
        'terms, so they can decide.'
      : options.kind === 'secret_entry'
        ? "Ask the person to type the code themselves, in the site's own field or their bank's " +
          'app. This application never types one for them.'
        : 'Ask in your reply instead, and wait for the person to answer.'
  return {
    resolved: false,
    status: 'unavailable',
    waitedMs,
    detail:
      'This command is not running inside a Travel Agent turn, so there is no conversation to ' +
      `raise a card in. ${guidance}`,
  }
}

async function postJson(
  channel: HarnessChannel,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return await fetch(new URL(path, channel.baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${channel.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
}

/** The card half: raise it, then wait, re-attaching if the wait is cut short. */
async function requestCard(
  options: RequestInteractionOptions,
  channel: HarnessChannel,
  startedAt: number,
): Promise<InteractionResult> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const payload: Record<string, unknown> = {
    sessionId: channel.sessionId,
    kind: options.kind,
    ask: options.ask,
    summary: options.summary ?? '',
    timeoutMs,
  }
  if (options.kind === 'selection') payload.options = options.options ?? []
  if (options.kind === 'commitment_confirmation') {
    payload.payment = options.payment
    if (options.offeredTolerance) payload.offeredTolerance = options.offeredTolerance
  }
  if (options.kind === 'secret_entry') {
    payload.field = options.field
    payload.purpose = options.purpose
  }

  const created = await postJson(channel, '/api/agent/interactions', payload, options.signal)
  if (!created.ok) {
    const body = (await created.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(
      `The card was refused (${created.status}): ${body.error?.message ?? 'unknown reason'}`,
    )
  }
  const { interactionId } = (await created.json()) as { interactionId: string }

  // One long poll, then re-attach: the answer is remembered on the harness side, so a socket that
  // dies mid-wait costs a round trip rather than the person's answer.
  const deadline = startedAt + timeoutMs + 5_000
  for (;;) {
    const waitMs = Math.max(1_000, Math.min(30_000, deadline - Date.now()))
    const url = new URL(`/api/agent/interactions/${interactionId}`, channel.baseUrl)
    url.searchParams.set('sessionId', channel.sessionId)
    url.searchParams.set('waitMs', String(waitMs))
    let response: Response
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${channel.token}` },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (error) {
      if (options.signal?.aborted) {
        return {
          resolved: false,
          status: 'aborted',
          interactionId,
          waitedMs: Date.now() - startedAt,
        }
      }
      if (Date.now() >= deadline) throw error
      continue
    }
    if (!response.ok) {
      // The turn ended underneath us, or the card is gone. Either way there is no answer coming.
      return {
        resolved: false,
        status: 'aborted',
        interactionId,
        waitedMs: Date.now() - startedAt,
        detail: 'The question ended without an answer (the turn finished, or it was cancelled).',
      }
    }
    const { outcome } = (await response.json()) as {
      outcome: {
        status: 'answered' | 'declined' | 'timeout' | 'aborted'
        value?: string
        values?: Record<string, string>
        optionId?: string
        approved?: boolean
        message?: string
      }
    }
    const waitedMs = Date.now() - startedAt
    if (outcome.status === 'answered') {
      return {
        resolved: outcome.approved !== false,
        status: 'answered',
        interactionId,
        waitedMs,
        ...(outcome.value !== undefined ? { value: outcome.value } : {}),
        ...(outcome.values !== undefined ? { values: outcome.values } : {}),
        ...(outcome.optionId !== undefined ? { optionId: outcome.optionId } : {}),
        ...(outcome.approved !== undefined ? { approved: outcome.approved } : {}),
        ...(outcome.message !== undefined ? { message: outcome.message } : {}),
      }
    }
    if (outcome.status === 'timeout' && Date.now() < deadline) continue
    return {
      resolved: false,
      status: outcome.status,
      interactionId,
      waitedMs,
      ...(outcome.message !== undefined ? { message: outcome.message } : {}),
      ...(outcome.status === 'declined'
        ? { detail: 'The person said no. Do not do it, and do not ask again the same way.' }
        : {}),
    }
  }
}

/**
 * The overlay half: the two kinds where the person acts in the page.
 *
 * The control state moves with it, and in this order for a reason: the agent is refused *before*
 * the person is told the page is theirs, and the in-flight writes are drained in between. Handing
 * over first and stopping writes afterwards is the window where a click the agent already
 * dispatched lands in a form somebody else is filling in.
 */
async function requestPageHandover(
  options: RequestInteractionOptions,
  page: Page,
  sessionId: string,
  startedAt: number,
): Promise<InteractionResult> {
  const kind = options.kind as 'human_challenge' | 'browser_takeover'
  if (kind === 'browser_takeover' && !options.reason?.trim()) {
    throw new Error(
      'A browser takeover needs a reason: it is the last resort, and an unexplained one cannot ' +
        'be reviewed. Say what the other five kinds could not do (003 §7.4).',
    )
  }

  applyControlEvent(sessionId, {
    type: 'request_handover',
    kind,
    ...(options.reason ? { reason: options.reason } : {}),
  })
  await drainWrites(sessionId)
  applyControlEvent(sessionId, { type: 'drained' })

  let help: RequestHelpResult
  try {
    help = await requestHelp({
      page,
      prompt: options.ask,
      ...(options.targetSelector ? { targetSelector: options.targetSelector } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(kind === 'browser_takeover' && options.reason ? { reason: options.reason } : {}),
    })
  } finally {
    // Whatever happened — answered, lapsed, the page closed, the overlay threw — the agent has the
    // page again. Leaving the machine in `user_control` would refuse every later write for the rest
    // of the session, so a handoff that failed would be indistinguishable from one that never
    // ended.
    try {
      applyControlEvent(sessionId, { type: 'user_returned' })
      applyControlEvent(sessionId, { type: 'resumed' })
    } catch {
      // Something else moved the machine while the person had the page (a session reset, an
      // abort). `abort` is legal from every state and lands where this was trying to get to.
      applyControlEvent(sessionId, { type: 'abort' })
    }
  }

  const waitedMs = Date.now() - startedAt
  if (help.resolved) {
    return {
      resolved: true,
      status: 'answered',
      waitedMs,
      ...(help.message !== undefined ? { message: help.message, value: help.message } : {}),
    }
  }
  return {
    resolved: false,
    status:
      help.reason === 'cancelled' ? 'declined' : help.reason === 'timeout' ? 'timeout' : 'aborted',
    waitedMs,
    ...(help.message !== undefined ? { message: help.message } : {}),
    detail:
      help.reason === 'timeout'
        ? 'Nobody answered in time. Re-read the page before deciding whether to ask again — it ' +
          'may have moved on.'
        : undefined,
  }
}

/**
 * Asks the person for one thing, and waits.
 *
 * Never throws for the ordinary outcomes — declined, lapsed, aborted, no conversation to ask in —
 * because each of those is a state the agent has to handle rather than an exception. It *does*
 * throw for a request that should never have been made: a takeover with no reason, a card the
 * harness refused as incomplete.
 */
export async function requestUserInteraction(
  options: RequestInteractionOptions & { page?: Page; sessionId?: string },
): Promise<InteractionResult> {
  const startedAt = Date.now()

  if (CARD_KINDS.has(options.kind)) {
    const channel = harnessChannel()
    if (!channel) return unavailable(options, Date.now() - startedAt)
    return await requestCard(options, channel, startedAt)
  }

  if (!options.page) {
    throw new Error(
      `${options.kind} happens in the page, so it needs one. Pass \`page\`, or use a card kind if ` +
        `the person does not actually have to touch the browser.`,
    )
  }
  const sessionId = options.sessionId ?? harnessChannel()?.sessionId ?? 'default'
  return await requestPageHandover(options, options.page, sessionId, startedAt)
}
