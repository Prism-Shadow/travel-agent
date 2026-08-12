/**
 * Commitments: what the human actually authorised.
 *
 * The naive model is a numeric boundary — "budget ceiling 1500" — checked before spending. It
 * does not survive contact with users, because people cannot state a budget before they have
 * seen what the route costs. Preferences are constructed while choosing, not retrieved.
 *
 * So authorisation here is not an abstract limit but **a commitment to one concrete plan**.
 * Picking "MU5137, 14:20, ¥1280" out of a list *is* the authorisation. That makes the
 * enforcement question sharper and easier at once: instead of "is this under the limit?", it is
 * "is what I am about to do still the thing they agreed to?" — a structural comparison of two
 * objects rather than a judgement call about a threshold.
 *
 * Reality drifts anyway: prices move between choosing and paying. Tolerance covers that, and it
 * is gathered **in context** — asked while showing the ¥1280 flight ("if it has gone up by the
 * time I book, how much can I absorb?"), a question people can actually answer, rather than in
 * the abstract, where they cannot.
 */

/** How far autonomous execution may go without coming back to the human. */
export type AuthorityCeiling = "read_only" | "fill_form" | "submit_order" | "pay";

const CEILING_ORDER: readonly AuthorityCeiling[] = [
  "read_only",
  "fill_form",
  "submit_order",
  "pay",
];

/**
 * Slack for one numeric field.
 *
 * A bare number means **how far it may rise**, because for the field this exists for — price —
 * rising is the adverse direction, and the question the human answered was "if it has gone up by
 * the time I book, how much can I absorb?".
 *
 * Direction has to be stated rather than inferred: "smaller is better" holds for price and is
 * exactly wrong for nights or passengers, and a comparator that guessed would silently accept a
 * two-night booking collapsing to one. So anything other than an allowed rise is spelled out.
 */
export type FieldTolerance = number | { increase?: number; decrease?: number };

/** Per-field slack, keyed by the same dotted paths used in `approved`. Absent = must match. */
export interface Tolerance {
  [fieldPath: string]: FieldTolerance | undefined;
}

/** Unbounded slack in one direction, for fields where only one way can hurt (a price drop). */
export const ANY = Number.POSITIVE_INFINITY;

function allowanceFor(
  tolerance: FieldTolerance | undefined,
  direction: "increase" | "decrease",
): number {
  if (tolerance === undefined) return 0;
  if (typeof tolerance === "number") return direction === "increase" ? tolerance : 0;
  return tolerance[direction] ?? 0;
}

export interface Commitment {
  /** Structured snapshot of the exact plan the human picked. */
  approved: Record<string, unknown>;
  /** Allowed drift per field path, gathered in context when the plan was shown. */
  tolerance: Tolerance;
  /** Default `fill_form`: fill everything in, stop at the payment page. */
  ceiling: AuthorityCeiling;
  approvedAt: string;
  /** Where the authorisation came from (`"feishu-card"`, `"cli"`, …). Audit trail. */
  channel: string;
}

/** One field where the plan about to be executed differs from the one that was approved. */
export interface Drift {
  /** Dotted path into `approved`, e.g. `"price"` or `"outbound.departure"`. */
  path: string;
  approved: unknown;
  actual: unknown;
  /** Set for numeric drift: how far it moved, and how far it was allowed to. */
  delta?: number;
  allowed?: number;
  reason: "changed" | "over_tolerance" | "missing" | "added";
}

export interface DriftCheck {
  withinCommitment: boolean;
  drifts: Drift[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(
  approved: unknown,
  actual: unknown,
  tolerance: Tolerance,
  prefix: string,
  out: Drift[],
): void {
  if (isPlainObject(approved) && isPlainObject(actual)) {
    for (const key of Object.keys(approved)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!(key in actual)) {
        out.push({ path, approved: approved[key], actual: undefined, reason: "missing" });
        continue;
      }
      walk(approved[key], actual[key], tolerance, path, out);
    }
    // An extra field is drift too: a booking page that grew a "seat fee" the human never saw
    // is exactly the case this must catch.
    for (const key of Object.keys(actual)) {
      if (key in approved) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      out.push({ path, approved: undefined, actual: actual[key], reason: "added" });
    }
    return;
  }

  if (typeof approved === "number" && typeof actual === "number") {
    const delta = actual - approved;
    if (delta === 0) return;
    const direction = delta > 0 ? "increase" : "decrease";
    const allowed = allowanceFor(tolerance[prefix], direction);
    if (Math.abs(delta) <= allowed) return;
    out.push({ path: prefix, approved, actual, delta, allowed, reason: "over_tolerance" });
    return;
  }

  if (JSON.stringify(approved) !== JSON.stringify(actual)) {
    out.push({ path: prefix, approved, actual, reason: "changed" });
  }
}

/**
 * Compares the plan about to be executed against the one that was approved.
 *
 * Anything outside tolerance is drift, and drift means going back to the human — this function
 * never decides to proceed on its own, it only reports what moved.
 */
export function checkDrift(commitment: Commitment, actual: Record<string, unknown>): DriftCheck {
  const drifts: Drift[] = [];
  walk(commitment.approved, actual, commitment.tolerance, "", drifts);
  return { withinCommitment: drifts.length === 0, drifts };
}

/** Whether the commitment authorises acting at `required`. */
export function permits(commitment: Commitment, required: AuthorityCeiling): boolean {
  return CEILING_ORDER.indexOf(commitment.ceiling) >= CEILING_ORDER.indexOf(required);
}

/** One line per drift, for a confirmation card or an escalation summary. */
export function describeDrift(drifts: Drift[]): string[] {
  return drifts.map((drift) => {
    switch (drift.reason) {
      case "over_tolerance":
        return `${drift.path}: ${String(drift.approved)} → ${String(drift.actual)} (超出容差 ${String(drift.allowed ?? 0)}，实际变动 ${String(drift.delta ?? 0)})`;
      case "missing":
        return `${drift.path}: 已确认的值 ${String(drift.approved)} 在当前方案里不见了`;
      case "added":
        return `${drift.path}: 出现了确认时没有的项 ${String(drift.actual)}`;
      default:
        return `${drift.path}: ${String(drift.approved)} → ${String(drift.actual)}`;
    }
  });
}
