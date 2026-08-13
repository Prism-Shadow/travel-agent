/**
 * Turning a search result set into the three or four options a person can actually decide
 * between — and, for each, the one line that says why it is on the card.
 *
 * This is the product. Browser control is replaceable infrastructure; "make the option space
 * legible" is the part that is hard to copy. Handing someone fifty flights is the same as having
 * done nothing: the work of comparing is exactly the work they delegated.
 *
 * Two ideas do all the lifting.
 *
 * **The Pareto frontier decides what is even eligible.** An option beaten on every axis at once
 * — pricier *and* slower *and* worse timed — has no reason to exist on the card, whatever the
 * user's weights turn out to be. Filtering to the frontier is the one reduction that is safe
 * before knowing preferences, precisely because it discards only options no preference could
 * favour.
 *
 * **The rationale is derived, never written.** Each representative earns its slot by being the
 * unique or extreme holder of some property, and the sentence just states that fact: "唯一直飞",
 * "最便宜，省 400". Rules rather than a model, for one reason — this line is the basis of a
 * purchase decision, so it has to be *true*. A generated sentence can call something the
 * cheapest when it is not, and a plausible false rationale is worse than no rationale, because
 * it is precisely what the person will trust and stop checking.
 *
 * The corollary is the strictest rule in the design: **an option whose reason cannot be derived
 * does not go on the card.** Not a fallback, not "另一个选择" — it is dropped. Being on a
 * four-item card is a claim that this option offers something the others do not, and one that
 * cannot say what it offers is noise wearing the costume of a choice.
 */

/** One search result. `attrs` holds the comparable axes; anything else rides along in `plan`. */
export interface Candidate {
  id: string;
  /** Shown on the card, e.g. `东航 MU5137 14:20→16:35 ¥1280`. */
  label: string;
  /** Numeric axes only — comparison needs an order. Strings belong in `facets`. */
  attrs: Record<string, number>;
  /** Categorical properties used for uniqueness claims, e.g. `{ direct: true }`. */
  facets?: Record<string, string | boolean>;
  /** The structured plan behind the option; becomes `Commitment.approved` when picked. */
  plan: Record<string, unknown>;
}

/** An axis to optimise, and how to name it in a sentence. */
export interface Objective {
  /** Key into {@link Candidate.attrs}. */
  key: string;
  direction: "min" | "max";
  /** Superlative for the extreme, e.g. `"最便宜"`. */
  superlative: string;
  /** Unit for comparative phrasing, e.g. `"元"`; omit for unitless axes. */
  unit?: string;
  /** Differences below this are noise and never justify a slot (e.g. ¥5 on a fare). */
  epsilon?: number;
  /** How to phrase a comparison, given the absolute difference. */
  compare?: (delta: number) => string;
}

/** A uniqueness claim: exactly one candidate having this facet value is a reason by itself. */
export interface FacetClaim {
  key: string;
  value: string | boolean;
  /** e.g. `"唯一直飞"`. */
  soleLabel: string;
}

export interface Representative {
  candidate: Candidate;
  /** The derived line. Never empty — an option without one is dropped, not padded. */
  rationale: string;
  /** Which rule produced it, for tracing and for tests. */
  basis: "sole_facet" | "extreme" | "tradeoff";
}

export interface SelectOptions {
  objectives: Objective[];
  facetClaims?: FacetClaim[];
  /** Hard cap. Beyond four, a phone card stops being scannable. */
  max?: number;
}

function isDominated(a: Candidate, b: Candidate, objectives: Objective[]): boolean {
  let strictlyBetterSomewhere = false;
  for (const objective of objectives) {
    const av = a.attrs[objective.key];
    const bv = b.attrs[objective.key];
    if (av === undefined || bv === undefined) return false;
    const better = objective.direction === "min" ? bv < av : bv > av;
    const worse = objective.direction === "min" ? bv > av : bv < av;
    if (worse) return false;
    if (better) strictlyBetterSomewhere = true;
  }
  return strictlyBetterSomewhere;
}

/**
 * Candidates not beaten on every axis at once.
 *
 * The only reduction that is safe before preferences are known: a dominated option is worse
 * whatever weights the person turns out to hold, so dropping it cannot remove their answer.
 */
export function paretoFrontier(candidates: Candidate[], objectives: Objective[]): Candidate[] {
  return candidates.filter(
    (candidate) =>
      !candidates.some((other) => other !== candidate && isDominated(candidate, other, objectives)),
  );
}

