/**
 * Turning "the person said yes" into something a machine can check afterwards.
 *
 * Three jobs, and each exists because the obvious version fails in a specific way:
 *
 * 1. **A digest of what was shown.** Consent is to a *particular* purchase. Without a hash of the
 *    exact summary that was on screen, "they confirmed" is a boolean floating free of the thing it
 *    was about, and a later "yes" can be attached to a different price.
 * 2. **A commitment, with no tolerance unless it was chosen.** The exact amount is the hard
 *    ceiling by default (003 §8.5). Slack is only real when the card offered it in words and the
 *    person selected it — never inferred from the conversation, never carried over from last time.
 * 3. **A deterministic reading of a natural-language confirmation.** People say "好" and "付吧",
 *    and a model asked "did they confirm?" will happily say yes. So the judgement is a pure
 *    function over the reply and the summary, it errs towards refusal, and falling back to the
 *    card is a normal outcome rather than a failure (003 §8.4).
 *
 * Nothing here performs a payment or knows how one is performed. It produces the values the guarded
 * path in `booking.ts` consumes, and the card the person actually reads.
 */

import { createHash } from "node:crypto";
import type { AuthorityCeiling, Commitment, Drift, Tolerance } from "./commitment.js";
import type { ApprovedTolerance, PaymentSummary } from "./interaction.js";
import { assertCompleteSummary } from "./interaction.js";

/** Canonical JSON — the same rule as the journal's key derivation, for the same reason. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The hash of the summary exactly as shown.
 *
 * Stable across key order and independent of how the card rendered it. Once computed it is not
 * recomputed: it names *the screen the person looked at*, so a summary edited afterwards produces a
 * different digest and therefore a different confirmation, which is the intended behaviour.
 */
export function paymentSummaryDigest(summary: PaymentSummary): string {
  return createHash("sha256").update(canonicalJson(summary), "utf8").digest("hex").slice(0, 32);
}

/**
 * The structured plan behind a summary, for drift comparison.
 *
 * Flat and small on purpose: every field here is one a person can check on a card, and drift in any
 * of them is a reason to ask again. The amount is a bare number so `checkDrift`'s numeric tolerance
 * applies to it, and the currency is a separate string so a currency change can never be read as a
 * price change within tolerance.
 */
export function planFromSummary(summary: PaymentSummary): Record<string, unknown> {
  return {
    merchantDomain: summary.merchant.domain,
    item: summary.item,
    amount: summary.amount.value,
    currency: summary.amount.currency,
    cancellation: summary.cancellation.summary,
  };
}

/**
 * The commitment a confirmed card produces.
 *
 * `ceiling` defaults to `pay` because that is what the person confirmed — the card says "pay this".
 * Tolerance is empty unless it was explicitly approved: an unapproved tolerance is zero, and this
 * function has no way to express "some slack that nobody chose".
 */
export function commitmentFromConfirmation(input: {
  summary: PaymentSummary;
  /** Only when the person selected the slack the card offered. */
  approvedTolerance?: ApprovedTolerance;
  channel: string;
  ceiling?: AuthorityCeiling;
  approvedAt?: string;
}): Commitment {
  const summary = assertCompleteSummary(input.summary);
  const tolerance: Tolerance = {};
  if (input.approvedTolerance && input.approvedTolerance.amountIncrease > 0) {
    tolerance.amount = { increase: input.approvedTolerance.amountIncrease };
  }
  return {
    approved: planFromSummary(summary),
    tolerance,
    ceiling: input.ceiling ?? "pay",
    approvedAt: input.approvedAt ?? new Date().toISOString(),
    channel: input.channel,
  };
}

/** How a drift should be handled — not every difference deserves the same answer. */
export interface DriftVerdict {
  /** Nothing moved. */
  clean: boolean;
  /**
   * The merchant domain changed.
   *
   * There is deliberately no re-confirmation path for this one (003 §8.3). A payment page that is
   * suddenly on another domain is the shape of a redirect hijack or a phishing hand-off, and
   * offering "confirm the new one?" would be offering to walk into it.
   */
  merchantMismatch: boolean;
  /** Anything else that moved: price beyond tolerance, dates, cancellation terms, a new fee. */
  reconfirm: Drift[];
}

export function classifyDrift(drifts: readonly Drift[]): DriftVerdict {
  const merchantMismatch = drifts.some((drift) => drift.path === "merchantDomain");
  return {
    clean: drifts.length === 0,
    merchantMismatch,
    reconfirm: merchantMismatch ? [] : [...drifts],
  };
}

// ---------------------------------------------------------------------------
// Natural-language confirmation (003 §8.4)
// ---------------------------------------------------------------------------

