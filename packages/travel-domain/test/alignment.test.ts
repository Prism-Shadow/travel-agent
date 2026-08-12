/**
 * Alignment tests.
 *
 * The module deliberately does *not* decide whether two listings are the same product — an
 * earlier version did, with a hand-written grammar of Chinese hotel names, and it was wrong in
 * kind: it held for one language and one product category. So most of these tests are about the
 * mechanics around the judgement — that the judge is asked about the right pairs, that its
 * answers are honoured, and that the rules it cannot see are enforced regardless of what it says.
 */
import { describe, expect, it, vi } from "vitest";
import {
  affinity,
  alignOffers,
  identityByJudgement,
  identityByKey,
  type Offer,
  type SameThingVerdict,
} from "../src/index.js";

function offer(platform: string, name: string, price: number, extra?: Record<string, unknown>): Offer {
  return { platform, id: `${platform}-${name}-${price}`, name, price, extra };
}

/** A judge that answers from a lookup, so tests state the judgement rather than compute it. */
function judgeFrom(verdicts: Record<string, SameThingVerdict>, calls: string[] = []) {
  return identityByJudgement((a, b) => {
    const key = [a.name, b.name].sort().join("|");
    calls.push(key);
    return verdicts[key] ?? "different";
  });
}

describe("affinity", () => {
  it("is high for near-identical strings and low for unrelated ones", () => {
    expect(affinity("Grand Hyatt Shanghai", "Grand Hyatt Shanghai Bund")).toBeGreaterThan(0.5);
    expect(affinity("Grand Hyatt Shanghai", "Waldorf Astoria Beijing")).toBeLessThan(0.2);
    // Containment, so a short listing of the same place still scores high against a long one.
    expect(affinity("Grand Hyatt Shanghai Bund", "Grand Hyatt Shanghai")).toBeGreaterThan(0.8);
  });

  it("knows nothing about any language — it is character trigrams", () => {
    // Works the same on scripts with and without word separators.
    expect(affinity("上海外滩茂悦大酒店", "外滩茂悦酒店")).toBeGreaterThan(0.3);
    expect(affinity("東京ホテル", "東京ホテル")).toBe(1);
  });

  it("folds case, full-width forms and punctuation", () => {
    expect(affinity("ＡＢＣ Hotel", "abc-hotel")).toBe(1);
  });

  it("is symmetric and bounded", () => {
    expect(affinity("a b c", "c b a")).toBe(affinity("c b a", "a b c"));
    expect(affinity("", "anything")).toBe(0);
  });
});

describe("alignOffers — exact-key identity", () => {
  const byFlight = identityByKey((o) => (o.extra?.flight ? `${o.extra.flight}@${o.extra.date}` : undefined));
  const flight = (platform: string, code: string, price: number, date = "2026-08-20") =>
    offer(platform, code, price, { flight: code, date });

  it("merges the same identifier across platforms and reports the saving", async () => {
    const result = await alignOffers(
      [flight("a", "MU5137", 1280), flight("b", "MU5137", 1150), flight("c", "MU5137", 1180)],
      byFlight,
    );
    expect(result.aligned).toHaveLength(1);
    expect(result.aligned[0]!.cheapest.platform).toBe("b");
    expect(result.aligned[0]!.saving).toBe(130);
  });

  it("keeps the same identifier on different dates apart", async () => {
    const result = await alignOffers(
      [flight("a", "MU5137", 1280, "2026-08-20"), flight("b", "MU5137", 900, "2026-08-21")],
      byFlight,
    );
    expect(result.aligned).toHaveLength(2);
  });

  it("never merges offers that have no identifier", async () => {
    const result = await alignOffers([offer("a", "X", 100), offer("b", "X", 90)], byFlight);
    expect(result.aligned).toHaveLength(2);
  });
});

