/**
 * The one-shot permission to spend money.
 *
 * A confirmation is a moment: somebody read a summary and pressed a button. Everything after that
 * moment — the agent walking to the payment page, the page re-rendering, a fee appearing — happens
 * without them. A capability is what carries that moment forward in a form a machine can check: it
 * names *which* purchase was confirmed (`commitmentDigest`), *who* confirmed it and how
 * (`approvedVia`, `confirmingMessageId`), *what* it may spend (`maxAmount`, `toleranceApproved`),
 * *where* (`merchantDomain`), *for how long* (`expiresAt`), and *at most once* (`usedAt`).
 *
 * Three properties are load-bearing, and each exists because its absence is a known failure:
 *
 * 1. **It is bound to the summary that was shown.** `commitmentDigest` is recomputed here from the
 *    summary and compared, so a capability cannot be issued against a purchase the person never
 *    saw. Without the binding, "they confirmed" is a boolean floating free of its subject and a
 *    later price can be attached to an earlier yes.
 * 2. **It never carries a payment credential.** `paymentMethodRef` is a vault handle or a wallet
 *    alias — never a token, never a card number. A merchant token can itself be able to
 *    charge the card, so an object that travels to a tool call, a trace and an audit record must
 *    not contain one.
 * 3. **It is consumed, not merely checked.** `usedAt` plus a journal key derived from the purchase
 *    (not from the capability id) is what makes a second attempt at the same purchase return the
 *    first attempt's outcome instead of paying again.
 *
 * Nothing here performs a payment, reads a page, or touches a vault. It produces and judges a small
 * value object; `booking.ts` is where the judgement becomes a refusal, and the
 * desktop main process is where the object is stored and consumed.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Commitment } from "./commitment.js";
import { deriveKey } from "./journal.js";
import type { ApprovedTolerance, PaymentSummary } from "./interaction.js";
import { assertCompleteSummary } from "./interaction.js";
import { paymentSummaryDigest } from "./payment.js";

/** How a person said yes. Natural language additionally requires the message that said it. */
export type ApprovalChannel = "card" | "natural_language";

/**
 * A one-shot permission to execute one payment.
 *
 * Serialisable by construction: it crosses a broker IPC boundary, is written to an audit record,
 * and is quoted back in refusals, so every field here is either an identifier, a bound, or a
 * reference — never a value that could be used to charge anything by itself.
 */
export interface PaymentCapability {
  capabilityId: string;
  /** The turn that confirmed. A capability is never reusable by a later turn. */
  taskId: string;
  /** What the person authorised, in the form the drift check understands. */
  commitment: Commitment;
  /** Canonical hash of the summary as displayed. Immutable once shown. */
  commitmentDigest: string;
  /** eTLD+1 of the merchant. The judging field — a display name is what a phishing page controls. */
  merchantDomain: string;
  /** Vault handle or wallet alias. **Never** a token or a card number. */
  paymentMethodRef: string;
  /** The hard bound, tolerance already folded in when — and only when — it was approved. */
  maxAmount: { value: number; currency: string };
  /** Whether the person explicitly accepted slack on the card. */
  toleranceApproved: boolean;
  /** Journal key for the payment. Derived from the purchase, not from this object — see below. */
  idempotencyKey: string;
  expiresAt: string;
  /** Set when the capability has been spent. A capability with this set authorises nothing. */
  usedAt?: string;
  approvedVia: ApprovalChannel;
  /** Required when `approvedVia` is `natural_language`: the message that confirmed. */
  confirmingMessageId?: string;
  /** The audit entry that recorded the issuance, so a refusal can be traced to its origin. */
  auditRef: string;
}

/** Why a capability does not authorise this payment. Every one is a refusal, not an error. */
export type CapabilityRefusal =
  /** Malformed, for another turn, or authorising a different plan than the one being executed. */
  | "capability_invalid"
  | "capability_expired"
  /** Already spent. The journal — not this check — decides what the first attempt achieved. */
  | "capability_used"
  /** The page is on another domain. No re-confirmation path, by design. */
  | "merchant_mismatch"
  /** Over the ceiling. Checked before tolerance, because `maxAmount` is not negotiable. */
  | "amount_over_max"
  /** Price rose and nobody approved slack. The default path. */
  | "tolerance_not_approved";

export type CapabilityCheck =
  { ok: true } | { ok: false; reason: CapabilityRefusal; detail: string[] };

