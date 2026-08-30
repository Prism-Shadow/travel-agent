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
 *
 * "When" keeps Mindtrip's two modes because the flexible one is *more* valuable here than
 * there: "any 5 days in October" hands the agent a degree of freedom it can actually use
 * when it goes off to compare real prices.
 */
import type {
  TaskInputPart,
  TripBudgetTier,
  TripSummary,
  TripWhen,
  TripWho,
} from "@prismshadow/penguin-server/api";
import { TRIP_BUDGET_TIERS } from "@prismshadow/penguin-server/api";

/**
 * The three constraint shapes now belong to the Trip, so the server defines them and this
 * module re-exports them: two definitions of "when" — one for the chips, one for the row they
 * are stored in — would drift the first time either side gained a field.
 */
export type { TripBudgetTier, TripWhen, TripWho };
export const BUDGET_TIERS = TRIP_BUDGET_TIERS;

export interface TripConstraints {
  /** Free text — one destination or several ("Tokyo, Osaka"); optional suggestions only normalize it. */
  where: string;
  when: TripWhen | null;
  who: TripWho | null;
  budget: TripBudgetTier | null;
  /** Whole-trip total in yuan; the number the model can do arithmetic with. */
  budgetAmountCny: number | null;
}

export const EMPTY_TRIP_CONSTRAINTS: TripConstraints = {
  where: "",
  when: null,
  who: null,
  budget: null,
  budgetAmountCny: null,
};

/**
 * A Trip's stored identity as the chips render it. The chips and the Trip hold the same four
 * things under different names (`where` is the Trip's `destination`), so this is the single
 * place the two vocabularies meet.
 */
export function tripToConstraints(trip: TripSummary): TripConstraints {
  return {
    where: trip.destination,
    when: trip.when,
    who: trip.who,
    budget: trip.budget,
    budgetAmountCny: trip.budgetAmountCny,
  };
}

/**
 * The chips' values as a Trip patch. Every field is sent, including the cleared ones as
 * `null`: the chips are a complete statement of the trip's identity, so a field the person
 * emptied has to be cleared on the Trip rather than left at its previous value.
 */
export function constraintsToTripPatch(
  c: TripConstraints,
  previous?: TripConstraints,
): Partial<{
  destination: string;
  when: TripWhen | null;
  who: TripWho | null;
  budget: TripBudgetTier | null;
  budgetAmountCny: number | null;
}> {
  const full = {
    destination: c.where.trim(),
    when: whenIsSet(c.when) ? c.when : null,
    who: c.who,
    budget: c.budget,
    budgetAmountCny: c.budgetAmountCny,
  };
  if (!previous) return full;

  // Only what this edit changed. Sending the whole identity made every chip edit a write of all
  // four fields from whatever the component last rendered — and the destination the agent may
  // have filled in since is not in that snapshot, so touching the budget silently reverted it.
  // The server refuses to overwrite a destination, but it cannot defend against a client that
  // claims the blank is still the person's current answer.
  const before = {
    destination: previous.where.trim(),
    when: whenIsSet(previous.when) ? previous.when : null,
    who: previous.who,
    budget: previous.budget,
    budgetAmountCny: previous.budgetAmountCny,
  };
  const patch: Partial<typeof full> = {};
  if (full.destination !== before.destination) patch.destination = full.destination;
  if (JSON.stringify(full.when) !== JSON.stringify(before.when)) patch.when = full.when;
  if (full.who !== before.who) patch.who = full.who;
  if (full.budget !== before.budget) patch.budget = full.budget;
  if (full.budgetAmountCny !== before.budgetAmountCny) patch.budgetAmountCny = full.budgetAmountCny;
  return patch;
}

