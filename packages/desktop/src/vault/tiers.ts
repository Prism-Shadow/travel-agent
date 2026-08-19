/**
 * Which personal fields may be shown to a model, which may only be typed into a form, and which
 * are never written down at all.
 *
 * The three tiers are not degrees of secrecy — they are three different *paths*:
 *
 * | Tier | Where the value may go | How the model sees it |
 * | --- | --- | --- |
 * | **L1** | into the model's context, under a grant | as itself, or as a mask where one is declared |
 * | **L2** | into a form field, filled by the main process | only as a handle `pv:<grantId>:<field>` |
 * | **L3** | nowhere — never stored, never filled from storage | not at all |
 *
 * Two boundaries are not adjustable, and both are enforced here rather than remembered:
 *
 * 1. **L3 is always L3.** There is no override, no flag, and no settings entry that can move a CVV
 *    or a payment password into storage. PCI SSC FAQ 1574 forbids storing a card verification code
 *    even with the cardholder's consent, and a passkey or payment password must never be filled by
 *    this application at all.
 * 2. **Loosening is explicit; tightening is free.** Moving a field from L2 to L1 hands it to a
 *    model, so it requires a confirmed decision and leaves an audit entry. Moving L1 to L2 only
 *    narrows what may happen to it, so it needs neither.
 *
 * The default table below is a *design inference*, not measured practice (the design asks for a real
 * pass over a booking form). It is written as data so that correcting it is a one-line change with
 * a test, rather than an archaeology exercise across call sites.
 */

export type SensitivityTier = "L1" | "L2" | "L3";

/** A field the vault knows by name, with its default tier and how it is shown when masked. */
export interface FieldSpec {
  field: string;
  tier: SensitivityTier;
  /** Human label for the settings page and the grant card. Never a value. */
  label: string;
  /**
   * How the model sees an L2 field it is allowed to know *about* — `138****5678` for a phone.
   * L1 fields with a mask are projected masked unless the grant asks for the full value.
   */
  mask?: (value: string) => string;
}

/** Keeps the last `keep` characters and covers the rest, preserving length-ish shape. */
function tail(keep: number): (value: string) => string {
  return (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length <= keep) return "*".repeat(trimmed.length);
    const head = trimmed.slice(0, Math.max(0, Math.min(3, trimmed.length - keep)));
    const shown = trimmed.slice(-keep);
    return `${head}${"*".repeat(Math.max(1, trimmed.length - head.length - keep))}${shown}`;
  };
}

/** Masks an address to what a model legitimately needs: everything but the door number. */
function maskStreet(value: string): string {
  return value.replace(/\d+/g, (digits) => "*".repeat(digits.length));
}

/** Masks an email to `a***@example.com`. */
function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return "*".repeat(value.length);
  const name = value.slice(0, at);
  const domain = value.slice(at);
  return `${name[0]}${"*".repeat(Math.max(1, name.length - 1))}${domain}`;
}

const SPECS: FieldSpec[] = [
  // ---- L1 · projectable ------------------------------------------------------------------
  { field: "family_name", tier: "L1", label: "姓" },
  { field: "given_name", tier: "L1", label: "名" },
  { field: "family_name_pinyin", tier: "L1", label: "姓（拼音）" },
  { field: "given_name_pinyin", tier: "L1", label: "名（拼音）" },
  { field: "title", tier: "L1", label: "称谓" },
  { field: "gender", tier: "L1", label: "性别" },
  { field: "seat_preference", tier: "L1", label: "座位偏好" },
  { field: "room_preference", tier: "L1", label: "房型偏好" },
  { field: "breakfast_preference", tier: "L1", label: "早餐偏好" },
  { field: "floor_preference", tier: "L1", label: "楼层偏好" },
  { field: "loyalty_tier", tier: "L1", label: "常旅客等级" },
  { field: "emergency_contact_name", tier: "L1", label: "紧急联系人姓名" },
  // The model needs to know *which* document to select; the number itself is L2.
  { field: "id_document_type", tier: "L1", label: "证件类型" },
  { field: "city", tier: "L1", label: "城市" },
  { field: "district", tier: "L1", label: "区县" },
  // Projected masked by default: a booking form needs it, a model rarely needs to read it.
  { field: "contact_email", tier: "L1", label: "联系邮箱", mask: maskEmail },

  // ---- L2 · fill-only --------------------------------------------------------------------
  { field: "id_number", tier: "L2", label: "身份证号", mask: tail(4) },
  { field: "passport_number", tier: "L2", label: "护照号", mask: tail(4) },
  { field: "travel_permit_number", tier: "L2", label: "通行证号", mask: tail(4) },
  { field: "id_expiry", tier: "L2", label: "证件有效期" },
  { field: "id_issue_place", tier: "L2", label: "签发地" },
  { field: "birth_date", tier: "L2", label: "出生日期" },
  { field: "phone_number", tier: "L2", label: "手机号", mask: tail(4) },
  { field: "street_address", tier: "L2", label: "详细地址", mask: maskStreet },
  { field: "loyalty_number", tier: "L2", label: "常旅客卡号", mask: tail(4) },
  { field: "membership_number", tier: "L2", label: "会员号", mask: tail(4) },
  // A merchant token may itself be able to charge the card. It is an encrypted L2 field
  // that only the main process ever resolves — never a "safe public identifier".
  { field: "payment_token", tier: "L2", label: "商户支付凭证", mask: () => "••••" },

  // ---- L3 · never persisted --------------------------------------------------------------
  { field: "cvv", tier: "L3", label: "卡背面安全码" },
  { field: "otp", tier: "L3", label: "一次性验证码" },
  { field: "three_d_secure", tier: "L3", label: "3DS 动态口令" },
  { field: "account_password", tier: "L3", label: "账户密码" },
  { field: "payment_password", tier: "L3", label: "支付密码" },
  { field: "passkey", tier: "L3", label: "passkey / 生物识别" },
];