/**
 * Shapes a `paymentMethodRef` may take.
 *
 * An allowlist, because the failure being prevented is a *token* arriving in a field meant for a
 * reference: `pv:` handles come from the vault's grant machinery, and the other three
 * name a credential held somewhere we never see. Anything else is refused at issue time, where the
 * stack still says who built it.
 *
 * The alias forms accept letters in any script — a card people call 常用信用卡 is the ordinary case
 * here, not an edge one — while the handle form stays ASCII because it is generated, not written.
 * Neither may look like a card number, whatever the prefix says.
 */
const METHOD_REF_PATTERN =
  /^(?:pv:[A-Za-z0-9_-]{4,}:[A-Za-z0-9_.-]{1,64}|(?:wallet|merchant_saved|psp):[\p{L}\p{N} ._·-]{1,64})$/u;

/** A run of digits long enough to be a card number, ignoring the separators people write. */
const PAN_SHAPED = /(?:\d[ -]?){13,19}/;

export function isOpaqueMethodRef(ref: string): boolean {
  if (!METHOD_REF_PATTERN.test(ref)) return false;
  return !PAN_SHAPED.test(ref);
}

/**
 * The journal key for a purchase.
 *
 * Derived from the **turn and the digest**, deliberately not from `capabilityId`. Two capabilities
 * issued for the same displayed summary in the same turn — a reissue after a lapsed one, a retry
 * after a dropped connection — are the *same payment*, and keying on the capability would let the
 * second one pay again after the first had already succeeded. A genuinely different purchase has a
 * different digest, so it gets a different key, which is the behaviour a re-confirmation needs.
 */
export function capabilityIdempotencyKey(input: {
  taskId: string;
  commitmentDigest: string;
}): string {
  return deriveKey({
    action: "payment",
    params: { taskId: input.taskId, commitmentDigest: input.commitmentDigest },
  });
}

export interface IssueCapabilityInput {
  /** The summary exactly as it was displayed. Its digest becomes the capability's anchor. */
  summary: PaymentSummary;
  /** The commitment built from that summary (`commitmentFromConfirmation`). */
  commitment: Commitment;
  /** Vault handle or wallet alias for the credential main will use. Never a token. */
  paymentMethodRef: string;
  approvedVia: ApprovalChannel;
  /** Required for `natural_language`, so the exact message that confirmed can be recovered. */
  confirmingMessageId?: string;
  /** Only when the card offered slack **and** the person ticked it. */
  approvedTolerance?: ApprovedTolerance;
  /** The audit entry recording the issuance. */
  auditRef: string;
  /** Defaults to the summary's own expiry, which the server already clamped to ten minutes. */
  expiresAt?: string;
}

export interface IssueCapabilityOptions {
  now?: () => Date;
  /** Injected in tests so the same input produces the same object. */
  capabilityId?: string;
}

/**
 * Issues a capability, refusing every input that would make it a lie.
 *
 * Throws rather than returning a refusal: each check here is a programming error on the way to
 * authorising a payment — a digest that does not match the summary, a token in the method
 * reference, slack that nobody approved — and a caller that could carry on past one of them would
 * be building consent out of parts that do not fit together.
 */
export function issuePaymentCapability(
  input: IssueCapabilityInput,
  options: IssueCapabilityOptions = {},
): PaymentCapability {
  const summary = assertCompleteSummary(input.summary);
  const now = options.now?.() ?? new Date();

  const commitmentDigest = paymentSummaryDigest(summary);

  if (!summary.taskId) {
    throw new Error("A payment capability needs the turn its summary belongs to.");
  }
  if (!isOpaqueMethodRef(input.paymentMethodRef)) {
    throw new Error(
      `paymentMethodRef must be an opaque reference (pv:/wallet:/merchant_saved:/psp:), never a ` +
        `token or a card number: a merchant token may itself be able to charge the card, ` +
        `and this object travels to a tool call, a trace and an audit record.`,
    );
  }
  if (input.approvedVia === "natural_language" && !input.confirmingMessageId?.trim()) {
    throw new Error(
      "A capability approved in words needs the id of the message that approved it, " +
        "so it can be shown afterwards exactly what was said and what was on screen at the time.",
    );
  }

  const approvedIncrease =
    input.approvedTolerance && input.approvedTolerance.amountIncrease > 0
      ? input.approvedTolerance.amountIncrease
      : 0;
  const commitmentIncrease = commitmentAmountIncrease(input.commitment);
  if (commitmentIncrease > approvedIncrease) {
    throw new Error(
      `The commitment carries ${commitmentIncrease} of slack but only ${approvedIncrease} was ` +
        `approved on the card. An unapproved tolerance is zero; it is never inferred ` +
        `from the conversation and never carried over from a previous task.`,
    );
  }

  const expiresAt = input.expiresAt ?? summary.expiresAt;
  if (Number.isNaN(Date.parse(expiresAt))) {
    throw new Error(`A capability needs a real expiry; got "${expiresAt}".`);
  }
  if (Date.parse(expiresAt) <= now.getTime()) {
    throw new Error(
      `A capability that has already expired authorises nothing; issuing one would only produce a ` +
        `refusal at the payment page (expiry ${expiresAt}).`,
    );
  }

  return {
    capabilityId: options.capabilityId ?? `cap-${randomUUID()}`,
    taskId: summary.taskId,
    commitment: input.commitment,
    commitmentDigest,
    merchantDomain: summary.merchant.domain,
    paymentMethodRef: input.paymentMethodRef,
    maxAmount: {
      value: round2(summary.amount.value + approvedIncrease),
      currency: summary.amount.currency,
    },
    toleranceApproved: approvedIncrease > 0,
    idempotencyKey: capabilityIdempotencyKey({ taskId: summary.taskId, commitmentDigest }),
    expiresAt,
    approvedVia: input.approvedVia,
    ...(input.confirmingMessageId ? { confirmingMessageId: input.confirmingMessageId } : {}),
    auditRef: input.auditRef,
  };
}

