/**
 * The one click this build will not make.
 *
 * The person may review a seven-field summary in the conversation, but the agent still stops at
 * the site's payment control. This browser-side check exists because a card alone cannot prevent
 * the ordinary automation path from pressing the button that takes the money.
 *
 * **What it is and is not.** It is a guardrail on the enumerated write surface, matching
 * a control's own words against a curated list. It is not a security boundary: the executor's vm is
 * explicitly not one, and an agent determined to route around a wrapper can. What it
 * buys is that the *ordinary* path — read the page, find the button, click it — stops, with a
 * message saying what to do instead.
 *
 * **False positives are cheap here.** Refusing a click that merely looked like a payment costs one
 * card asking the person to finish; missing a real one costs their money. The list therefore leans
 * inclusive, and a caller that genuinely needs a "submit" that is not a payment can say so in the
 * ask it puts on the card.
 */

/** Words that make a control a payment or an irreversible order submission. */
const PAY_PATTERNS: readonly RegExp[] = [
  // Chinese: pay, confirm payment, submit order, book now, place order.
  /立即支付|去支付|确认支付|马上支付|去付款|确认付款|立即付款/u,
  /提交订单|确认下单|立即下单|立即预订|立即预定|确认预订|确认预定|去结算|去结账/u,
  /支付宝支付|微信支付|云闪付/u,
  // English.
  /\bpay\s*(now|here)?\b/i,
  /\bconfirm\s+(and\s+)?(pay|payment|booking|order)\b/i,
  /\b(place|submit|complete)\s+(the\s+)?order\b/i,
  /\bbook\s+(and\s+)?pay\b/i,
  /\bcheck\s?out\b/i,
  /\bbuy\s+now\b/i,
  /\bproceed\s+to\s+payment\b/i,
]

/** Whether a control's accessible name or text reads as "this takes the money". */
export function looksLikePayment(label: string | null | undefined): boolean {
  if (!label) return false
  const text = label.replace(/\s+/g, ' ').trim()
  if (text === '') return false
  return PAY_PATTERNS.some((pattern) => pattern.test(text))
}

/** Everything the gate needs to describe what it refused. */
export interface PaymentClickRefusal {
  code: 'IAB_PAYMENT_CLICK_BLOCKED'
  message: string
}

export class PaymentClickBlockedError extends Error {
  readonly code = 'IAB_PAYMENT_CLICK_BLOCKED' as const

  constructor(label: string) {
    super(
      `IAB_PAYMENT_CLICK_BLOCKED: "${label}" looks like the control that takes the money, and ` +
        `this build does not press it. Stop here: show the person a commitment_confirmation card ` +
        `with the seven fields (merchant, item, amount, cancellation, payment method, expiry, ` +
        `task) if you have not already, tell them the page is ready, and let them complete the ` +
        `payment themselves. Do not look for another element that does the same thing.`,
    )
    this.name = 'PaymentClickBlockedError'
  }
}

/**
 * Refuses a click on a control that reads as a payment.
 *
 * `label` is whatever the caller could learn about the target cheaply — an accessible name, the
 * link text, the selector's own words. A caller that cannot determine one passes null, and the
 * click goes through: guessing from nothing would refuse half the page.
 */
export function assertClickAllowed(label: string | null | undefined): void {
  if (!looksLikePayment(label)) return
  throw new PaymentClickBlockedError(String(label).trim())
}
