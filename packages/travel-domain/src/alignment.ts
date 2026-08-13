/**
 * Recognising the same product across several sites.
 *
 * Cross-platform comparison is worthless until offers are aligned: "¥780 here, ¥820 there" only
 * means something once both are known to be the same thing. Alignment is what makes the
 * comparison exist.
 *
 * **What this module does and does not decide.** An earlier version of this file answered "are
 * these the same hotel?" itself, with a hand-written grammar of Chinese hotel names — noise-word
 * lists, branch-suffix rules, a claim that a name reads `[place][brand][type]`. That was the
 * wrong place to put the answer. It held for one language and one product category, it broke on
 * `Hilton` versus `Hilton Garden Inn` until it was patched, and it would have broken again on the
 * next pair. Worse, judging whether two listings are the same thing is exactly what a model does
 * well and a token heuristic does badly.
 *
 * So the judgement is injected. This module supplies only what is mechanical:
 *
 * - **Exact identity** where a real identifier exists. A flight designator plus a date is the
 *   same flight everywhere; nothing is gained by being clever about it.
 * - **A locale-neutral prefilter**, so an adjudicator is not asked about every pair. Character
 *   trigrams over the raw string — no word lists, no language assumptions. It only ever decides
 *   *not to ask*, and it errs toward asking.
 * - **Grouping and the safety rules**, which are the part that must not be delegated (below).
 *
 * **The asymmetry that governs everything here.** Failing to merge two listings of one product
 * shows a duplicate — untidy, and the user notices. Merging two *different* products quotes a
 * price that does not belong to the thing being booked, and the user does not notice, because the
 * card looks identical. One error is visible and cheap; the other is invisible and expensive. So
 * `unsure` never merges: it is reported, for someone or something with more context to settle.
 */

/** One platform's listing of something bookable. */
export interface Offer {
  /** Which site it came from. */
  platform: string;
  /** Platform-local id, kept so the agent can navigate back to this exact listing. */
  id: string;
  name: string;
  price: number;
  /** Anything else worth carrying to the card, and worth showing an adjudicator. */
  extra?: Record<string, unknown>;
}

/** One real-world product, with every platform's price for it. */
export interface AlignedOffer {
  /** Longest name among the merged offers — usually the most complete. */
  name: string;
  offers: Offer[];
  cheapest: Offer;
  /** Spread between cheapest and dearest; 0 when only one platform has it. */
  saving: number;
}

/** Two offers a prefilter thought related but no one confidently merged. */
export interface AmbiguousPair {
  a: Offer;
  b: Offer;
  /** Prefilter score, 0–1. Diagnostic only — never a merge decision. */
  affinity: number;
  reason: string;
}

export interface AlignmentResult {
  aligned: AlignedOffer[];
  /** For an adjudicator with more context, never for a lower threshold. */
  ambiguous: AmbiguousPair[];
}

/** What an adjudicator can say. `unsure` is a first-class answer, not a failure to decide. */
export type SameThingVerdict = "same" | "different" | "unsure";

/**
 * How to tell whether two offers are the same product.
 *
 * `key` when the domain has a real identifier — a flight designator, an ISBN, a SKU. `adjudicated`
 * otherwise, which is every case where the only handle is a name.
 */
export type Identity =
  | {
      kind: "key";
      /** Stable identifier, or undefined when this offer has none (it will not merge). */
      keyOf: (offer: Offer) => string | undefined;
    }
  | {
      kind: "adjudicated";
      /** Asked only for pairs the prefilter did not rule out. */
      sameThing: (a: Offer, b: Offer) => Promise<SameThingVerdict> | SameThingVerdict;
      /**
       * Below this affinity, pairs are ruled out without asking. Lower it to ask more; the cost
       * is calls, and the risk of raising it is silently missing a match.
       */
      askAbove?: number;
    };

/** Default floor for asking. Deliberately low — asking is cheap, missing a match is not. */
const DEFAULT_ASK_ABOVE = 0.25;