describe("alignOffers — delegated judgement", () => {
  it("merges what the judge calls the same", async () => {
    const result = await alignOffers(
      [offer("a", "Grand Hyatt Shanghai", 820), offer("b", "Grand Hyatt Shanghai Bund", 780)],
      judgeFrom({ "Grand Hyatt Shanghai|Grand Hyatt Shanghai Bund": "same" }),
    );
    expect(result.aligned).toHaveLength(1);
    expect(result.aligned[0]!.cheapest.platform).toBe("b");
    // The fullest name is the useful one to show.
    expect(result.aligned[0]!.name).toBe("Grand Hyatt Shanghai Bund");
  });

  it("keeps apart what the judge calls different, however alike the names look", async () => {
    const result = await alignOffers(
      [offer("a", "Hilton Beijing", 900), offer("b", "Hilton Garden Inn Beijing", 640)],
      judgeFrom({ "Hilton Beijing|Hilton Garden Inn Beijing": "different" }),
    );
    expect(result.aligned).toHaveLength(2);
    expect(result.ambiguous).toHaveLength(0);
  });

  // `unsure` is a real answer, and it must never become a merge.
  it("reports an unsure verdict instead of merging on it", async () => {
    const result = await alignOffers(
      [offer("a", "Hilton Beijing", 900), offer("b", "Hilton Garden Inn Beijing", 640)],
      judgeFrom({ "Hilton Beijing|Hilton Garden Inn Beijing": "unsure" }),
    );
    expect(result.aligned).toHaveLength(2);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]!.reason).toMatch(/address|rating|photo|room/i);
  });

  it("does not ask about pairs the prefilter rules out", async () => {
    const calls: string[] = [];
    await alignOffers(
      [offer("a", "Grand Hyatt Shanghai", 820), offer("b", "Ryokan Kanazawa", 400)],
      judgeFrom({}, calls),
    );
    expect(calls).toEqual([]);
  });

  it("does ask about pairs that share enough characters to be worth a look", async () => {
    const calls: string[] = [];
    await alignOffers(
      [offer("a", "Grand Hyatt Shanghai", 820), offer("b", "Grand Hyatt Shanghai Bund", 780)],
      judgeFrom({}, calls),
    );
    expect(calls).toHaveLength(1);
  });

  it("a lower floor asks about more pairs", async () => {
    const seen: string[] = [];
    await alignOffers(
      [offer("a", "Alpha Lodge", 100), offer("b", "Beta House", 90)],
      identityByJudgement((x, y) => {
        seen.push(`${x.name}|${y.name}`);
        return "different";
      }, 0),
    );
    expect(seen).toHaveLength(1);
  });

  it("accepts a synchronous judge as well as an async one", async () => {
    const result = await alignOffers(
      [offer("a", "Same Place", 100), offer("b", "Same Place", 90)],
      identityByJudgement(async () => "same"),
    );
    expect(result.aligned).toHaveLength(1);
  });
});

describe("alignOffers — rules the judge cannot see", () => {
  // Two listings on one platform are two products, not a duplicate: different rooms, fare
  // classes or cancellation policies. From the outside they look identical, so no adjudicator
  // could know — which is why this is enforced here and never delegated.
  it("never merges two offers from the same platform, whatever the judge says", async () => {
    const alwaysSame = identityByJudgement(() => "same");
    const result = await alignOffers(
      [offer("a", "Same Hotel", 780), offer("a", "Same Hotel", 1180)],
      alwaysSame,
    );
    expect(result.aligned).toHaveLength(2);
  });

  it("still merges across platforms when the judge says same", async () => {
    const result = await alignOffers(
      [offer("a", "Same Hotel", 780), offer("b", "Same Hotel", 700), offer("a", "Same Hotel", 1180)],
      identityByJudgement(() => "same"),
    );
    // The two `a` listings stay apart; `b` joins the first of them.
    expect(result.aligned).toHaveLength(2);
    expect(result.aligned[0]!.offers.map((o) => o.platform).sort()).toEqual(["a", "b"]);
  });
});

describe("alignOffers — shape", () => {
  it("orders each product's offers cheapest first", async () => {
    const result = await alignOffers(
      [offer("a", "P", 900), offer("b", "P", 700), offer("c", "P", 800)],
      identityByJudgement(() => "same"),
    );
    expect(result.aligned[0]!.offers.map((o) => o.price)).toEqual([700, 800, 900]);
  });

  it("a single-platform offer aligns to itself with no saving", async () => {
    const result = await alignOffers([offer("a", "Only", 400)], identityByJudgement(() => "same"));
    expect(result.aligned).toHaveLength(1);
    expect(result.aligned[0]!.saving).toBe(0);
  });

  it("returns nothing for no input, without consulting the judge", async () => {
    const judge = vi.fn(() => "same" as SameThingVerdict);
    expect(await alignOffers([], identityByJudgement(judge))).toEqual({
      aligned: [],
      ambiguous: [],
    });
    expect(judge).not.toHaveBeenCalled();
  });
});
