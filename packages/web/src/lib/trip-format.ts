/**
 * Trip identity rendered as the one line under a trip's name.
 *
 * The line answers, in the order a traveller asks it: where, when, who, how much. Fields that
 * were never filled in are simply absent — a trip stated as one sentence often has only a
 * destination, and padding the line with "dates not set" would make an ordinary state look
 * like something is missing. A trip with nothing filled in yields "", and the caller renders
 * no line at all rather than an empty one.
 */
import type { TripSummary, TripWhen, TripWho } from "@prismshadow/penguin-server/api";

/** Locale copy the line needs (structural contract for strings.ts / strings-en.ts). */
export interface TripMetaCopy {
  dateRange: (start: string, end: string) => string;
  dateFrom: (start: string) => string;
  dateUntil: (end: string) => string;
  flexible: (days: number, month: string) => string;
  flexibleAnyMonth: (days: number) => string;
  flexibleMonthOnly: (month: string) => string;
  travellers: (n: number) => string;
  budgetTiers: Record<NonNullable<TripSummary["budget"]>, string>;
  /** Separator between the parts ("·" reads the same in both languages). */
  separator: string;
}

/** The "when" part, or null when the mode is set but nothing inside it is. */
export function whenText(when: TripWhen | null, copy: TripMetaCopy): string | null {
  if (when === null) return null;
  if (when.kind === "dates") {
    const start = when.start.trim();
    const end = when.end.trim();
    if (start === "" && end === "") return null;
    if (start !== "" && end !== "") return copy.dateRange(start, end);
    return start !== "" ? copy.dateFrom(start) : copy.dateUntil(end);
  }
  const month = when.month.trim();
  if (when.days <= 0 && month === "") return null;
  if (when.days > 0 && month !== "") return copy.flexible(when.days, month);
  return when.days > 0 ? copy.flexibleAnyMonth(when.days) : copy.flexibleMonthOnly(month);
}

/** Total travellers, or null when nobody has been counted (all three brackets zero). */
export function travellerCount(who: TripWho | null): number | null {
  if (who === null) return null;
  const total = who.adults + who.children + who.infants;
  return total > 0 ? total : null;
}

/** The whole line; "" when the trip has no identity beyond its name. */
export function tripMetaLine(trip: TripSummary, copy: TripMetaCopy): string {
  const parts: string[] = [];
  const destination = trip.destination.trim();
  // The destination is skipped when the name already is it: a card reading "Tokyo / Tokyo"
  // spends a line saying nothing.
  if (destination !== "" && destination !== trip.name.trim()) parts.push(destination);
  const when = whenText(trip.when, copy);
  if (when !== null) parts.push(when);
  const travellers = travellerCount(trip.who);
  if (travellers !== null) parts.push(copy.travellers(travellers));
  if (trip.budget !== null && trip.budget !== "any") parts.push(copy.budgetTiers[trip.budget]);
  return parts.join(copy.separator);
}