/** Case-folded, full-width folded, punctuation and spacing collapsed. No word lists. */
function fold(value: string): string {
  return value
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function trigrams(value: string): Set<string> {
  const folded = fold(value);
  if (folded.length <= 3) return new Set([folded]);
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= folded.length; i += 1) grams.add(folded.slice(i, i + 3));
  return grams;
}

/**
 * Character-trigram containment of two names, 0–1.
 *
 * Language-neutral on purpose: it knows nothing about hotels, brands, or any script's word order.
 * It exists to skip obviously unrelated pairs, not to decide anything — which is why the result
 * is called *affinity* rather than similarity, and why it is never compared against a merge
 * threshold.
 *
 * Containment, not Jaccard. Jaccard divides by the union, which penalises a length difference —
 * and platforms differ in name length constantly, one listing a place fully and another briefly.
 * On `上海外滩茂悦大酒店` against `外滩茂悦酒店` Jaccard scores 0.22, below any reasonable floor,
 * so a legitimate candidate would be dropped without ever being looked at. A prefilter that
 * silently rules out real matches is worse than one that asks too often: the cost of asking is a
 * call, the cost of not asking is a missed comparison nobody will ever notice.
 */
export function affinity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function summarise(offers: Offer[]): AlignedOffer {
  const sorted = [...offers].sort((a, b) => a.price - b.price);
  const name = [...offers].sort((a, b) => b.name.length - a.name.length)[0]!.name;
  return {
    name,
    offers: sorted,
    cheapest: sorted[0]!,
    saving: sorted[sorted.length - 1]!.price - sorted[0]!.price,
  };
}

const UNSURE_REASON =
  "Listings look related but nothing confirmed they are the same product. Compare something " +
  "beyond the name — an address, a rating, a photo, a room description — before treating them " +
  "as one. Merging two different products quotes a price for something the user is not booking.";

/**
 * Groups offers into real-world products.
 *
 * Two offers from the **same platform are never merged**, whatever the identity says. A platform
 * listing something twice means two different rooms, fare classes or cancellation policies — not
 * a duplicate — and collapsing them hides a real choice. This rule is not delegated because no
 * adjudicator can see it: from the outside the two listings look identical.
 */
export async function alignOffers(offers: Offer[], identity: Identity): Promise<AlignmentResult> {
  const groups: Offer[][] = [];
  const ambiguous: AmbiguousPair[] = [];
  const askAbove = identity.kind === "adjudicated" ? (identity.askAbove ?? DEFAULT_ASK_ABOVE) : 0;

  for (const offer of offers) {
    let target: Offer[] | undefined;

    for (const group of groups) {
      // The one rule that overrides identity entirely.
      if (group.some((member) => member.platform === offer.platform)) continue;
      const representative = group[0]!;

      if (identity.kind === "key") {
        const key = identity.keyOf(offer);
        if (key !== undefined && key === identity.keyOf(representative)) {
          target = group;
          break;
        }
        continue;
      }

      const score = affinity(representative.name, offer.name);
      if (score < askAbove) continue;

      const verdict = await identity.sameThing(representative, offer);
      if (verdict === "same") {
        target = group;
        break;
      }
      if (verdict === "unsure") {
        ambiguous.push({
          a: representative,
          b: offer,
          affinity: Number(score.toFixed(3)),
          reason: UNSURE_REASON,
        });
      }
    }

    if (target) target.push(offer);
    else groups.push([offer]);
  }

  return { aligned: groups.map(summarise), ambiguous };
}

/**
 * Identity for anything with a real identifier — the flight case, and any other domain that has
 * one. Offers without an id never merge, which is the safe direction.
 */
export function identityByKey(keyOf: (offer: Offer) => string | undefined): Identity {
  return { kind: "key", keyOf };
}

/** Identity delegated to a judge, with the prefilter floor left at its default unless given. */
export function identityByJudgement(
  sameThing: (a: Offer, b: Offer) => Promise<SameThingVerdict> | SameThingVerdict,
  askAbove?: number,
): Identity {
  return { kind: "adjudicated", sameThing, askAbove };
}
