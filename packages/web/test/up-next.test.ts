/** The Up next pick and its countdown are deterministic data rules; pin them as such. */
import { describe, expect, it } from "vitest";
import type { TripSummary } from "@prismshadow/penguin-server/api";
import { daysUntil, pickUpNextTrip } from "../src/features/chat/jump-back-in";

const TODAY = "2026-09-21";

function trip(overrides: Partial<TripSummary>): TripSummary {
  return {
    tripId: "t-x",
    projectId: "p",
    name: "Trip",
    destination: "",
    when: null,
    who: null,
    budget: null,
    dir: "/tmp/t",
    dirExists: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("pickUpNextTrip", () => {
  it("prefers the soonest future departure, counting today as future", () => {
    const later = trip({
      tripId: "later",
      when: { kind: "dates", start: "2026-10-03", end: "2026-10-08" },
    });
    const sooner = trip({
      tripId: "sooner",
      when: { kind: "dates", start: TODAY, end: "2026-09-25" },
    });
    expect(pickUpNextTrip([later, sooner], TODAY)?.tripId).toBe("sooner");
  });

  it("ignores departed trips and falls back to the latest-touched one", () => {
    const departed = trip({
      tripId: "departed",
      when: { kind: "dates", start: "2026-09-01", end: "2026-09-05" },
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    const flexible = trip({
      tripId: "flexible",
      when: { kind: "flexible", days: 5, months: ["2026-11"] },
      updatedAt: "2026-09-18T00:00:00.000Z",
    });
    // No future-dated trip: recency decides, and the departed trip may win on recency —
    // it is still the one the person touched last.
    expect(pickUpNextTrip([flexible, departed], TODAY)?.tripId).toBe("departed");
  });

  it("returns null only when there are no trips at all", () => {
    expect(pickUpNextTrip([], TODAY)).toBeNull();
  });
});

describe("daysUntil", () => {
  it("counts whole local days, 0 for today, across month ends", () => {
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil("2026-10-03", TODAY)).toBe(12);
    expect(daysUntil("2026-10-01", "2026-09-30")).toBe(1);
  });
});
