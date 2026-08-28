/**
 * Trip routes.
 *
 * `/api/projects/:projectId/trips` — list and create, because a Trip is Project-scoped.
 * `/api/trips/:tripId` — read, patch, delete, and the conversation list, because a Trip id
 * is globally unique and the client holds one without knowing its Project (the same split
 * the session routes already use).
 *
 * Re-homing a conversation is `PUT /api/sessions/:sessionId/trip`, registered by the session
 * routes: the thing being changed is a property of the conversation.
 *
 * Every identity field is optional everywhere. A Trip may be created from a single sentence
 * with nothing known yet, and `null` on a patch clears a field — that is how "budget no longer
 * matters" is expressed, and it is why the handlers distinguish absent from null.
 */
import { Hono } from "hono";
import type { TripBudgetTier, TripPatchRequest, TripWhen, TripWho } from "../../api/types.js";
import { TRIP_BUDGET_TIERS } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { HttpError } from "../errors.js";
import { badRequest, optionalString, pathParam, readJson, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

/** ISO calendar date, or "" for an open end. Format only — a past date is the person's business. */
function isDateOrBlank(v: unknown): v is string {
  return typeof v === "string" && (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v));
}

/**
 * Parses the `when` field: absent leaves it alone, `null` clears it, an object must be a
 * complete `TripWhen`. A half-parsed span is rejected rather than stored, because a stored
 * shape the UI cannot render is worse than a 400 the caller can fix.
 */
function parseWhen(body: Record<string, unknown>): TripWhen | null | undefined {
  if (!("when" in body)) return undefined;
  const raw = body.when;
  if (raw === null) return null;
  if (typeof raw !== "object") throw badRequest("when must be an object or null.");
  const w = raw as Record<string, unknown>;
  if (w.kind === "dates") {
    if (!isDateOrBlank(w.start) || !isDateOrBlank(w.end)) {
      throw badRequest('when.start and when.end must be "yyyy-mm-dd" or "".');
    }
    return { kind: "dates", start: w.start, end: w.end };
  }
  if (w.kind === "flexible") {
    const days = typeof w.days === "number" ? Math.trunc(w.days) : NaN;
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      throw badRequest("when.days must be a number between 0 and 365.");
    }
    if (typeof w.month !== "string" || w.month.length > 32) {
      throw badRequest("when.month must be a string of at most 32 characters.");
    }
    return { kind: "flexible", days, month: w.month };
  }
  throw badRequest('when.kind must be "dates" or "flexible".');
}

/** Parses `who`: absent leaves it alone, `null` clears it, an object needs three counts. */
function parseWho(body: Record<string, unknown>): TripWho | null | undefined {
  if (!("who" in body)) return undefined;
  const raw = body.who;
  if (raw === null) return null;
  if (typeof raw !== "object") throw badRequest("who must be an object or null.");
  const w = raw as Record<string, unknown>;
  const read = (key: "adults" | "children" | "infants" | "pets"): number => {
    const n = typeof w[key] === "number" ? Math.trunc(w[key] as number) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > 99) {
      throw badRequest(`who.${key} must be a number between 0 and 99.`);
    }
    return n;
  };
  return {
    adults: read("adults"),
    children: read("children"),
    infants: read("infants"),
    // Absent in a body written before pets existed, and in one from a client that does not send
    // them: read as zero rather than rejected, so an older caller keeps working.
    pets: "pets" in w ? read("pets") : 0,
  };
}

/** Parses `budget`: absent leaves it alone, `null` clears it, otherwise one of the five tiers. */
function parseBudget(body: Record<string, unknown>): TripBudgetTier | null | undefined {
  if (!("budget" in body)) return undefined;
  const raw = body.budget;
  if (raw === null) return null;
  if (typeof raw !== "string" || !TRIP_BUDGET_TIERS.includes(raw as TripBudgetTier)) {
    throw badRequest(`budget must be null or one of: ${TRIP_BUDGET_TIERS.join(", ")}.`);
  }
  return raw as TripBudgetTier;
}

/** The identity fields shared by create and patch, each independently optional. */
function readTripFields(body: Record<string, unknown>): TripPatchRequest {
  const req: TripPatchRequest = {};
  const name = optionalString(body, "name", { maxLen: 120, label: "name" });
  if (name !== undefined) req.name = name;
  const destination = optionalString(body, "destination", { maxLen: 200, label: "destination" });
  if (destination !== undefined) req.destination = destination;
  const when = parseWhen(body);
  if (when !== undefined) req.when = when;
  const who = parseWho(body);
  if (who !== undefined) req.who = who;
  const budget = parseBudget(body);
  if (budget !== undefined) req.budget = budget;
  return req;
}

/** Mounted at /api/projects/:projectId/trips — the Project-scoped half. */
export function projectTripsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    return c.json({ trips: await deps.tripService.list(c.var.user.userId, projectId) });
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const body = await readJson(c);
    const trip = await deps.tripService.create(c.var.user.userId, projectId, readTripFields(body));
    return c.json({ trip }, 201);
  });

  return app;
}

/** Mounted at /api/trips — the id-addressed half. */
export function tripsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:tripId", async (c) => {
    const tripId = pathParam(c, "tripId");
    return c.json({ trip: await deps.tripService.get(c.var.user.userId, tripId) });
  });

  app.patch("/:tripId", async (c) => {
    const tripId = pathParam(c, "tripId");
    const body = await readJson(c);
    const fields = readTripFields(body);
    if (Object.keys(fields).length === 0) {
      throw new HttpError(400, "empty_patch", "No trip fields were given to change.");
    }
    return c.json({ trip: await deps.tripService.patch(c.var.user.userId, tripId, fields) });
  });

  app.delete("/:tripId", async (c) => {
    const tripId = pathParam(c, "tripId");
    await deps.tripService.delete(c.var.user.userId, tripId);
    return c.body(null, 204);
  });

  /** The Trip's conversations, newest first — the sidebar card's contents. */
  app.get("/:tripId/sessions", async (c) => {
    const tripId = pathParam(c, "tripId");
    const trip = deps.tripService.requireTrip(c.var.user.userId, tripId);
    return c.json({ sessions: await deps.sessionService.listByTrip(trip.tripId) });
  });

  /**
   * The Trip's itinerary. Read-only on purpose: `itinerary.md` belongs to the model, and this
   * application renders it rather than editing it. A missing file answers 200 with
   * `exists: false` — a journey has no plan until the agent writes one, which is a state to
   * show, not a failure to report.
   */
  app.get("/:tripId/itinerary", async (c) => {
    const tripId = pathParam(c, "tripId");
    const trip = deps.tripService.requireTrip(c.var.user.userId, tripId);
    return c.json(await deps.tripService.readItinerary(trip));
  });

  /**
   * A file from the Trip's own folder — what makes `![map](map.png)` inside `itinerary.md`
   * render on the trip page, and what serves any other artifact the agent leaves there.
   *
   * Reuses the workspace file reader with the Trip's directory as the root, so it inherits
   * that reader's symlink-aware confinement and its rule that scriptable content (html, svg)
   * is served as plain text: files here are agent-generated and are not to be trusted with
   * this origin.
   */
  app.get("/:tripId/file", async (c) => {
    const tripId = pathParam(c, "tripId");
    const trip = deps.tripService.requireTrip(c.var.user.userId, tripId);
    const rel = c.req.query("path") ?? "";
    const { data, fileName, contentType, scriptable } = await deps.workspaceFiles.read(
      trip.dir,
      rel,
    );
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": scriptable ? "text/plain; charset=utf-8" : contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  return app;
}