const BY_FIELD = new Map(SPECS.map((spec) => [spec.field, spec]));

/** Fields this application must never fill, whatever any flag says. */
const NEVER_FILLED = new Set(["payment_password", "passkey"]);

export function knownFields(): FieldSpec[] {
  return SPECS.map((spec) => ({ ...spec }));
}

export function specFor(field: string): FieldSpec | undefined {
  const spec = BY_FIELD.get(field);
  return spec ? { ...spec } : undefined;
}

/**
 * The tier a field is stored at, taking the user's overrides into account.
 *
 * An unknown field is **L2**, not L1: a name this table has never heard of is more likely to be a
 * new identifier than a new preference, and the failure directions are not symmetric — an L2 field
 * mistakenly treated as L1 is handed to a model.
 */
export function tierOf(
  field: string,
  overrides: Readonly<Record<string, SensitivityTier>> = {},
): SensitivityTier {
  const spec = BY_FIELD.get(field);
  if (spec?.tier === "L3") return "L3";
  const override = overrides[field];
  if (override === "L3") return spec?.tier ?? "L2";
  if (override) return override;
  return spec?.tier ?? "L2";
}

export function isNeverPersisted(field: string): boolean {
  return tierOf(field) === "L3";
}

export function isNeverFilled(field: string): boolean {
  return NEVER_FILLED.has(field);
}

/** What a projection shows for a value at this tier: the value, a mask, or nothing at all. */
export function projectValue(input: {
  field: string;
  value: string;
  tier: SensitivityTier;
  /** Set only when the grant asked for the full value of a masked L1 field, and got it approved. */
  full?: boolean;
}): string | null {
  if (input.tier !== "L1") return null;
  const spec = BY_FIELD.get(input.field);
  if (spec?.mask && !input.full) return spec.mask(input.value);
  return input.value;
}

/** The masked form a model may see of an L2 field it holds a handle for (`138****5678`). */
export function maskFor(field: string, value: string): string {
  const spec = BY_FIELD.get(field);
  return spec?.mask ? spec.mask(value) : "••••";
}

export type TierChange =
  | { allowed: true; requiresConfirmation: boolean; from: SensitivityTier; to: SensitivityTier }
  | { allowed: false; reason: string };

/**
 * Judges a reclassification request.
 *
 * Loosening — L2 to L1 — is allowed but never silent: it is the step that lets a model read an
 * identifier, so the caller must carry a confirmation and write an audit entry. Tightening is
 * allowed outright. Anything involving L3 in either direction is refused: the list is hard-coded
 * and the settings page offers no entry into or out of it.
 */
export function judgeTierChange(input: {
  field: string;
  to: SensitivityTier;
  overrides?: Readonly<Record<string, SensitivityTier>>;
}): TierChange {
  const spec = BY_FIELD.get(input.field);
  const from = tierOf(input.field, input.overrides ?? {});

  if (spec?.tier === "L3" || from === "L3") {
    return {
      allowed: false,
      reason:
        `"${input.field}" is never stored, under any setting: a card code, a one-time password ` +
        `or a payment secret is entered by the person each time (PCI SSC FAQ 1574).`,
    };
  }
  if (input.to === "L3") {
    return {
      allowed: false,
      reason:
        "L3 is a fixed list, not a level a field can be promoted to. To stop storing a field, " +
        "delete it — that is what 'never persisted' means in practice.",
    };
  }
  if (from === input.to) {
    return { allowed: true, requiresConfirmation: false, from, to: input.to };
  }
  // L2 → L1 hands the value to a model; L1 → L2 only narrows what may happen to it.
  return {
    allowed: true,
    requiresConfirmation: from === "L2" && input.to === "L1",
    from,
    to: input.to,
  };
}
