import { describe, expect, it } from "vitest";
import type { TripSummary } from "@prismshadow/penguin-server/api";
import { calendarDate, daysUntil, groupTripsForOverview } from "../src/lib/trip-order";

const TODAY = "2026-09-05";
function trip(id: string, start = "", end = "", updatedAt = "2026-09-01"): TripSummary {
  return {
    tripId: id,
    projectId: "p",
    name: id,
    notes: "",
    destination: "",
    when: { kind: "dates", start, end },
    who: null,
    budget: null,
    budgetAmount: null,
    budgetCurrency: null,
    dir: "/tmp/trip",
    dirExists: true,
    createdAt: "2026-08-01",
    updatedAt,
  };
}
const ids = (trips: TripSummary[]) => trips.map((trip) => trip.tripId);

describe("Trips overview grouping", () => {
  it("keeps ongoing, departure-day and return-day trips ahead of future departures", () => {
    const trips = [
      trip("future", "2026-10-01", "2026-10-03"),
      trip("today", TODAY, TODAY),
      trip("ongoing", "2026-09-03", "2026-09-10"),
      trip("returning", "2026-09-01", TODAY),
    ];
    const input = [...trips];
    const groups = groupTripsForOverview(trips, TODAY);
    expect(ids(groups.upcoming)).toEqual(["returning", "ongoing", "today", "future"]);
    expect(groups.past).toEqual([]);
    expect(trips).toEqual(input);
  });
  it("moves a trip to history only after its known return day", () => {
    const journey = trip("trip", "2026-09-01", TODAY);
    expect(ids(groupTripsForOverview([journey], TODAY).upcoming)).toEqual(["trip"]);
    expect(ids(groupTripsForOverview([journey], "2026-09-06").past)).toEqual(["trip"]);
  });
  it("does not infer a return date or departure date from a single bound", () => {
    const groups = groupTripsForOverview(
      [
        trip("start-only", "2026-09-01"),
        trip("end-only", "", "2026-09-10"),
        trip("ended", "", "2026-09-04"),
        trip("not-started", "2026-10-01"),
      ],
      TODAY,
    );
    expect(ids(groups.upcoming)).toEqual(["start-only", "end-only", "not-started"]);
    expect(ids(groups.past)).toEqual(["ended"]);
  });
  it("keeps flexible, blank, impossible and reversed windows unscheduled", () => {
    const flexible = {
      ...trip("flexible"),
      when: { kind: "flexible" as const, days: 4, months: ["2026-11"] },
    };
    const noDate = { ...trip("null"), when: null };
    const trips = [
      flexible,
      noDate,
      trip("blank", " ", " "),
      trip("impossible", "2026-02-30"),
      trip("malformed", "tomorrow"),
      trip("reverse", "2026-10-01", "2026-09-01"),
    ];
    const groups = groupTripsForOverview(trips, TODAY);
    expect(groups.unscheduled).toHaveLength(trips.length);
    expect(groups.upcoming).toEqual([]);
    expect(groups.past).toEqual([]);
  });
  it("orders history by latest end, with recency then id as stable ties", () => {
    const groups = groupTripsForOverview(
      [
        trip("old", "2026-08-01", "2026-08-02"),
        trip("b", "2026-09-01", "2026-09-04"),
        trip("a", "2026-09-01", "2026-09-04"),
        trip("recent", "2026-09-01", "2026-09-04", TODAY),
      ],
      TODAY,
    );
    expect(ids(groups.past)).toEqual(["recent", "a", "b", "old"]);
  });
  it("uses recency then id to break equal departures and undated ties", () => {
    const trips = [
      trip("b", TODAY),
      trip("a", TODAY),
      trip("recent", TODAY, "", TODAY),
      trip("undated-b"),
      trip("undated-a"),
    ];
    const groups = groupTripsForOverview(trips, TODAY);
    expect(ids(groups.upcoming)).toEqual(["recent", "a", "b"]);
    expect(ids(groups.unscheduled)).toEqual(["undated-a", "undated-b"]);
    expect(groupTripsForOverview([...trips].reverse(), TODAY)).toEqual(groups);
  });
  it("returns three empty sections without records", () => {
    expect(groupTripsForOverview([], TODAY)).toEqual({ upcoming: [], unscheduled: [], past: [] });
  });
});

describe("calendar dates", () => {
  it("accepts real leap days and trims bounds, rejecting rolled-over dates", () => {
    expect(calendarDate(" 2028-02-29 ")).toBe("2028-02-29");
    for (const value of ["", "2026-02-29", "2026-13-01", "2026-00-01", "2026-09-31", "2026-9-01"]) {
      expect(calendarDate(value)).toBeNull();
    }
  });
  it("counts calendar days across daylight-saving and year boundaries", () => {
    expect(daysUntil("2026-03-09", "2026-03-07")).toBe(2);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
    expect(daysUntil("2026-11-02", "2026-10-31")).toBe(2);
  });
});
