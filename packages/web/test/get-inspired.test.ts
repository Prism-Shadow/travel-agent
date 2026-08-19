import { describe, expect, it } from "vitest";
import { INSPIRATION_CARDS } from "../src/features/chat/jump-back-in";
import { selectTravelCovers, TRAVEL_COVER_CATALOG } from "../src/lib/travel-cover-library";

describe("welcome Get inspired catalog", () => {
  it("keeps three distinct editorial prompts", () => {
    expect(INSPIRATION_CARDS).toHaveLength(3);
    expect(new Set(INSPIRATION_CARDS.map((card) => card.id)).size).toBe(INSPIRATION_CARDS.length);
  });

  it("uses real covers from the generated travel library", () => {
    const coverIds = new Set(TRAVEL_COVER_CATALOG.map((cover) => cover.id));
    for (const card of INSPIRATION_CARDS) expect(coverIds.has(card.coverId)).toBe(true);
  });

  it("reserves its covers so recent Sessions use different images", () => {
    const inspiredCoverIds = new Set<string>(INSPIRATION_CARDS.map((card) => card.coverId));
    const recentCovers = selectTravelCovers(
      [
        { sessionId: "kyoto", title: "Kyoto Autumn Foliage Itinerary" },
        { sessionId: "bangkok", title: "Bangkok food market guide" },
        { sessionId: "aurora", title: "Northern lights escape" },
      ],
      TRAVEL_COVER_CATALOG,
      { excludedIds: inspiredCoverIds },
    );

    expect(recentCovers.every((cover) => !inspiredCoverIds.has(cover.id))).toBe(true);
  });
});