/** Locale copy the composer needs (structural contract for strings.ts / strings-en.ts). */
export interface TripChipsCopy {
  /** Names the trip's folder for the agent (`trip-workspace` skill reads it from there). */
  lineFolder: string;
  lineWhere: string;
  lineWhen: string;
  lineWho: string;
  lineBudget: string;
  dateRange: (start: string, end: string) => string;
  dateFrom: (start: string) => string;
  dateUntil: (end: string) => string;
  flexible: (days: number, months: string) => string;
  flexibleAnyMonth: (days: number) => string;
  flexibleMonthOnly: (months: string) => string;
  adults: (n: number) => string;
  children: (n: number) => string;
  infants: (n: number) => string;
  /** Joins the traveller parts ("、" zh, ", " en). */
  whoJoin: string;
  pets: (n: number) => string;
  tiers: Record<TripBudgetTier, string>;
  /** The stated whole-trip total ("总预算 ¥20,000"). */
  budgetAmount: (yuan: number) => string;
}

/** Whether the "when" chip holds anything sendable (a set mode with all fields blank does not count). */
export function whenIsSet(when: TripWhen | null): boolean {
  if (when === null) return false;
  if (when.kind === "dates") return when.start.trim() !== "" || when.end.trim() !== "";
  return when.days > 0 || when.months.length > 0;
}

/** True when nothing is filled in — the composer sends the user's text untouched. */
export function isEmptyTrip(c: TripConstraints): boolean {
  return (
    c.where.trim() === "" &&
    !whenIsSet(c.when) &&
    c.who === null &&
    c.budget === null &&
    c.budgetAmountCny === null
  );
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
  const month = when.months.join(" / ");
  if (when.days > 0 && month !== "") return copy.flexible(when.days, month);
  return when.days > 0 ? copy.flexibleAnyMonth(when.days) : copy.flexibleMonthOnly(month);
}

/**
 * The visible constraint block: one `label: value` line per filled chip, in the fixed
 * Where / When / Who / Budget order. Empty result for empty constraints.
 */
export function composeTripPrefix(
  c: TripConstraints,
  copy: TripChipsCopy,
  /** Absolute path of the Trip's folder, when this conversation belongs to one. */
  tripDir?: string,
): string {
  const lines: string[] = [];
  // The folder leads, because it is the instruction the agent acts on first: the trip-workspace
  // skill reads trip.json and itinerary.md from it before doing anything else. It is stated in
  // the visible message like everything else here — there is no hidden channel carrying it.
  if (tripDir !== undefined && tripDir !== "") lines.push(`${copy.lineFolder}${tripDir}`);
  if (c.where.trim() !== "") lines.push(`${copy.lineWhere}${c.where.trim()}`);
  const when = whenLine(c.when, copy);
  if (when !== null) lines.push(`${copy.lineWhen}${when}`);
  if (c.who !== null) {
    const parts: string[] = [];
    if (c.who.adults > 0) parts.push(copy.adults(c.who.adults));
    if (c.who.children > 0) parts.push(copy.children(c.who.children));
    if (c.who.infants > 0) parts.push(copy.infants(c.who.infants));
    // Pets change what qualifies, so the message must carry them — a summary that drops
    // them makes the model shortlist stays the traveller cannot use.
    if (c.who.pets > 0) parts.push(copy.pets(c.who.pets));
    if (parts.length > 0) lines.push(`${copy.lineWho}${parts.join(copy.whoJoin)}`);
  }
  // Tier and amount answer the same question at different precision; state whichever the
  // person gave, both when they gave both.
  {
    const parts: string[] = [];
    if (c.budget !== null) parts.push(copy.tiers[c.budget]);
    if (c.budgetAmountCny !== null) parts.push(copy.budgetAmount(c.budgetAmountCny));
    if (parts.length > 0) lines.push(`${copy.lineBudget}${parts.join(" · ")}`);
  }
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
  tripDir?: string,
): TaskInputPart[] {
  const prefix = composeTripPrefix(c, copy, tripDir);
  if (prefix === "") return input;
  const at = input.findIndex((p) => p.type === "text");
  if (at === -1) return [{ type: "text", text: prefix }, ...input];
  return input.map((p, i) =>
    i === at && p.type === "text"
      ? { type: "text", text: p.text.trim() === "" ? prefix : `${prefix}\n\n${p.text}` }
      : p,
  );
}
