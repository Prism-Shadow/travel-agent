/**
 * The three product rates design/003 §13 asks to be watched (004 Phase 5's observability item).
 *
 * They are not performance counters — they are *design* signals, each one a way the agent-first
 * intent could be failing quietly:
 *
 * - **takeover rate** — how often the agent falls back to handing the person the whole browser
 *   (`browser_takeover`). 003 §13-8: a high rate means the six interaction kinds are not covering
 *   what really happens, and the fix is upstream, not another takeover.
 * - **secret-phase rate** — how often a flow reaches a scoped secret phase (`secret_entry`). Useful
 *   against the payment volume: rising means more flows are hitting real one-time-code steps.
 * - **card-fallback rate** — how often a natural-language "yes" was *not* accepted and the payment
 *   card was shown instead (003 §8.4). The judge errs toward the card on purpose; this says whether
 *   "on purpose" has become "annoyingly often" and the language matcher needs real-corpus tuning.
 *
 * A rate with a tiny denominator lies, so each is reported with its raw counts and a `rate` that is
 * `null` until the denominator crosses a floor — a caller shows "—", not "100%", after one event.
 * In-memory and per-process: these are a live gauge for the settings/admin surface, not a durable
 * analytics store (that is the remote sink 003 §5.3 leaves to later). Pure and dependency-free so
 * the arithmetic is unit-tested.
 */

/** Below this many denominator events, a rate is reported as `null` rather than a misleading number. */
export const MIN_RATE_SAMPLE = 5;

export interface RateView {
  numerator: number;
  denominator: number;
  /** numerator/denominator, or null until the denominator reaches {@link MIN_RATE_SAMPLE}. */
  rate: number | null;
}

export interface ObservabilitySnapshot {
  /** Every interaction raised, by kind — the denominator behind the rates. */
  interactions: Record<string, number>;
  takeover: RateView;
  secretPhase: RateView;
  cardFallback: RateView;
  /** When the counters were last touched, for a UI that wants to show freshness. */
  updatedAt: string | null;
}

/** The interaction kinds this recorder counts. Mirrors the transaction layer's `InteractionKind`. */
const KINDS = [
  "info_request",
  "selection",
  "commitment_confirmation",
  "secret_entry",
  "human_challenge",
  "browser_takeover",
] as const;
type Kind = (typeof KINDS)[number];

function rateView(numerator: number, denominator: number): RateView {
  return {
    numerator,
    denominator,
    rate: denominator >= MIN_RATE_SAMPLE ? numerator / denominator : null,
  };
}

export class ObservabilityMetrics {
  private readonly byKind = new Map<Kind, number>();
  /** Confirmation judgements: total asked vs the ones that fell back to the card. */
  private confirmationsJudged = 0;
  private confirmationsFellBack = 0;
  private updatedAt: string | null = null;
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** One interaction was raised. Unknown kinds are ignored rather than counted as anything. */
  recordInteraction(kind: string): void {
    if (!KINDS.includes(kind as Kind)) return;
    this.byKind.set(kind as Kind, (this.byKind.get(kind as Kind) ?? 0) + 1);
    this.touch();
  }

  /**
   * A natural-language confirmation was judged (003 §8.4).
   *
   * `fellBack` is true when the reply was not accepted and the card was shown. Both the total and
   * the fallback move, because the rate is fallbacks over *attempts*, not over cards shown.
   */
  recordConfirmationJudged(fellBack: boolean): void {
    this.confirmationsJudged += 1;
    if (fellBack) this.confirmationsFellBack += 1;
    this.touch();
  }

  private touch(): void {
    this.updatedAt = this.now().toISOString();
  }

  private total(): number {
    let sum = 0;
    for (const count of this.byKind.values()) sum += count;
    return sum;
  }

  snapshot(): ObservabilitySnapshot {
    const total = this.total();
    const interactions: Record<string, number> = {};
    for (const kind of KINDS) interactions[kind] = this.byKind.get(kind) ?? 0;
    return {
      interactions,
      takeover: rateView(interactions["browser_takeover"] ?? 0, total),
      secretPhase: rateView(interactions["secret_entry"] ?? 0, total),
      cardFallback: rateView(this.confirmationsFellBack, this.confirmationsJudged),
      updatedAt: this.updatedAt,
    };
  }
}
