/**
 * Trip service — travel-agent's own first-class object.
 *
 * A Trip is a row that **owns** a directory; it is not a directory. That distinction is the
 * whole design: membership of a conversation is `sessions.trip_id`, so attaching, moving and
 * detaching are single updates that never touch a Session's `workspace` — which the engine
 * fixes at creation, records in the append-only Trace, and derives memory scope from. See
 * `docs/decisions/proposed/2026-08-26-trip-as-server-entity-owning-a-directory.md`.
 *
 * Ownership of content is split the same way everywhere else in this product: the row is the
 * writer of identity (where / when / who / budget) and `trip.json` is its rendered mirror for
 * the agent to read; everything else in the directory — `itinerary.md` and whatever else the
 * work produces — belongs to the model. The service never writes those, and never deletes the
 * directory: those files are the person's, and a deleted Trip leaves them behind on purpose.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TripBudgetTier, TripSummary, TripWhen, TripWho } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { TripPatch, TripRow, TripsRepo } from "../db/repos/trips.js";
import type { SessionsRepo } from "../db/repos/sessions.js";
import type { ProjectService } from "./project-service.js";

/** Schema marker in `trip.json`, so a future shape change can be recognized rather than guessed. */
const TRIP_JSON_VERSION = 1;

/** Name a Trip carries until it has a destination or the person renames it. */
const UNTITLED_TRIP_NAME = "Untitled trip";

/**
 * Directory basename for a new Trip: a readable slug of the destination, suffixed with the
 * travel month when one is known (`tokyo-2026-10`). A Trip created before its destination is
 * known falls back to the creation date, which is still readable in a file manager.
 *
 * Only ASCII letters, digits and dashes survive, so a CJK destination yields an empty slug and
 * takes the date branch too — the display name in `trip.json` carries the real words.
 */