export interface ConfirmationJudgement {
  /** True only when the reply is an explicit confirmation of *this* purchase. */
  confirmed: boolean;
  /** Why, in one line, for the trace and for the card that gets shown when it is false. */
  reason: string;
  /** What the reply was missing, when it was not enough. Drives the "please confirm on the card" copy. */
  missing: Array<"reference" | "amount" | "merchant" | "item" | "method" | "cancellation">;
}

/**
 * Phrases that feel like agreement and are not, on their own, a confirmation of a purchase.
 *
 * Listed rather than inferred, and the list is the specification: "可以", "好", "就它吧", "付吧",
 * "确认", "嗯", "OK". A reply consisting only of these falls back to the card. That is not the
 * judge being obtuse — it is the difference between agreeing with a conversation and agreeing to
 * spend a specific amount at a specific merchant.
 */
const VAGUE_ONLY = [
  "可以",
  "好",
  "好的",
  "行",
  "就它吧",
  "就这个",
  "付吧",
  "支付吧",
  "确认",
  "嗯",
  "对",
  "是的",
  "ok",
  "okay",
  "yes",
  "sure",
  "go ahead",
  "do it",
  "confirm",
  "proceed",
];

/** Words that make a reply a *reference* to something already shown. */
const REFERENCE_MARKERS = [
  "这单",
  "这个",
  "那个",
  "上面",
  "上述",
  "刚才",
  "这张",
  "这条",
  "该订单",
  "this one",
  "that one",
  "the one above",
  "above",
];

/** Currency symbols and codes we can read, mapped to their ISO code. */
const CURRENCY_TOKENS: Record<string, string> = {
  "¥": "CNY",
  "￥": "CNY",
  元: "CNY",
  人民币: "CNY",
  cny: "CNY",
  rmb: "CNY",
  $: "USD",
  usd: "USD",
  美元: "USD",
  "€": "EUR",
  eur: "EUR",
  "£": "GBP",
  gbp: "GBP",
  "¥jpy": "JPY",
  jpy: "JPY",
  日元: "JPY",
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Every number in the reply, with thousands separators removed, so "1,280" and "1280" are one
 * value.
 *
 * Only the ASCII comma joins digits. A full-width `，` is Chinese *punctuation*, not a separator:
 * treating it as one turned "MU5137，1280 元" into the single number 51371280, and the amount the
 * person actually named stopped being visible to the check.
 */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/,/g, ""));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

function mentionsAmount(reply: string, summary: PaymentSummary): boolean {
  const numbers = numbersIn(reply);
  if (!numbers.some((value) => Math.abs(value - summary.amount.value) < 0.005)) return false;
  // The number alone is not enough when it could be a flight number or a date: the currency has
  // to be visible too, either as a symbol/code or as the summary's own currency word.
  const lowered = normalize(reply);
  const currency = summary.amount.currency.toUpperCase();
  for (const [token, code] of Object.entries(CURRENCY_TOKENS)) {
    if (code !== currency) continue;
    if (lowered.includes(token.toLowerCase())) return true;
  }
  return lowered.includes(currency.toLowerCase());
}

function mentionsMerchant(reply: string, summary: PaymentSummary): boolean {
  const lowered = normalize(reply);
  const name = normalize(summary.merchant.name);
  const domain = normalize(summary.merchant.domain);
  const bare = domain.split(".")[0] ?? domain;
  return (
    (name.length >= 2 && lowered.includes(name)) ||
    (domain.length >= 4 && lowered.includes(domain)) ||
    (bare.length >= 3 && lowered.includes(bare))
  );
}

function mentionsItem(reply: string, summary: PaymentSummary): boolean {
  const lowered = normalize(reply);
  // Any token of the item line that is distinctive enough to be worth matching: flight numbers,
  // hotel names, dates. Short words ("的", "to", "room") match everything and are skipped.
  const tokens = normalize(summary.item)
    .split(/[\s,，、/|·—-]+/)
    .filter((token) => token.length >= 3);
  return tokens.some((token) => lowered.includes(token));
}

function mentionsMethod(reply: string, summary: PaymentSummary): boolean {
  const lowered = normalize(reply);
  const alias = normalize(summary.paymentMethod.alias);
  const last4 = summary.paymentMethod.last4;
  return (
    (alias.length >= 2 && lowered.includes(alias)) ||
    (!!last4 && lowered.includes(last4)) ||
    (!!summary.paymentMethod.brand && lowered.includes(normalize(summary.paymentMethod.brand)))
  );
}

