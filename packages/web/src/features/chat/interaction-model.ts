/**
 * What a card shows, and when its buttons mean anything.
 *
 * Kept apart from the component because these are rules rather than markup, and the rules are the
 * part that must not drift: a payment card whose confirm button is live before the person has seen
 * the cancellation terms, or a tolerance that gets sent when nobody chose it, are product defects
 * that a screenshot review will not catch.
 *
 * The card is also the last place a value could leak into the UI, so the shaping is done here where
 * it can be asserted: a `secret_entry` card never renders an input this application would read
 * (this phase asks the person to type the code into the site's own field), and a payment method is
 * shown as an alias, a brand and four digits — never as anything that could charge a card.
 */
import type {
  ApprovedTolerance,
  InteractionOutcome,
  PaymentSummary,
  UserInteraction,
} from "@travel-agent/transaction";

export type { UserInteraction, InteractionOutcome };

/** The buttons a card offers, in the order they are read. */
export type CardAction =
  | { kind: "submit"; label: string; tone: "primary" }
  | { kind: "approve"; label: string; tone: "primary" }
  | { kind: "decline"; label: string; tone: "quiet" }
  | { kind: "choose"; optionId: string; label: string; rationale: string };

export interface CardCopy {
  /** Short tag naming the kind, e.g. "需要确认". */
  tag: string;
  /** The imperative ask, verbatim from the agent. */
  ask: string;
  /** Context line, or empty. */
  summary: string;
  /** Extra lines specific to the kind (a purchase's seven fields, a takeover's reason). */
  detail: string[];
  actions: CardAction[];
}

const TAGS: Record<UserInteraction["kind"], string> = {
  info_request: "需要你回答",
  selection: "需要你选择",
  commitment_confirmation: "需要你确认付款",
  secret_entry: "需要你输入验证码",
  human_challenge: "需要你在页面上操作",
  browser_takeover: "需要你接管浏览器",
};

/**
 * The purchase, as lines a person reads top to bottom. Never a token, never a card number.
 *
 * All seven fields, and the last two are not bookkeeping. The expiry is what makes
 * "confirm" a decision with a shelf life — a person who leaves the card open for an hour and comes
 * back should be able to see that it lapsed, rather than press a button that quietly refuses. The
 * task is what ties this consent to one turn: the same summary confirmed in a later turn is a
 * different purchase, and showing which turn it belongs to is what lets somebody reading the
 * conversation afterwards tell the two apart.
 */
export function paymentLines(payment: PaymentSummary): string[] {
  const method = [payment.paymentMethod.alias, payment.paymentMethod.brand]
    .filter(Boolean)
    .join(" · ");
  const last4 = payment.paymentMethod.last4 ? ` ••${payment.paymentMethod.last4}` : "";
  return [
    `商家：${payment.merchant.name}（${payment.merchant.domain}）`,
    `内容：${payment.item}`,
    `金额：${formatAmount(payment.amount.value, payment.amount.currency)}`,
    `退改：${payment.cancellation.summary}`,
    `支付方式：${method}${last4}`,
    `确认有效期至：${formatExpiry(payment.expiresAt)}`,
    `所属任务：${payment.taskId}`,
  ];
}

/**
 * An expiry as a wall clock, in the reader's own timezone.
 *
 * Local getters rather than `toISOString`: the person is deciding whether they still have time, and
 * a `Z` timestamp asks them to do arithmetic to find out. A value that does not parse is shown
 * verbatim rather than as "Invalid Date" or as nothing at all — a payment card with a blank line
 * where its expiry should be is worse than an ugly one, because blank reads as "no expiry".
 */