function extremeOf(candidates: Candidate[], objective: Objective): Candidate | undefined {
  let best: Candidate | undefined;
  for (const candidate of candidates) {
    const value = candidate.attrs[objective.key];
    if (value === undefined) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    const bestValue = best.attrs[objective.key]!;
    if (objective.direction === "min" ? value < bestValue : value > bestValue) best = candidate;
  }
  return best;
}

/** True when exactly one candidate carries the claimed facet value. */
function soleHolder(candidates: Candidate[], claim: FacetClaim): Candidate | undefined {
  const holders = candidates.filter((candidate) => candidate.facets?.[claim.key] === claim.value);
  return holders.length === 1 ? holders[0] : undefined;
}

function formatDelta(objective: Objective, delta: number): string {
  if (objective.compare) return objective.compare(delta);
  const rounded = Math.round(Math.abs(delta));
  return objective.unit ? `${rounded} ${objective.unit}` : String(rounded);
}

/**
 * Picks the representatives and derives each one's line.
 *
 * Order of reasons, strongest first:
 *
 * 1. **Sole holder of a facet** — "唯一直飞". The most decisive thing that can be said, because
 *    it is categorical: no amount of money buys it elsewhere in this set.
 * 2. **Extreme on an objective** — "最便宜", "最快".
 * 3. **A trade-off against the anchor** — "晚 40 分钟，省 320". Earns a slot only when it is
 *    genuinely better on one axis and the cost on another is worth stating.
 *
 * Anything left over is dropped rather than shown with a vague label.
 */
export function selectRepresentatives(
  candidates: Candidate[],
  options: SelectOptions,
): Representative[] {
  const { objectives, facetClaims = [], max = 4 } = options;
  if (candidates.length === 0 || objectives.length === 0) return [];

  const frontier = paretoFrontier(candidates, objectives);
  const chosen = new Map<string, Representative>();

  // 1. Categorical uniqueness, judged against the *whole* set: "唯一直飞" is a claim about
  //    everything the user could have had, not about what survived the frontier filter.
  for (const claim of facetClaims) {
    const holder = soleHolder(candidates, claim);
    if (holder && !chosen.has(holder.id)) {
      chosen.set(holder.id, { candidate: holder, rationale: claim.soleLabel, basis: "sole_facet" });
    }
  }

  // 2. The extreme on each objective.
  for (const objective of objectives) {
    if (chosen.size >= max) break;
    const extreme = extremeOf(frontier, objective);
    if (!extreme || chosen.has(extreme.id)) continue;
    const others = frontier.filter((candidate) => candidate !== extreme);
    const runnerUp = extremeOf(others, objective);
    let rationale = objective.superlative;
    if (runnerUp) {
      const delta = Math.abs(extreme.attrs[objective.key]! - runnerUp.attrs[objective.key]!);
      // A superlative that wins by a rounding error is technically true and practically
      // misleading, so the margin only gets stated when it is worth acting on.
      if (delta >= (objective.epsilon ?? 0)) {
        rationale = `${objective.superlative}，比次优${formatDelta(objective, delta)}`;
      }
    }
    chosen.set(extreme.id, { candidate: extreme, rationale, basis: "extreme" });
  }

  // 3. Trade-offs against the anchor — the first chosen, which is what the card leads with.
  const anchor = [...chosen.values()][0]?.candidate;
  if (anchor) {
    for (const candidate of frontier) {
      if (chosen.size >= max) break;
      if (chosen.has(candidate.id)) continue;
      const gains: string[] = [];
      const costs: string[] = [];
      for (const objective of objectives) {
        const mine = candidate.attrs[objective.key];
        const theirs = anchor.attrs[objective.key];
        if (mine === undefined || theirs === undefined) continue;
        const delta = mine - theirs;
        if (Math.abs(delta) < (objective.epsilon ?? 0)) continue;
        const better = objective.direction === "min" ? delta < 0 : delta > 0;
        (better ? gains : costs).push(`${better ? "省" : "多"}${formatDelta(objective, delta)}`);
      }
      // Needs a real gain to justify a slot; a pure downgrade is never worth a line.
      if (gains.length === 0) continue;
      const rationale =
        costs.length > 0 ? `${costs.join("、")}，但${gains.join("、")}` : gains.join("、");
      chosen.set(candidate.id, { candidate, rationale, basis: "tradeoff" });
    }
  }

  return [...chosen.values()].slice(0, max);
}
