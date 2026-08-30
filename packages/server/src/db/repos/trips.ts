/**
 * trips table repo: travel-agent's own first-class object — a journey that owns a directory.
 *
 * The row is the writer of a Trip's identity; `trip.json` inside `dir` is a rendered mirror
 * of it (TripService keeps the two in step). Membership of a conversation is a nullable
 * `sessions.trip_id`, never the session's workspace: that is the whole point of the entity
 * (docs/decisions/implemented/2026-08-26-trip-as-server-entity-owning-a-directory.md).
 *
 * `when` and `who` are stored as JSON text because they are small closed shapes the UI owns
 * whole — there is no query that filters on a traveller count or a flexible month, so columns
 * would buy nothing and would have to grow every time the shape does.
 */
import type { DatabaseSync } from "node:sqlite";
import type { TripBudgetTier, TripWhen, TripWho } from "../../api/types.js";

export interface TripRow {
  tripId: string;
  projectId: string;
  /** Display name; seeded from the destination at creation, renameable afterwards. */
  name: string;
  /** Free text, possibly several places ("Tokyo, Osaka"); "" = not set yet. */
  destination: string;
  /** Exact dates or a flexible span; null = not set. */
  when: TripWhen | null;
  /** Traveller counts; null = not set. */
  who: TripWho | null;
  /** Price tier; null = not set. */
  budget: TripBudgetTier | null;
  /** Absolute path of the directory this Trip owns. */
  dir: string;
  createdAt: string;
  updatedAt: string;
}

/** The identity fields a caller may change; an omitted key leaves the stored value alone. */
export interface TripPatch {
  name?: string;
  destination?: string;
  when?: TripWhen | null;
  who?: TripWho | null;
  budget?: TripBudgetTier | null;
}

/**
 * Parses a stored JSON column. Corrupt content degrades to "not set" rather than failing the
 * read: a Trip whose `who` cannot be parsed must still list, and the next write repairs it.
 */
function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Shapes this schema has retired: flexible `when` carried one `month: string`, and `who` had no
 * `pets`. A row written then still states a fact the person gave, so it is translated on read
 * rather than degraded to "not set" — dropping it would silently unanswer a chip they answered.
 * The next write re-mirrors the row in today's shape.
 */
function normalizeWhen(parsed: TripWhen | null): TripWhen | null {
  if (parsed === null || parsed.kind !== "flexible" || Array.isArray(parsed.months)) return parsed;
  const legacy = (parsed as { month?: unknown }).month;
  return {
    kind: "flexible",
    days: parsed.days,
    months: typeof legacy === "string" && legacy !== "" ? [legacy] : [],
  };
}

function normalizeWho(parsed: TripWho | null): TripWho | null {
  if (parsed === null || typeof parsed.pets === "number") return parsed;
  return { ...parsed, pets: 0 };
}

function mapRow(r: Record<string, unknown>): TripRow {
  return {
    tripId: r.trip_id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    destination: (r.destination as string | null) ?? "",
    when: normalizeWhen(parseJson<TripWhen>(r.when_json)),
    who: normalizeWho(parseJson<TripWho>(r.who_json)),
    budget: (r.budget as TripBudgetTier | null) ?? null,
    dir: r.dir as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export class TripsRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(row: TripRow): void {
    this.db
      .prepare(
        `INSERT INTO trips (trip_id, project_id, name, destination, when_json, who_json, budget, dir, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.tripId,
        row.projectId,
        row.name,
        row.destination,
        row.when === null ? null : JSON.stringify(row.when),
        row.who === null ? null : JSON.stringify(row.who),
        row.budget,
        row.dir,
        row.createdAt,
        row.updatedAt,
      );
  }

  findById(tripId: string): TripRow | null {
    const r = this.db.prepare("SELECT * FROM trips WHERE trip_id = ?").get(tripId);
    return r ? mapRow(r) : null;
  }

  /**
   * A Project's Trips, newest first — the sidebar's order (served by idx_trips_project_created).
   *
   * `rowid` breaks a tie rather than `trip_id`: two Trips created in the same millisecond share
   * a `created_at`, and a trip id is a random string, so ordering by it would shuffle the
   * sidebar between reads. The rowid is insertion order, which is what "newest first" means.
   */
  listByProject(projectId: string): TripRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM trips WHERE project_id = ?
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(projectId);
    return rows.map(mapRow);
  }

  /**
   * Applies the given identity fields and stamps `updated_at`. Only the keys present in
   * `patch` are written, so a caller changing the name cannot blank the budget by omission.
   */
  update(tripId: string, patch: TripPatch, updatedAt: string): void {
    const sets: string[] = [];
    const values: (string | null)[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      values.push(patch.name);
    }
    if (patch.destination !== undefined) {
      sets.push("destination = ?");
      values.push(patch.destination);
    }
    if (patch.when !== undefined) {
      sets.push("when_json = ?");
      values.push(patch.when === null ? null : JSON.stringify(patch.when));
    }
    if (patch.who !== undefined) {
      sets.push("who_json = ?");
      values.push(patch.who === null ? null : JSON.stringify(patch.who));
    }
    if (patch.budget !== undefined) {
      sets.push("budget = ?");
      values.push(patch.budget);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    values.push(updatedAt);
    this.db.prepare(`UPDATE trips SET ${sets.join(", ")} WHERE trip_id = ?`).run(...values, tripId);
  }

  /**
   * Deletes the row. Conversations that belonged to it are detached rather than deleted
   * (`ON DELETE SET NULL` on fresh databases; TripService clears them explicitly so
   * upgraded databases, whose added column carries no constraint, behave identically).
   * The directory on disk is not this layer's concern: TripService decides its fate (it keeps a
   * folder the journey wrote to, and removes a pristine one).
   */
  deleteById(tripId: string): void {
    this.db.prepare("DELETE FROM trips WHERE trip_id = ?").run(tripId);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM trips WHERE project_id = ?").run(projectId);
  }
}
