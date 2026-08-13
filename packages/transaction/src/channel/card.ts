/**
 * Turns an escalation into an interactive card payload.
 *
 * Why a card and not text or a link. The human is on a phone, deciding between three or four
 * plans — which is a two-dimensional task (options × attributes). Prose linearises the table and
 * makes the comparison hard; an image compares well but cannot be replied to; a link to a web
 * app is fully interactive but demands opening a browser and possibly signing in, at the exact
 * moment friction matters most. A card compares like a table and answers like a button.
 *
 * One tap then does three things at once, which is the point of this shape:
 *
 * 1. **Chooses** a plan.
 * 2. **Authorises** it — the tap is what produces the `Commitment`.
 * 3. **Declares presence** — the person is holding their phone and paying attention right now.
 *    That third one is free, and it is better evidence than any presence detection: it is an act
 *    that required attention, not an inference from an app being in the foreground.
 *
 * The card's size limit is also a constraint on everything upstream: three or four options, each
 * with a one-line reason it is there. An option whose reason cannot be written is an option the
 * person cannot judge at a glance, and it should not be on the card at all.
 */
import type { Escalation } from "../escalation.js";

/** Feishu's interactive-card envelope. Kept loose — the schema is Feishu's, not ours. */
export interface CardPayload {
  msg_type: "interactive";
  card: Record<string, unknown>;
}

/** Values the callback carries back, so the receiver knows which escalation was answered. */
export interface CardActionValue {
  escalationId: string;
  /** Present for a choice; absent for a plain approve/refuse. */
  optionId?: string;
  /** `approve` / `refuse` for an authority gap, `choose` for a knowledge gap, `done` otherwise. */
  intent: "choose" | "approve" | "refuse" | "done" | "reject_all";
}

function markdown(content: string): Record<string, unknown> {
  return { tag: "div", text: { tag: "lark_md", content } };
}

function button(
  text: string,
  value: CardActionValue,
  type: "primary" | "default" | "danger" = "default",
): Record<string, unknown> {
  return { tag: "button", text: { tag: "plain_text", content: text }, type, value };
}

const HEADER_TEMPLATE: Record<Escalation["kind"], string> = {
  capability_gap: "orange",
  authority_gap: "red",
  knowledge_gap: "blue",
};

const HEADER_TITLE: Record<Escalation["kind"], string> = {
  capability_gap: "需要你操作一步",
  authority_gap: "需要你确认",
  knowledge_gap: "选一个方案",
};

/**
 * Builds the card.
 *
 * The `ask` leads, before any context: a notification that opens with an explanation and buries
 * the action is one people put off. Options render as one block each — label, then the reason it
 * is on the card — because that reason line is what the person actually decides from.
 */
export function buildEscalationCard(escalation: Escalation): CardPayload {
  const elements: Record<string, unknown>[] = [markdown(`**${escalation.ask}**`)];

  if (escalation.context.summary) {
    elements.push(markdown(escalation.context.summary));
  }

  const options = escalation.context.options ?? [];
  if (options.length > 0) {
    elements.push({ tag: "hr" });
    for (const [index, option] of options.entries()) {
      elements.push(markdown(`**${index + 1}. ${option.label}**\n${option.rationale}`));
    }
    elements.push({
      tag: "action",
      actions: options.map((option, index) =>
        button(
          `订 ${index + 1}`,
          { escalationId: escalation.id, optionId: option.id, intent: "choose" },
          index === 0 ? "primary" : "default",
        ),
      ),
    });
    // Not a failure path: "none of these" is how a knowledge gap keeps exploring, carrying the
    // person's reason back into the search rather than ending the task.
    elements.push({
      tag: "action",
      actions: [
        button("都不合适，换个条件", { escalationId: escalation.id, intent: "reject_all" }),
      ],
    });
  } else if (escalation.kind === "authority_gap") {
    elements.push({
      tag: "action",
      actions: [
        button("同意", { escalationId: escalation.id, intent: "approve" }, "primary"),
        button("不同意", { escalationId: escalation.id, intent: "refuse" }, "danger"),
      ],
    });
  } else {
    elements.push({
      tag: "action",
      actions: [button("我处理好了", { escalationId: escalation.id, intent: "done" }, "primary")],
    });
  }

  elements.push({
    tag: "note",
    elements: [
      {
        tag: "plain_text",
        content: `${Math.round(escalation.timeoutMs / 60000)} 分钟内未回复将${
          escalation.onTimeout === "abort" ? "终止任务" : "保存进度并挂起，等你回来继续"
        }`,
      },
    ],
  });

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: HEADER_TEMPLATE[escalation.kind],
        title: { tag: "plain_text", content: HEADER_TITLE[escalation.kind] },
      },
      elements,
    },
  };
}