/** Marks a capability spent. The returned copy authorises nothing further. */
export function consumePaymentCapability(
  capability: PaymentCapability,
  at: Date = new Date(),
): PaymentCapability {
  return { ...capability, usedAt: at.toISOString() };
}

export interface CheckCapabilityInput {
  capability: PaymentCapability;
  /** The turn asking to pay. A capability from another turn is refused, not repaired. */
  taskId: string;
  /** The plan as read from the page now — `planFromSummary`'s shape. */
  actualPlan: Record<string, unknown>;
  /** The commitment the caller is about to execute, when it is not the capability's own. */
  commitment?: Commitment;
  now?: Date;
}

/**
 * Judges whether a capability authorises the payment about to happen.
 *
 * The order of the checks is part of the contract, and it is the order of the payment checks read from
 * cheapest-and-hardest to most contextual:
 *
 * 1. **Structure and turn.** A malformed capability, or one from another turn, is not evidence of
 *    anything.
 * 2. **Used**, then **expired** — both mean "this one is spent" and neither depends on the page.
 * 3. **Domain.** Before any amount comparison, because a matching price on the wrong domain is the
 *    shape of a redirect hijack, and there is deliberately no re-confirmation path for it.
 * 4. **A rise with no approved slack** — the default row. Reported as
 *    `tolerance_not_approved` rather than as a ceiling breach, because that is what it is: the
 *    exact amount shown was the ceiling, and the answer is to ask again.
 * 5. **The ceiling**, for the case where slack *was* approved. `maxAmount` already has that slack
 *    folded in, so exceeding it is refused without re-examining tolerance — otherwise the same
 *    allowance would be spent twice.
 */
