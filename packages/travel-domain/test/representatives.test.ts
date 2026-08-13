/**
 * Representative-selection tests.
 *
 * The fixtures are the worked example from the design doc's card mock, because the thing being
 * tested is not "does the maths run" but "would a person holding a phone be able to decide".
 */
import { describe, expect, it } from "vitest";
import {
  paretoFrontier,
  selectRepresentatives,
  type Candidate,
  type FacetClaim,
  type Objective,
} from "../src/index.js";

const OBJECTIVES: Objective[] = [
  { key: "price", direction: "min", superlative: "最便宜", unit: "元", epsilon: 20 },
  { key: "durationMin", direction: "min", superlative: "最快", unit: "分钟", epsilon: 15 },
];

const DIRECT_CLAIM: FacetClaim[] = [{ key: "direct", value: true, soleLabel: "唯一直飞" }];

function flight(
  id: string,
  price: number,
  durationMin: number,
  facets: Record<string, string | boolean> = {},
): Candidate {
  return {
    id,
    label: `${id} ¥${price}`,
    attrs: { price, durationMin },
    facets,
    plan: { id, price },
  };
}

describe("paretoFrontier", () => {
  it("drops an option beaten on every axis at once", () => {
    const good = flight("good", 800, 120);
    const dominated = flight("dominated", 900, 150);
    expect(paretoFrontier([good, dominated], OBJECTIVES).map((c) => c.id)).toEqual(["good"]);
  });

  it("keeps both when each wins somewhere", () => {
    const cheap = flight("cheap", 800, 200);
    const fast = flight("fast", 1200, 100);
    expect(paretoFrontier([cheap, fast], OBJECTIVES)).toHaveLength(2);
  });

  it("keeps ties — neither strictly beats the other", () => {
    expect(paretoFrontier([flight("a", 800, 120), flight("b", 800, 120)], OBJECTIVES)).toHaveLength(
      2,
    );
  });
});

describe("selectRepresentatives", () => {
  it("leads with a categorical advantage over any superlative", () => {
    const reps = selectRepresentatives(
      [
        flight("MU5137", 1280, 135, { direct: true }),
        flight("9C8916", 880, 145),
        flight("CA1858", 1150, 145),
      ],
      { objectives: OBJECTIVES, facetClaims: DIRECT_CLAIM },
    );
    expect(reps[0]!.candidate.id).toBe("MU5137");
    expect(reps[0]!.rationale).toBe("唯一直飞");
    expect(reps[0]!.basis).toBe("sole_facet");
  });

  it("does not claim uniqueness when two options share the facet", () => {
    const reps = selectRepresentatives(
      [flight("a", 1280, 135, { direct: true }), flight("b", 880, 140, { direct: true })],
      { objectives: OBJECTIVES, facetClaims: DIRECT_CLAIM },
    );
    expect(reps.every((rep) => rep.rationale !== "唯一直飞")).toBe(true);
  });

  it("uniqueness is judged against the whole set, not the frontier", () => {
    // The only direct flight is also dominated — but "唯一直飞" is a claim about what the user
    // could have had, so it still earns its slot.
    const reps = selectRepresentatives(
      [flight("direct-but-bad", 1600, 200, { direct: true }), flight("cheap-fast", 800, 120)],
      { objectives: OBJECTIVES, facetClaims: DIRECT_CLAIM },
    );
    expect(reps.map((rep) => rep.candidate.id)).toContain("direct-but-bad");
  });

  it("states the margin behind a superlative", () => {
    const reps = selectRepresentatives([flight("cheap", 880, 145), flight("mid", 1280, 120)], {
      objectives: OBJECTIVES,
    });
    const cheapest = reps.find((rep) => rep.candidate.id === "cheap")!;
    expect(cheapest.rationale).toContain("最便宜");
    expect(cheapest.rationale).toContain("400");
  });

  // A superlative won by a rounding error is true and useless.
  it("omits a margin below the noise threshold", () => {
    const reps = selectRepresentatives([flight("a", 880, 145), flight("b", 885, 120)], {
      objectives: OBJECTIVES,
    });
    expect(reps.find((rep) => rep.candidate.id === "a")!.rationale).toBe("最便宜");
  });

  it("phrases a trade-off as cost-then-gain", () => {
    // A middle option — neither cheapest nor fastest, but on the frontier — is exactly the case
    // the trade-off rule exists for.
    const reps = selectRepresentatives(
      [
        flight("MU5137", 1280, 120, { direct: true }),
        flight("9C8916", 880, 160),
        flight("CA1858", 1050, 140),
      ],
      { objectives: OBJECTIVES, facetClaims: DIRECT_CLAIM },
    );
    const tradeoff = reps.find((rep) => rep.basis === "tradeoff");
    expect(tradeoff?.candidate.id).toBe("CA1858");
    expect(tradeoff!.rationale).toMatch(/但省/);
    expect(tradeoff!.rationale).toContain("230");
  });

  // The design doc's illustrative card listed a third flight that is in fact dominated (same
  // duration as the cheap one, higher price). The mock was hand-written; the algorithm correctly
  // refuses to show it. Pinned so the looser example never creeps back in as an expectation.
  it("refuses to show a dominated option even when a mock-up listed one", () => {
    const reps = selectRepresentatives(
      [
        flight("MU5137", 1280, 135, { direct: true }),
        flight("9C8916", 880, 145),
        flight("CA1858", 1150, 145),
      ],
      { objectives: OBJECTIVES, facetClaims: DIRECT_CLAIM },
    );
    expect(reps.map((rep) => rep.candidate.id)).not.toContain("CA1858");
  });

  // The strictest rule in the design: no reason, no slot.
  it("drops an option whose reason cannot be derived rather than padding it", () => {
    const reps = selectRepresentatives(
      [flight("best", 800, 100), flight("worse", 900, 150), flight("worst", 1000, 200)],
      { objectives: OBJECTIVES },
    );
    expect(reps).toHaveLength(1);
    expect(reps[0]!.candidate.id).toBe("best");
    expect(reps.every((rep) => rep.rationale.trim().length > 0)).toBe(true);
  });

  it("never exceeds the card's capacity", () => {
    const many = Array.from({ length: 40 }, (_, i) => flight(`f${i}`, 700 + i * 13, 200 - i * 3));
    expect(
      selectRepresentatives(many, { objectives: OBJECTIVES, max: 4 }).length,
    ).toBeLessThanOrEqual(4);
  });

  it("every representative carries a non-empty rationale, always", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      flight(`f${i}`, 700 + ((i * 37) % 500), 100 + ((i * 53) % 120), { direct: i === 7 }),
    );
    const reps = selectRepresentatives(many, {
      objectives: OBJECTIVES,
      facetClaims: DIRECT_CLAIM,
    });
    expect(reps.length).toBeGreaterThan(0);
    for (const rep of reps) expect(rep.rationale.trim()).not.toBe("");
  });

  it("returns nothing for an empty result set instead of inventing options", () => {
    expect(selectRepresentatives([], { objectives: OBJECTIVES })).toEqual([]);
  });

  it("a single candidate is its own representative", () => {
    const reps = selectRepresentatives([flight("only", 900, 130)], { objectives: OBJECTIVES });
    expect(reps).toHaveLength(1);
    expect(reps[0]!.rationale).toBe("最便宜");
  });
});
