/**
 * Trip grouping for the sidebar (pure logic), and the identity line a trip card shows.
 *
 * The two behaviours worth pinning are the ones that would each look like a bug to the person
 * using the app: a trip created seconds ago but holding no conversation yet must still appear
 * (otherwise the click that made it seems to have done nothing), and a conversation belonging
 * to no trip must land somewhere visible rather than vanishing from the sidebar.
 */
import { describe, expect, it } from "vitest";
import type { TripSummary } from "@prismshadow/penguin-server/api";
import { SCRATCH_GROUP_KEY, groupSessionsByTrip } from "../src/lib/session-grouping";
import { tripMetaLine, travellerCount, whenText } from "../src/lib/trip-format";
import type { TripMetaCopy } from "../src/lib/trip-format";

const row = (tripId: string | null, createdAt: string) => ({ tripId, createdAt });

describe("groupSessionsByTrip", () => {
  it("keeps the trip order it is given, and sorts each trip's conversations newest first", () => {
    const groups = groupSessionsByTrip(
      [
        row("t-a", "2026-08-01T00:00:00.000Z"),
        row("t-b", "2026-08-05T00:00:00.000Z"),
        row("t-a", "2026-08-03T00:00:00.000Z"),
      ],
      ["t-b", "t-a"],
    );
    expect(groups.map((g) => g.key)).toEqual(["t-b", "t-a"]);
    expect(groups[1]!.sessions.map((s) => s.createdAt)).toEqual([
      "2026-08-03T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    ]);
  });

  it("shows a trip that has no conversations yet", () => {
    // The moment after "new trip": the journey exists, its first message does not.
    const groups = groupSessionsByTrip([], ["t-empty"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("t-empty");
    expect(groups[0]!.sessions).toEqual([]);
  });

  it("collects conversations belonging to no trip into a trailing scratch group", () => {
    const groups = groupSessionsByTrip(
      [row(null, "2026-08-02T00:00:00.000Z"), row("t-a", "2026-08-01T00:00:00.000Z")],
      ["t-a"],
    );
    expect(groups.map((g) => g.key)).toEqual(["t-a", SCRATCH_GROUP_KEY]);
    expect(groups[1]!.tripId).toBeNull();
  });

  it("omits the scratch group entirely when every conversation has a trip", () => {
    const groups = groupSessionsByTrip([row("t-a", "2026-08-01T00:00:00.000Z")], ["t-a"]);
    expect(groups.map((g) => g.key)).toEqual(["t-a"]);
  });

  it("does not lose a conversation whose trip is not in the list", () => {
    // A trip deleted in another window: the conversation survives the deletion server-side,
    // so it has to be reachable here too rather than disappearing with its group.
    const groups = groupSessionsByTrip([row("t-gone", "2026-08-01T00:00:00.000Z")], []);
    expect(groups.map((g) => g.key)).toEqual([SCRATCH_GROUP_KEY]);
    expect(groups[0]!.sessions).toHaveLength(1);
  });
});

const copy: TripMetaCopy = {
  dateRange: (s, e) => `${s} – ${e}`,
  dateFrom: (s) => `from ${s}`,
  dateUntil: (e) => `until ${e}`,
  flexible: (d, m) => `${d} days in ${m}`,
  flexibleAnyMonth: (d) => `${d} days, dates flexible`,
  flexibleMonthOnly: (m) => `in ${m}`,
  travellers: (n) => (n === 1 ? "1 traveller" : `${n} travellers`),
  budgetTiers: {
    any: "Any budget",
    low: "On a budget",
    mid: "Sensibly priced",
    high: "Upscale",
    luxury: "Luxury",
  },
  separator: " · ",
};

const trip = (over: Partial<TripSummary> = {}): TripSummary => ({
  tripId: "t-1",
  projectId: "proj",
  name: "Trip",
  destination: "",
  when: null,
  who: null,
  budget: null,
  dir: "/trips/t-1",
  dirExists: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

describe("tripMetaLine", () => {
  it("renders only what is set, in where/when/who/budget order", () => {
    expect(
      tripMetaLine(
        trip({
          name: "Autumn",
          destination: "Tokyo",
          when: { kind: "flexible", days: 5, months: ["October"] },
          who: { adults: 2, children: 1, infants: 0, pets: 0 },
          budget: "mid",
        }),
        copy,
      ),
    ).toBe("Tokyo · 5 days in October · 3 travellers · Sensibly priced");
  });

  it("is empty for a trip with no identity beyond its name", () => {
    // A trip is created before anything is known about it; an empty line renders no line,
    // rather than a row of placeholders that make an ordinary state look unfinished.
    expect(tripMetaLine(trip({ name: "Untitled trip" }), copy)).toBe("");
  });

  it("does not repeat the destination when it is already the name", () => {
    expect(tripMetaLine(trip({ name: "Tokyo", destination: "Tokyo" }), copy)).toBe("");
  });

  it("omits an explicit 'any budget', which says nothing", () => {
    expect(tripMetaLine(trip({ name: "x", destination: "Kyoto", budget: "any" }), copy)).toBe(
      "Kyoto",
    );
  });

  it("handles half-set dates and empty spans", () => {
    expect(whenText({ kind: "dates", start: "2026-10-12", end: "" }, copy)).toBe("from 2026-10-12");
    expect(whenText({ kind: "dates", start: "", end: "2026-10-17" }, copy)).toBe(
      "until 2026-10-17",
    );
    expect(whenText({ kind: "dates", start: "", end: "" }, copy)).toBeNull();
    expect(whenText({ kind: "flexible", days: 0, months: [] }, copy)).toBeNull();
    expect(whenText({ kind: "flexible", days: 0, months: ["October"] }, copy)).toBe("in October");
  });

  it("counts travellers across the three brackets, and nobody as nobody", () => {
    expect(travellerCount({ adults: 2, children: 1, infants: 1, pets: 0 })).toBe(4);
    expect(travellerCount({ adults: 0, children: 0, infants: 0, pets: 0 })).toBeNull();
    expect(travellerCount(null)).toBeNull();
  });
});