export function checkPaymentCapability(input: CheckCapabilityInput): CapabilityCheck {
  const { capability } = input;
  const now = input.now ?? new Date();

  const structural = structuralComplaint(capability);
  if (structural) return refuse("capability_invalid", structural);

  if (capability.taskId !== input.taskId) {
    return refuse("capability_invalid", [
      `This capability belongs to turn ${capability.taskId} and the payment is being attempted ` +
        `in ${input.taskId}. Consent does not carry across turns; ask again on this one.`,
    ]);
  }

  if (input.commitment && !sameCommitment(input.commitment, capability.commitment)) {
    return refuse("capability_invalid", [
      "The capability authorises a different plan than the one about to be executed. The plan " +
        "that was confirmed is the only one it can pay for.",
    ]);
  }

  if (capability.usedAt) {
    return refuse("capability_used", [
      `This capability was already spent at ${capability.usedAt}. If the outcome of that payment ` +
        `is unknown, ask the merchant what happened — do not pay again.`,
    ]);
  }

  if (Date.parse(capability.expiresAt) <= now.getTime()) {
    return refuse("capability_expired", [
      `The confirmation lapsed at ${capability.expiresAt}. Show the purchase again and let them ` +
        `confirm what is on screen now.`,
    ]);
  }

  const actualDomain = stringField(input.actualPlan, "merchantDomain");
  if (!actualDomain) {
    return refuse("merchant_mismatch", [
      "The page did not say which merchant it belongs to, so there is nothing to compare against " +
        `${capability.merchantDomain}. Refusing rather than assuming it is the right one.`,
    ]);
  }
  if (actualDomain.toLowerCase() !== capability.merchantDomain.toLowerCase()) {
    return refuse("merchant_mismatch", [
      `Confirmed for ${capability.merchantDomain}, but the payment page is ${actualDomain}. ` +
        `This is refused outright: a payment page that has moved domain is the shape of a ` +
        `redirect hijack, and offering to confirm the new one would be offering to walk into it.`,
    ]);
  }

  const currency = stringField(input.actualPlan, "currency");
  if (currency && currency.toUpperCase() !== capability.maxAmount.currency.toUpperCase()) {
    return refuse("capability_invalid", [
      `The page is charging in ${currency} and this capability authorises ` +
        `${capability.maxAmount.currency}. A converted amount is a different purchase; it has to ` +
        `be confirmed as one.`,
    ]);
  }

  const amount = numberField(input.actualPlan, "amount");
  if (amount === null) {
    return refuse("capability_invalid", [
      "The page did not say what it is about to charge. Refusing rather than paying an amount " +
        "nobody could read.",
    ]);
  }

  const confirmed = numberField(capability.commitment.approved, "amount");
  if (!capability.toleranceApproved && confirmed !== null && amount > confirmed + 0.004) {
    return refuse("tolerance_not_approved", [
      `The price moved from ${confirmed} to ${amount} ${capability.maxAmount.currency} and no ` +
        `slack was approved. The exact amount shown is the hard ceiling by default, ` +
        `so this goes back to the person.`,
    ]);
  }

  if (amount > capability.maxAmount.value + 0.004) {
    return refuse("amount_over_max", [
      `The page is charging ${amount} ${capability.maxAmount.currency}, above the ceiling of ` +
        `${capability.maxAmount.value} this confirmation carries. The ceiling is not widened by ` +
        `tolerance; it already includes whatever slack was approved.`,
    ]);
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------

function refuse(reason: CapabilityRefusal, detail: string[]): CapabilityCheck {
  return { ok: false, reason, detail };
}

/** Everything about a capability that can be judged without a page or a clock. */
function structuralComplaint(capability: PaymentCapability): string[] | null {
  const problems: string[] = [];
  if (!capability.capabilityId?.trim()) problems.push("it has no id");
  if (!capability.taskId?.trim()) problems.push("it names no turn");
  if (!capability.commitmentDigest?.trim()) problems.push("it is not bound to a displayed summary");
  if (!capability.merchantDomain?.trim()) problems.push("it names no merchant domain");
  if (!capability.idempotencyKey?.trim()) problems.push("it carries no journal key");
  if (!isOpaqueMethodRef(capability.paymentMethodRef ?? "")) {
    problems.push("its payment method reference is not an opaque handle");
  }
  if (
    typeof capability.maxAmount?.value !== "number" ||
    !Number.isFinite(capability.maxAmount.value) ||
    !capability.maxAmount.currency?.trim()
  ) {
    problems.push("it has no usable ceiling");
  }
  if (capability.approvedVia === "natural_language" && !capability.confirmingMessageId?.trim()) {
    problems.push("it was approved in words but does not say which message approved it");
  }
  if (Number.isNaN(Date.parse(capability.expiresAt ?? ""))) problems.push("it has no real expiry");
  if (problems.length === 0) return null;
  return [`This capability cannot be read as an authorisation: ${problems.join("; ")}.`];
}

/** Canonical JSON — the same rule the journal and the digest use, for the same reason. */
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
 * Whether two commitments authorise the same thing.
 *
 * Compares the plan, the slack and the ceiling — not `approvedAt` or `channel`, which record *when*
 * and *where* consent was given rather than what it was for. A capability reissued for the same
 * purchase seconds later must still match the commitment being executed.
 */
function sameCommitment(a: Commitment, b: Commitment): boolean {
  const shape = (c: Commitment): string =>
    createHash("sha256")
      .update(
        canonicalJson({ approved: c.approved, tolerance: c.tolerance, ceiling: c.ceiling }),
        "utf8",
      )
      .digest("hex");
  return shape(a) === shape(b);
}

function commitmentAmountIncrease(commitment: Commitment): number {
  const tolerance = commitment.tolerance?.["amount"];
  if (tolerance === undefined) return 0;
  if (typeof tolerance === "number") return tolerance;
  return tolerance.increase ?? 0;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Money, to the cent. Keeps `1280 + 50.1` from becoming `1330.0999999999999` on a card. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
