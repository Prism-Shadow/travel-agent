/**
 * Trip service — travel-agent's own first-class object.
 *
 * A Trip is a row that **owns** a directory; it is not a directory. That distinction is the
 * whole design: membership of a conversation is `sessions.trip_id`, so attaching, moving and
 * detaching are single updates that never touch a Session's `workspace` — which the engine
 * fixes at creation, records in the append-only Trace, and derives memory scope from. See
 * `docs/decisions/implemented/2026-08-26-trip-as-server-entity-owning-a-directory.md`.
 *
 * Ownership of content is split the same way everywhere else in this product: the row is the
 * writer of identity (where / when / who / budget) and `trip.json` is its rendered mirror for
 * the agent to read; everything else in the directory — `itinerary.md` and whatever else the
 * work produces — belongs to the model. The service never writes those, and never deletes a
 * directory that holds them: those files are the person's, and a deleted Trip leaves them behind
 * on purpose. The one directory it does remove is a pristine one — see `removeDirIfPristine`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  TripBudgetTier,
  TripItineraryResponse,
  TripSummary,
  TripWhen,
  TripWho,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { TripPatch, TripRow, TripsRepo } from "../db/repos/trips.js";
import type { SessionsRepo } from "../db/repos/sessions.js";
import type { ProjectService } from "./project-service.js";

/** Schema marker in `trip.json`, so a future shape change can be recognized rather than guessed. */
const TRIP_JSON_VERSION = 1;

/** Name a Trip carries until it has a destination or the person renames it. */
const UNTITLED_TRIP_NAME = "Untitled trip";

/** The model's plan for the journey, in the Trip's own folder. */
const ITINERARY_FILENAME = "itinerary.md";

/** The identity mirror this service writes — the one file in a Trip folder that is ours. */
const TRIP_JSON_FILENAME = "trip.json";

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
        path.join(row.dir, TRIP_JSON_FILENAME),
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

  /**
   * Reads the Trip's `itinerary.md`.
   *
   * A missing file is a state, not a failure: a journey has no plan until the agent writes one.
   * A folder the person moved away answers the same way — `TripSummary.dirExists` is what tells
   * those two apart, and it deserves different words on screen.
   *
   * Read directly rather than through the workspace-file service: this is not a Workspace and
   * has no Session, and the only path this ever opens is one fixed name inside the Trip's own
   * directory.
   */
  async readItinerary(row: TripRow): Promise<TripItineraryResponse> {
    const file = path.join(row.dir, ITINERARY_FILENAME);
    try {
      const [content, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
      return { exists: true, markdown: content, updatedAt: stat.mtime.toISOString() };
    } catch {
      return { exists: false, markdown: "" };
    }
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
   * Removes the Trip's directory **only when nothing but our own `trip.json` is in it**.
   *
   * The two halves of this rule are both load-bearing. A folder holding an itinerary, a map,
   * or anything else the model or the person put there is never deleted — those files are the
   * person's, and a trip they used is theirs to keep even after they remove it from the app.
   * But a folder containing only the skeleton this service wrote is *our* leftover, and
   * leaving it behind is how a failed send silently accumulates husks: `kyoto`, `kyoto-2`,
   * `kyoto-3`, each holding one file nothing references.
   *
   * Anything unexpected — an unreadable directory, an extra file, even a `.DS_Store` — means
   * hands off. Erring towards leaving a folder costs an empty directory; erring the other way
   * costs someone's trip.
   */
  private async removeDirIfPristine(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir);
      const ours =
        entries.length === 0 || (entries.length === 1 && entries[0] === TRIP_JSON_FILENAME);
      if (!ours) return;
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* Gone already, or not ours to read: leave it exactly as it is. */
    }
  }

  /**
   * Deletes the Trip row and detaches its conversations, which survive as floating chats.
   * The directory survives with them whenever it holds anything the journey produced; an
   * untouched one is removed, so a trip that never got started leaves nothing behind.
   */
  async delete(userId: string, tripId: string): Promise<void> {
    const row = this.requireTrip(userId, tripId);
    // Explicit rather than relying on ON DELETE SET NULL: databases formed before the
    // column existed got it through ALTER TABLE, which cannot carry a foreign key.
    this.deps.sessions.clearTrip(row.tripId);
    this.deps.trips.deleteById(row.tripId);
    await this.removeDirIfPristine(row.dir);
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