export function tripDirBasename(destination: string, when: TripWhen | null, now: Date): string {
  const slug = destination
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const month =
    when?.kind === "dates" && when.start.length >= 7
      ? when.start.slice(0, 7)
      : when?.kind === "flexible" && when.month !== ""
        ? when.month
        : "";
  const datePart = now.toISOString().slice(0, 10);
  if (slug === "") return `trip-${datePart}`;
  return month === "" ? slug : `${slug}-${month}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface TripServiceDeps {
  trips: TripsRepo;
  sessions: SessionsRepo;
  projectService: ProjectService;
  /** Root directory Trip folders are created under (config `tripsDir`). */
  tripsDir: string;
}

export class TripService {
  constructor(private readonly deps: TripServiceDeps) {}

  /**
   * Creates the Trip's directory under the configured root, resolving a name collision by
   * suffixing `-2`, `-3`, … rather than reusing a folder that already holds another Trip's
   * files. `recursive: true` on the root keeps a first run from failing on a missing parent.
   */
  private async allocateDir(basename: string): Promise<string> {
    await fs.mkdir(this.deps.tripsDir, { recursive: true });
    for (let attempt = 1; attempt <= 50; attempt++) {
      const candidate = path.join(
        this.deps.tripsDir,
        attempt === 1 ? basename : `${basename}-${attempt}`,
      );
      try {
        await fs.mkdir(candidate);
        return candidate;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw err;
      }
    }
    throw new HttpError(
      500,
      "trip_dir_unavailable",
      `Could not allocate a directory for the trip under ${this.deps.tripsDir}.`,
    );
  }

  /**
   * Writes `trip.json`, the agent-readable mirror of the row's identity. Best-effort by
   * design: a Trip whose directory the person has moved or made read-only must still be
   * renameable in the app, so a failed mirror write degrades to a stale file rather than a
   * failed request. `dirExists` on the summary is what tells the UI the truth.
   */
  private async writeTripJson(row: TripRow): Promise<void> {
    const body = {
      version: TRIP_JSON_VERSION,
      tripId: row.tripId,
      name: row.name,
      destination: row.destination,
      when: row.when,
      who: row.who,
      budget: row.budget,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    try {
      await fs.writeFile(
        path.join(row.dir, "trip.json"),
        `${JSON.stringify(body, null, 2)}\n`,
        "utf8",
      );
    } catch {
      /* The row remains the source of truth; the mirror is refreshed on the next change. */
    }
  }

  private async toSummary(row: TripRow): Promise<TripSummary> {
    return {
      tripId: row.tripId,
      projectId: row.projectId,
      name: row.name,
      destination: row.destination,
      when: row.when,
      who: row.who,
      budget: row.budget,
      dir: row.dir,
      dirExists: await pathExists(row.dir),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** The Trip, or 404 — after checking the caller may see its Project at all. */
  requireTrip(userId: string, tripId: string): TripRow {
    const row = this.deps.trips.findById(tripId);
    if (!row) throw new HttpError(404, "trip_not_found", `Trip not found: ${tripId}.`);
    this.deps.projectService.requireProjectAccess(userId, row.projectId);
    return row;
  }

  async create(
    userId: string,
    projectId: string,
    fields: {
      name?: string;
      destination?: string;
      when?: TripWhen | null;
      who?: TripWho | null;
      budget?: TripBudgetTier | null;
    },
  ): Promise<TripSummary> {
    this.deps.projectService.requireProjectAccess(userId, projectId);
    const now = new Date();
    const iso = now.toISOString();
    const destination = fields.destination?.trim() ?? "";
    // The name defaults to the destination because that is what a person calls a trip; an
    // explicit name always wins, and a Trip with neither is honestly "Untitled trip".
    const name = fields.name?.trim() || destination || UNTITLED_TRIP_NAME;
    const when = fields.when ?? null;
    const dir = await this.allocateDir(tripDirBasename(destination, when, now));
    const row: TripRow = {
      tripId: `t-${randomUUID().slice(0, 8)}`,
      projectId,
      name,
      destination,
      when,
      who: fields.who ?? null,
      budget: fields.budget ?? null,
      dir,
      createdAt: iso,
      updatedAt: iso,
    };
    this.deps.trips.insert(row);
    await this.writeTripJson(row);
    return this.toSummary(row);
  }

  async list(userId: string, projectId: string): Promise<TripSummary[]> {
    this.deps.projectService.requireProjectAccess(userId, projectId);
    const rows = this.deps.trips.listByProject(projectId);
    return Promise.all(rows.map((r) => this.toSummary(r)));
  }

  async get(userId: string, tripId: string): Promise<TripSummary> {
    return this.toSummary(this.requireTrip(userId, tripId));
  }

  async patch(userId: string, tripId: string, patch: TripPatch): Promise<TripSummary> {
    const existing = this.requireTrip(userId, tripId);
    const updatedAt = new Date().toISOString();
    this.deps.trips.update(tripId, patch, updatedAt);
    const updated = this.deps.trips.findById(tripId) ?? existing;
    await this.writeTripJson(updated);
    return this.toSummary(updated);
  }

  /**
   * Deletes the Trip row and detaches its conversations, which survive as floating chats.
   * The directory is deliberately left on disk: it holds the person's itinerary, and this
   * application does not delete a folder it does not own the contents of.
   */
  delete(userId: string, tripId: string): void {
    const row = this.requireTrip(userId, tripId);
    // Explicit rather than relying on ON DELETE SET NULL: databases formed before the
    // column existed got it through ALTER TABLE, which cannot carry a foreign key.
    this.deps.sessions.clearTrip(row.tripId);
    this.deps.trips.deleteById(row.tripId);
  }

  /**
   * Attaches a conversation to a Trip, moves it between Trips, or detaches it (`null`).
   * Both the conversation and the target Trip must belong to a Project the caller can see,
   * and to the *same* Project — a Trip is a Project-scoped object, and a conversation that
   * crossed Projects would appear in a sidebar its Project never authorized.
   */
  setSessionTrip(userId: string, sessionId: string, tripId: string | null): void {
    const session = this.deps.sessions.findById(sessionId);
    if (!session) throw new HttpError(404, "session_not_found", `Session not found: ${sessionId}.`);
    this.deps.projectService.requireProjectAccess(userId, session.projectId);
    if (tripId !== null) {
      const trip = this.requireTrip(userId, tripId);
      if (trip.projectId !== session.projectId) {
        throw new HttpError(
          400,
          "trip_project_mismatch",
          "A conversation can only join a trip in its own Project.",
        );
      }
    }
    this.deps.sessions.setTripId(sessionId, tripId);
  }
}
