/**
 * Deterministic date rules for ordering and grouping Trips: the draft rail's "Up next" pick
 * and the /trips overview's sections. Data rules, deliberately not judgements — a countdown
 * is arithmetic, "which journey matters now" is the soonest future departure, and a section
 * is a comparison against today's date. No model call belongs here (the root spec declines
 * a proactive AI opener), and nothing here reaches the server: every input is an index field
 * the app has already loaded.
 */
import type { TripSummary } from "@prismshadow/penguin-server/api";

/** Local calendar day as `YYYY-MM-DD` — not UTC, because "departs in 2 days" is asked at home. */
export function localTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The trips the rail leads with, most pressing first. A deterministic data rule, deliberately
 * not a judgement: future departures order soonest-first (today counts — departure day is the
 * day the card matters most), then the remaining trips by latest touch, capped at the rail
 * size so the rail never duplicates the sidebar as another long list.
 */
export function pickUpNextTrips(
  trips: readonly TripSummary[],
  todayIso: string,
  count: number = 3,
): TripSummary[] {
  const isFuture = (t: TripSummary) => t.when?.kind === "dates" && t.when.start.trim() >= todayIso;
  const dated = trips.filter(isFuture).sort((a, b) => {
    const sa = a.when!.kind === "dates" ? a.when!.start : "";
    const sb = b.when!.kind === "dates" ? b.when!.start : "";
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  const touched = trips
    .filter((t) => !isFuture(t))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return [...dated, ...touched].slice(0, count);
}

/** Whole days from `todayIso` to `startIso`, both local calendar days (0 = departs today). */
export function daysUntil(startIso: string, todayIso: string): number {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!, 12);
  };
  return Math.round((parse(startIso) - parse(todayIso)) / 86_400_000);
}

/** The /trips overview's three sections, in render order. */
export interface TripOverviewGroups {
  /** Dated and not yet over — a trip in progress counts. Soonest departure first. */
  upcoming: TripSummary[];
  /**
   * No usable calendar window: no `when`, a flexible one, or dates left blank. A flexible
   * "5 days in November" is deliberately unscheduled here — it has no departure to sort by,
   * and its meta line still says what the person said.
   */
  unscheduled: TripSummary[];
  /** The window's last day is behind today. Most recently ended first. */
  past: TripSummary[];
}

/** Calendar dates only: impossible dates must not create countdowns or false past states. */
export function calendarDate(value: string): string | null {
  const iso = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** A known bound orders the trip; an unknown end never implies the journey has finished. */
export function tripWindow(trip: TripSummary): { first: string; last: string | null } | null {
  if (trip.when?.kind !== "dates") return null;
  const start = calendarDate(trip.when.start);
  const end = calendarDate(trip.when.end);
  if ((trip.when.start.trim() && !start) || (trip.when.end.trim() && !end)) return null;
  if ((!start && !end) || (start && end && start > end)) return null;
  return { first: start ?? end!, last: end };
}

/** Latest-touched first; ISO-8601 strings order lexicographically. */
function byRecency(a: TripSummary, b: TripSummary): number {
  return a.updatedAt < b.updatedAt
    ? 1
    : a.updatedAt > b.updatedAt
      ? -1
      : a.tripId.localeCompare(b.tripId);
}

/**
 * Sections every trip into exactly one of the overview's three groups. Pure partition over
 * index fields: dated-and-not-over is upcoming, dated-and-over is past, everything else is
 * unscheduled. Ties inside a section fall back to recency so the order is total and stable.
 */
export function groupTripsForOverview(
  trips: readonly TripSummary[],
  todayIso: string,
): TripOverviewGroups {
  const upcoming: TripSummary[] = [];
  const unscheduled: TripSummary[] = [];
  const past: TripSummary[] = [];
  for (const trip of trips) {
    const window = tripWindow(trip);
    if (window === null) unscheduled.push(trip);
    else if (window.last !== null && window.last < todayIso) past.push(trip);
    else upcoming.push(trip);
  }
  upcoming.sort((a, b) => {
    const fa = tripWindow(a)!.first;
    const fb = tripWindow(b)!.first;
    return fa < fb ? -1 : fa > fb ? 1 : byRecency(a, b);
  });
  unscheduled.sort(byRecency);
  past.sort((a, b) => {
    const la = tripWindow(a)!.last!;
    const lb = tripWindow(b)!.last!;
    return la < lb ? 1 : la > lb ? -1 : byRecency(a, b);
  });
  return { upcoming, unscheduled, past };
}
