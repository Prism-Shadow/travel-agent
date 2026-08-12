/**
 * Cross-platform alignment tests.
 *
 * Written from the asymmetry that governs the module: failing to merge shows a duplicate, which
 * the user notices; merging two different hotels quotes a price for something they are not
 * booking, which they do not. The cases below check that it errs the visible way.
 */
import { describe, expect, it } from "vitest";
import { alignOffers, nameSimilarity, nameTokens, type Offer } from "../src/index.js";

function hotel(platform: string, name: string, price: number): Offer {
  return { platform, id: `${platform}-${name}`, name, price };
}
function flight(platform: string, flightNumber: string, price: number, date = "2026-08-20"): Offer {
  return { platform, id: `${platform}-${flightNumber}`, name: flightNumber, flightNumber, price, date };
}

describe("nameTokens", () => {
  it("drops words every hotel has, so they cannot create similarity", () => {
    expect(nameTokens("Hotel Resort")).toEqual([]);
  });

  it("emits CJK bigrams — neither name contains the other as a substring", () => {
    expect(nameTokens("外滩茂悦")).toContain("茂悦");
  });

  it("folds full-width characters and case", () => {
    expect(nameTokens("ＡＢＣ Hotel")).toEqual(["abc"]);
  });
});

describe("nameSimilarity", () => {
  it("scores the same hotel written two ways as highly similar", () => {
    expect(nameSimilarity("上海外滩茂悦大酒店", "外滩茂悦酒店")).toBeGreaterThan(0.82);
  });

  it("scores two different hotels in the same district as dissimilar", () => {
    expect(nameSimilarity("上海外滩茂悦大酒店", "上海外滩华尔道夫酒店")).toBeLessThan(0.82);
  });

  it("is not fooled by the shared generic word alone", () => {
    expect(nameSimilarity("如家酒店", "汉庭酒店")).toBeLessThan(0.55);
  });

  it("tolerates a platform appending a branch", () => {
    expect(nameSimilarity("桔子水晶酒店", "桔子水晶酒店 外滩店")).toBeGreaterThan(0.82);
  });
});

describe("alignOffers — flights", () => {
  it("merges the same flight number and date across platforms", () => {
    const result = alignOffers([
      flight("ctrip", "MU5137", 1280),
      flight("fliggy", "MU5137", 1180),
      flight("airline", "mu 5137", 1150),
    ]);
    expect(result.aligned).toHaveLength(1);
    expect(result.aligned[0]!.cheapest.platform).toBe("airline");
    expect(result.aligned[0]!.saving).toBe(130);
  });

  it("keeps the same flight number on different dates apart", () => {
    const result = alignOffers([
      flight("ctrip", "MU5137", 1280, "2026-08-20"),
      flight("fliggy", "MU5137", 900, "2026-08-21"),
    ]);
    expect(result.aligned).toHaveLength(2);
  });

  it("never merges two flights from the same platform", () => {
    const result = alignOffers([flight("ctrip", "MU5137", 1280), flight("ctrip", "MU5137", 1450)]);
    expect(result.aligned).toHaveLength(2);
  });
});

describe("alignOffers — hotels", () => {
  it("merges one hotel written differently, and reports the saving", () => {
    const result = alignOffers([
      hotel("ctrip", "上海外滩茂悦大酒店", 820),
      hotel("fliggy", "外滩茂悦酒店", 780),
    ]);
    expect(result.aligned).toHaveLength(1);
    expect(result.aligned[0]!.cheapest.platform).toBe("fliggy");
    expect(result.aligned[0]!.saving).toBe(40);
    // The fullest name is the useful one to show.
    expect(result.aligned[0]!.name).toBe("上海外滩茂悦大酒店");
  });

  // The expensive mistake. Two different hotels must never share a price.
  it("keeps two different hotels apart rather than guessing", () => {
    const result = alignOffers([
      hotel("ctrip", "上海外滩茂悦大酒店", 820),
      hotel("fliggy", "上海外滩华尔道夫酒店", 2400),
    ]);
    expect(result.aligned).toHaveLength(2);
  });

  // The visible mistake, taken deliberately: unsure means separate *and reported*.
  it("reports a near-match as ambiguous instead of merging it", () => {
    const result = alignOffers([
      hotel("ctrip", "北京王府井希尔顿酒店", 900),
      hotel("fliggy", "北京王府井希尔顿花园酒店", 640),
    ]);
    expect(result.aligned).toHaveLength(2);
    expect(result.ambiguous.length).toBeGreaterThan(0);
    expect(result.ambiguous[0]!.reason).toMatch(/address|star|photo/i);
  });

  it("never merges two rooms listed by the same platform", () => {
    const result = alignOffers([
      hotel("ctrip", "上海外滩茂悦大酒店", 780),
      hotel("ctrip", "上海外滩茂悦大酒店", 1180),
    ]);
    expect(result.aligned).toHaveLength(2);
  });

  it("a single-platform offer aligns to itself with no saving", () => {
    const result = alignOffers([hotel("ctrip", "如切酒店", 400)]);
    expect(result.aligned).toHaveLength(1);
    expect(result.aligned[0]!.saving).toBe(0);
  });

  it("orders each product's offers cheapest first", () => {
    const result = alignOffers([
      hotel("ctrip", "上海外滩茂悦大酒店", 900),
      hotel("fliggy", "外滩茂悦酒店", 700),
      hotel("meituan", "上海外滩茂悦", 800),
    ]);
    expect(result.aligned[0]!.offers.map((offer) => offer.price)).toEqual([700, 800, 900]);
  });

  it("returns nothing for no input", () => {
    expect(alignOffers([])).toEqual({ aligned: [], ambiguous: [] });
  });
});