export function formatExpiry(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/** Amount with its currency, never one without the other. */
export function formatAmount(value: number, currency: string): string {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${rounded} ${currency.toUpperCase()}`;
}

/**
 * Everything the card renders.
 *
 * The `browser_takeover` reason is a `detail` line rather than a subtitle because it is the one
 * thing a person cannot work out from the page in front of them, and it should read as an
 * explanation rather than as a heading.
 */
export function cardCopy(interaction: UserInteraction): CardCopy {
  const base = {
    tag: TAGS[interaction.kind],
    ask: interaction.ask,
    summary: interaction.summary,
  };
  switch (interaction.kind) {
    case "selection":
      return {
        ...base,
        detail: [],
        actions: interaction.options.map((option) => ({
          kind: "choose" as const,
          optionId: option.id,
          label: option.label,
          rationale: option.rationale,
        })),
      };
    case "commitment_confirmation":
      return {
        ...base,
        detail: paymentLines(interaction.payment),
        actions: [
          { kind: "approve", label: "确认支付这一笔", tone: "primary" },
          { kind: "decline", label: "先不付", tone: "quiet" },
        ],
      };
    case "secret_entry":
      return {
        ...base,
        // No input box: in this phase the application never types a one-time code, so a field here
        // would promise something it does not do (004 Phase 3, `secret_entry.live` off).
        detail: [
          `需要的是：${secretFieldLabel(interaction.field)}`,
          `用途：${interaction.purpose}`,
        ],
        actions: [
          { kind: "submit", label: "我已在页面上输入", tone: "primary" },
          { kind: "decline", label: "换一种方式", tone: "quiet" },
        ],
      };
    case "browser_takeover":
      return {
        ...base,
        detail: [`交给你的原因：${interaction.reason}`],
        actions: [
          { kind: "submit", label: "我处理好了", tone: "primary" },
          { kind: "decline", label: "取消这一步", tone: "quiet" },
        ],
      };
    case "human_challenge":
      return {
        ...base,
        detail: [],
        actions: [
          { kind: "submit", label: "我处理好了", tone: "primary" },
          { kind: "decline", label: "取消这一步", tone: "quiet" },
        ],
      };
    default:
      return {
        ...base,
        detail: [],
        actions:
          interaction.answerShape === "decision"
            ? [
                { kind: "approve", label: "可以，继续", tone: "primary" },
                { kind: "decline", label: "不要", tone: "quiet" },
              ]
            : [{ kind: "submit", label: "回复", tone: "primary" }],
      };
  }
}

function secretFieldLabel(field: string): string {
  switch (field) {
    case "cvv":
      return "卡背面的安全码（CVV）";
    case "otp":
      return "短信 / 邮件验证码";
    case "three_d_secure":
      return "银行的 3DS 动态口令";
    case "card_number":
      return "卡号";
    case "payment_password":
      return "支付密码";
    default:
      return "生物识别 / passkey";
  }
}

/**
 * Whether this application will ever type the requested secret. It will not, in this phase.
 *
 * Two of the six fields are never filled under any flag, and the rest wait on the scoped
 * secret phase, which is Phase 4. The card says so plainly rather than implying a capability that
 * is switched off — a person told "type it here" who then finds nothing happens has been misled
 * about who is doing what.
 */
export function secretEntryIsGuidanceOnly(interaction: UserInteraction): boolean {
  return interaction.kind === "secret_entry" && interaction.live !== true;
}

/** The outcome a card action produces. */
export function outcomeFor(input: {
  action: CardAction;
  /** Free text the person typed, if the card had a box. */
  text?: string;
  /** Whether they ticked the offered slack. Only meaningful on a payment card that offered one. */
  toleranceAccepted?: boolean;
  offeredTolerance?: ApprovedTolerance;
}): InteractionOutcome {
  const message = input.text?.trim() ? input.text.trim() : undefined;
  switch (input.action.kind) {
    case "choose":
      return {
        status: "answered",
        optionId: input.action.optionId,
        ...(message ? { message } : {}),
      };
    case "approve":
      return {
        status: "answered",
        approved: true,
        // Sent only when the card offered slack *and* the person accepted it. An unapproved
        // tolerance is zero, and there is no path here that invents one.
        ...(input.toleranceAccepted && input.offeredTolerance
          ? { toleranceApproved: input.offeredTolerance }
          : {}),
        ...(message ? { message } : {}),
      };
    case "decline":
      return { status: "declined", ...(message ? { message } : {}) };
    default:
      return {
        status: "answered",
        ...(message ? { value: message, message } : {}),
      };
  }
}

/** Whether the primary action can be pressed yet. */
export function canSubmit(interaction: UserInteraction, text: string): boolean {
  // A free-text question needs an answer; everything else is a button whose meaning does not
  // depend on what was typed.
  if (interaction.kind === "info_request" && interaction.answerShape !== "decision") {
    return text.trim().length > 0;
  }
  return true;
}
