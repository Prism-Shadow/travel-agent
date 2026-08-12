/**
 * Escalation over a Feishu interactive card.
 *
 * Split deliberately in two: {@link buildEscalationCard} decides *what the person sees* and is
 * pure and fully tested; this file only moves bytes — post the card, wait for the tap. The
 * transport is the part that cannot be verified without live credentials, so it is kept as thin
 * as it can be, with no decisions inside it.
 *
 * Delivery is a webhook POST; the answer comes back through Feishu's card callback, which the
 * host application receives and forwards by calling {@link FeishuCardChannel.resolve}. This
 * package deliberately does not run an HTTP server: where the callback lands is the embedding
 * app's business, and a transaction library that opened a port would be doing someone else's job.
 *
 * > **Not verified against the live API.** The card schema and webhook shape follow Feishu's
 * > documented contract, but nothing here has been exercised against a real tenant. Treat the
 * > first live run as the verification step.
 */
import { buildEscalationCard, type CardActionValue } from "./card.js";
import type {
  Escalation,
  EscalationChannel,
  EscalationOutcome,
  TimeoutPolicy,
} from "../escalation.js";

export interface FeishuCardChannelOptions {
  /** Incoming-webhook URL of the target chat. */
  webhookUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Maps a card tap to the outcome the waiting task consumes. */
export function outcomeFromAction(action: CardActionValue, message?: string): EscalationOutcome {
  switch (action.intent) {
    case "choose":
      return { status: "answered", optionId: action.optionId, approved: true, message };
    case "approve":
      return { status: "answered", approved: true, message };
    case "refuse":
      return { status: "answered", approved: false, message };
    case "reject_all":
      // Explicitly an answer, not a refusal: the person engaged and asked to keep looking.
      return { status: "answered", approved: false, message: message ?? "都不合适，换个条件" };
    default:
      return { status: "answered", approved: true, message };
  }
}

export class FeishuCardChannel implements EscalationChannel {
  readonly name = "feishu-card";
  private readonly webhookUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pending = new Map<
    string,
    { resolve: (outcome: EscalationOutcome) => void; policy: TimeoutPolicy }
  >();

  constructor(options: FeishuCardChannelOptions) {
    this.webhookUrl = options.webhookUrl;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Called by the host app when Feishu delivers a card callback. Unknown ids are ignored rather
   * than thrown: a tap on a card whose task already timed out is expected, not exceptional.
   */
  resolve(action: CardActionValue, message?: string): boolean {
    const waiter = this.pending.get(action.escalationId);
    if (!waiter) return false;
    this.pending.delete(action.escalationId);
    waiter.resolve(outcomeFromAction(action, message));
    return true;
  }

  async send(escalation: Escalation, signal?: AbortSignal): Promise<EscalationOutcome> {
    if (signal?.aborted) return { status: "aborted" };

    const response = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildEscalationCard(escalation)),
    });
    if (!response.ok) {
      throw new Error(
        `Feishu webhook rejected the card: ${response.status} ${response.statusText}`,
      );
    }

    // Re-checked after the post: an abort raised while the card was in flight would otherwise be
    // missed entirely — the listener below is registered too late to hear it — and the task would
    // sit out the full timeout for a run that had already been cancelled.
    if (signal?.aborted) return { status: "aborted" };

    return new Promise<EscalationOutcome>((resolve) => {
      const settle = (outcome: EscalationOutcome) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(escalation.id);
        resolve(outcome);
      };
      const onAbort = () => settle({ status: "aborted" });
      // Resolves rather than rejects: a lapsed escalation is a state the task has to handle
      // (suspend and resume), not an exception to unwind through.
      const timer = setTimeout(
        () => settle({ status: "timeout", policy: escalation.onTimeout }),
        escalation.timeoutMs,
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(escalation.id, { resolve: settle, policy: escalation.onTimeout });
    });
  }
}