const CANCELLATION_MARKERS = [
  "退改",
  "退款",
  "不可退",
  "可退",
  "取消政策",
  "条款",
  "看过",
  "读过",
  "cancellation",
  "refund",
  "non-refundable",
  "terms",
  "read the",
];

function acknowledgesCancellation(reply: string): boolean {
  const lowered = normalize(reply);
  return CANCELLATION_MARKERS.some((marker) => lowered.includes(marker));
}

/** True when the reply is nothing but agreement noise. */
function isVagueOnly(reply: string): boolean {
  const stripped = normalize(reply).replace(/[\s。.!！,，~～、]/g, "");
  if (stripped === "") return true;
  for (const phrase of VAGUE_ONLY) {
    const bare = phrase.replace(/\s/g, "");
    if (stripped === bare) return true;
  }
  return false;
}

/**
 * Decides whether a chat reply confirms *this* purchase.
 *
 * Two cases, from 003 §8.4, and the difference is whether the person has already been shown the
 * whole summary:
 *
 * - **A summary was shown** (`digestShown`): the reply must refer to it *and* name the amount and
 *   the merchant. Referring to it is what stops "yes" from attaching to whatever is on screen now;
 *   naming the amount and merchant is what makes the reference checkable.
 * - **No summary was shown**: the reply has to carry the whole purchase itself — merchant, item,
 *   amount with currency, payment method, and an acknowledgement of the cancellation terms. Five
 *   things, because with nothing on screen the message *is* the card.
 *
 * Errs towards refusal in every ambiguous case. A false negative costs one extra card; a false
 * positive spends the person's money on something they did not read.
 */
export function judgeConfirmationReply(input: {
  reply: string;
  summary: PaymentSummary;
  /** Whether the full summary was displayed to this person before the reply. */
  digestShown: boolean;
}): ConfirmationJudgement {
  const { reply, summary, digestShown } = input;

  if (isVagueOnly(reply)) {
    return {
      confirmed: false,
      reason:
        "The reply agrees with the conversation but does not name the purchase. Show the card and " +
        "let them confirm what they can see.",
      missing: digestShown
        ? ["reference", "amount", "merchant"]
        : ["merchant", "item", "amount", "method", "cancellation"],
    };
  }

  if (digestShown) {
    const missing: ConfirmationJudgement["missing"] = [];
    const lowered = normalize(reply);
    const referenced =
      REFERENCE_MARKERS.some((marker) => lowered.includes(normalize(marker))) ||
      mentionsItem(reply, summary) ||
      mentionsMerchant(reply, summary);
    if (!referenced) missing.push("reference");
    if (!mentionsAmount(reply, summary)) missing.push("amount");
    if (!mentionsMerchant(reply, summary)) missing.push("merchant");
    if (missing.length > 0) {
      return {
        confirmed: false,
        reason:
          "A confirmation in words has to name the amount and the merchant of the summary it is " +
          "answering; this one does not, so the card stands.",
        missing,
      };
    }
    return {
      confirmed: true,
      reason: "The reply refers to the summary shown and names its amount and merchant.",
      missing: [],
    };
  }

  const missing: ConfirmationJudgement["missing"] = [];
  if (!mentionsMerchant(reply, summary)) missing.push("merchant");
  if (!mentionsItem(reply, summary)) missing.push("item");
  if (!mentionsAmount(reply, summary)) missing.push("amount");
  if (!mentionsMethod(reply, summary)) missing.push("method");
  if (!acknowledgesCancellation(reply)) missing.push("cancellation");
  if (missing.length > 0) {
    return {
      confirmed: false,
      reason:
        "Nothing was shown beforehand, so the reply itself has to cover the whole purchase — " +
        "merchant, what it is, the amount and currency, the payment method, and the cancellation " +
        "terms. Show the card instead.",
      missing,
    };
  }
  return {
    confirmed: true,
    reason: "The reply covers the whole purchase on its own.",
    missing: [],
  };
}

/** The card's lines, and the audit's. One per field, in the order a person reads them. */
export function describePaymentSummary(summary: PaymentSummary): string[] {
  return [
    `商家：${summary.merchant.name}（${summary.merchant.domain}）`,
    `内容：${summary.item}`,
    `金额：${summary.amount.value} ${summary.amount.currency}`,
    `退改：${summary.cancellation.summary}`,
    `支付方式：${summary.paymentMethod.alias}${
      summary.paymentMethod.brand ? `（${summary.paymentMethod.brand}` : ""
    }${summary.paymentMethod.last4 ? ` ••${summary.paymentMethod.last4}` : ""}${
      summary.paymentMethod.brand ? "）" : ""
    }`,
    `有效期至：${summary.expiresAt}`,
  ];
}
