/**
 * Trip-constraint chips: the draft screen's Where / When / Who / Budget scaffolding
 * (patterned on Mindtrip's four constraint dialogs), reduced to what this
 * product can honestly do.
 *
 * The constraints are **prompt scaffolding, not protocol**: composing them produces plain
 * text lines prepended to the first message, visible in the sent bubble exactly as the
 * model receives them (the same what-you-see-is-what-was-sent pattern as skill-block
 * injection). Nothing here reaches the server as structured data, and deliberately so —
 * preferences are constructed while choosing, the model judges, code only
 * enforces where the model is in the threat model. Two boundaries follow:
 *
 * - **Budget is a tier, not a number.** Mindtrip's own Budget dialog offers only price
 *   tiers (£…££££) — the same insight transaction/commitment.ts is built on: people cannot
 *   state a numeric ceiling before seeing what the options cost. The tier is a preference
 *   signal for shaping the representative set, never a transaction gate; authorisation
 *   remains the click on one concrete plan.
 * - **This is unrelated to goal mode's token budget** (goal-use.ts) — same word, different
 *   thing; the two must never share UI copy or plumbing.
 *
 * "When" keeps Mindtrip's two modes because the flexible one is *more* valuable here than
 * there: "any 5 days in October" hands the agent a degree of freedom it can actually use
 * when it goes off to compare real prices.
 */
import type { TaskInputPart } from "@prismshadow/penguin-server/api";

/** Traveller counts — the three age brackets travel pricing (flights, stays, tickets) actually distinguishes. */
export interface TripWho {
  adults: number;
  children: number;
  infants: number;
}

/** Price tiers, Mindtrip's Budget dialog verbatim; "any" is an explicit "money is not the axis". */
export type TripBudgetTier = "any" | "low" | "mid" | "high" | "luxury";
export const BUDGET_TIERS: readonly TripBudgetTier[] = ["any", "low", "mid", "high", "luxury"];

/** Exact dates (either end may still be blank) or Mindtrip-style flexible "N days, some month". */
export type TripWhen =
  { kind: "dates"; start: string; end: string } | { kind: "flexible"; days: number; month: string };

export interface TripConstraints {
  /** Free text — one destination or several ("Tokyo, Osaka"); no POI autocomplete to fake. */
  where: string;
  when: TripWhen | null;
  who: TripWho | null;
  budget: TripBudgetTier | null;
}

export const EMPTY_TRIP_CONSTRAINTS: TripConstraints = {
  where: "",
  when: null,
  who: null,
  budget: null,
};

/** Locale copy the composer needs (structural contract for strings.ts / strings-en.ts). */
export interface TripChipsCopy {
  lineWhere: string;
  lineWhen: string;
  lineWho: string;
  lineBudget: string;
  dateRange: (start: string, end: string) => string;
  dateFrom: (start: string) => string;
  dateUntil: (end: string) => string;
  flexible: (days: number, month: string) => string;
  flexibleAnyMonth: (days: number) => string;
  flexibleMonthOnly: (month: string) => string;
  adults: (n: number) => string;
  children: (n: number) => string;
  infants: (n: number) => string;
  /** Joins the traveller parts ("、" zh, ", " en). */
  whoJoin: string;
  tiers: Record<TripBudgetTier, string>;
}

/** Whether the "when" chip holds anything sendable (a set mode with all fields blank does not count). */
export function whenIsSet(when: TripWhen | null): boolean {
  if (when === null) return false;
  if (when.kind === "dates") return when.start.trim() !== "" || when.end.trim() !== "";
  return when.days > 0 || when.month.trim() !== "";
}

/** True when nothing is filled in — the composer sends the user's text untouched. */
export function isEmptyTrip(c: TripConstraints): boolean {
  return c.where.trim() === "" && !whenIsSet(c.when) && c.who === null && c.budget === null;
}

/** The "when" line's body, or null when the mode is set but nothing in it is. */
function whenLine(when: TripWhen | null, copy: TripChipsCopy): string | null {
  if (when === null || !whenIsSet(when)) return null;
  if (when.kind === "dates") {
    const start = when.start.trim();
    const end = when.end.trim();
    if (start !== "" && end !== "") return copy.dateRange(start, end);
    return start !== "" ? copy.dateFrom(start) : copy.dateUntil(end);
  }
  const month = when.month.trim();
  if (when.days > 0 && month !== "") return copy.flexible(when.days, month);
  return when.days > 0 ? copy.flexibleAnyMonth(when.days) : copy.flexibleMonthOnly(month);
}

/**
 * The visible constraint block: one `label: value` line per filled chip, in the fixed
 * Where / When / Who / Budget order. Empty result for empty constraints.
 */
export function composeTripPrefix(c: TripConstraints, copy: TripChipsCopy): string {
  const lines: string[] = [];
  if (c.where.trim() !== "") lines.push(`${copy.lineWhere}${c.where.trim()}`);
  const when = whenLine(c.when, copy);
  if (when !== null) lines.push(`${copy.lineWhen}${when}`);
  if (c.who !== null) {
    const parts: string[] = [];
    if (c.who.adults > 0) parts.push(copy.adults(c.who.adults));
    if (c.who.children > 0) parts.push(copy.children(c.who.children));
    if (c.who.infants > 0) parts.push(copy.infants(c.who.infants));
    if (parts.length > 0) lines.push(`${copy.lineWho}${parts.join(copy.whoJoin)}`);
  }
  if (c.budget !== null) lines.push(`${copy.lineBudget}${copy.tiers[c.budget]}`);
  return lines.join("\n");
}

/**
 * Prepends the constraint block to the outgoing input's first text part (or adds one when
 * the send is attachment-only), so the bubble shows exactly what the model gets. Returns
 * the input untouched when no chip is filled.
 */
export function applyTripPrefix(
  input: TaskInputPart[],
  c: TripConstraints,
  copy: TripChipsCopy,
): TaskInputPart[] {
  const prefix = composeTripPrefix(c, copy);
  if (prefix === "") return input;
  const at = input.findIndex((p) => p.type === "text");
  if (at === -1) return [{ type: "text", text: prefix }, ...input];
  return input.map((p, i) =>
    i === at && p.type === "text"
      ? { type: "text", text: p.text.trim() === "" ? prefix : `${prefix}\n\n${p.text}` }
      : p,
  );
}
