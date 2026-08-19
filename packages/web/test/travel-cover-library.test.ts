import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  selectTravelCovers,
  TRAVEL_COVER_CATALOG,
  type TravelCoverSubject,
} from "../src/lib/travel-cover-library";

describe("travel cover catalog", () => {
  it("contains 48 unique optimized assets with generation metadata", () => {
    expect(TRAVEL_COVER_CATALOG).toHaveLength(48);
    expect(new Set(TRAVEL_COVER_CATALOG.map((asset) => asset.id)).size).toBe(48);
    expect(new Set(TRAVEL_COVER_CATALOG.map((asset) => asset.src)).size).toBe(48);
    expect(
      TRAVEL_COVER_CATALOG.every(
        (asset) =>
          asset.src === `/travel-covers/${asset.id}.jpg` &&
          asset.source === "generated" &&
          asset.promptVersion === 1,
      ),
    ).toBe(true);
  });

  it("has every catalog image in the public asset directory", () => {
    for (const asset of TRAVEL_COVER_CATALOG) {
      const file = fileURLToPath(new URL(`../public${asset.src}`, import.meta.url));
      expect(existsSync(file), `${asset.id} is missing`).toBe(true);
    }
  });
});

describe("selectTravelCovers", () => {
  it.each([
    ["Five-Day Tokyo Trip Plan", "tokyo-night"],
    ["上海到大阪的往返航班", "flight-window"],
    ["京都秋季红叶行程", "kyoto-temple"],
    ["Family holiday with two children", "family-trip"],
    ["Plan a northern lights escape", "northern-lights"],
  ])("matches %s to %s", (title, expected) => {
    expect(selectTravelCovers([{ sessionId: "session-1", title }])[0]?.id).toBe(expected);
  });

  it("uses only neutral generic covers when no intent can be inferred", () => {
    const selected = selectTravelCovers([
      { sessionId: "a", title: "Greeting Exchange" },
      { sessionId: "b", title: "Assistance Intro" },
      { sessionId: "c", title: null },
    ]);
    expect(selected.every((asset) => asset.kind === "generic")).toBe(true);
  });

  it("avoids adjacent duplicates when alternatives exist", () => {
    const subjects: TravelCoverSubject[] = [
      { sessionId: "same", title: "hello" },
      { sessionId: "same", title: "hello" },
      { sessionId: "same", title: "hello" },
    ];
    const selected = selectTravelCovers(subjects);
    expect(new Set(selected.map((asset) => asset.id)).size).toBe(3);
  });

  it("excludes covers reserved by another visible rail", () => {
    const selected = selectTravelCovers(
      [{ sessionId: "kyoto-session", title: "Kyoto Autumn Foliage Itinerary" }],
      TRAVEL_COVER_CATALOG,
      { excludedIds: new Set(["kyoto-temple"]) },
    );

    expect(selected[0]?.id).toBe("autumn-forest");
  });

  it("is stable for the same Session and title", () => {
    const subject = [{ sessionId: "stable-session", title: "Weekend plan" }];
    expect(selectTravelCovers(subject)[0]?.id).toBe(selectTravelCovers(subject)[0]?.id);
  });
});
