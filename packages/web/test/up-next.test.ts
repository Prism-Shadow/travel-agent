/** The Up next ordering and its countdown are deterministic data rules; pin them as such. */
import { describe, expect, it } from "vitest";
import type { TripSummary } from "@prismshadow/penguin-server/api";
import { daysUntil, pickUpNextTrips } from "../src/lib/trip-order";

const TODAY = "2026-09-21";

function trip(overrides: Partial<TripSummary>): TripSummary {
  return {
    tripId: "t-x",
    projectId: "p",
    name: "Trip",
    notes: "",
    destination: "",
    when: null,
    who: null,
    budget: null,
    budgetAmount: null,
    budgetCurrency: null,
    dir: "/tmp/t",
    dirExists: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("pickUpNextTrips", () => {
  it("orders future departures soonest-first, counting today as future", () => {
    const later = trip({
      tripId: "later",
      when: { kind: "dates", start: "2026-10-03", end: "2026-10-08" },
    });
    const sooner = trip({
      tripId: "sooner",
      when: { kind: "dates", start: TODAY, end: "2026-09-25" },
    });
    expect(pickUpNextTrips([later, sooner], TODAY).map((t) => t.tripId)).toEqual([
      "sooner",
      "later",
    ]);
  });

  it("fills remaining slots with departed and undated trips by latest touch", () => {
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
    const upcoming = trip({
      tripId: "upcoming",
      when: { kind: "dates", start: "2026-10-03", end: "2026-10-08" },
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    // The future departure leads even though it was touched least recently; the departed trip
    // outranks the flexible one on recency — it is still the one the person touched last.
    expect(pickUpNextTrips([flexible, departed, upcoming], TODAY).map((t) => t.tripId)).toEqual([
      "upcoming",
      "departed",
      "flexible",
    ]);
  });

  it("caps the rail at three trips", () => {
    const trips = ["a", "b", "c", "d"].map((id, i) =>
      trip({
        tripId: id,
        when: { kind: "dates", start: `2026-10-0${i + 1}`, end: `2026-10-0${i + 2}` },
      }),
    );
    expect(pickUpNextTrips(trips, TODAY).map((t) => t.tripId)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list only when there are no trips at all", () => {
    expect(pickUpNextTrips([], TODAY)).toEqual([]);
  });
});

describe("daysUntil", () => {
  it("counts whole local days, 0 for today, across month ends", () => {
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil("2026-10-03", TODAY)).toBe(12);
    expect(daysUntil("2026-10-01", "2026-09-30")).toBe(1);
  });
});
