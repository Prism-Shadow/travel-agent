/**
 * Trip route tests.
 *
 * The load-bearing assertion here is the one in "re-homing never touches the workspace":
 * the whole reason a Trip is an entity that owns a directory, rather than being a Workspace
 * directory, is that membership has to change over a conversation's life while `workspace`
 * cannot — it is fixed at Session creation, recorded in the append-only Trace, and memory
 * scope is derived from it. If that test ever fails, the design has been undone.
 *
 * The rest covers what a route can get wrong: authorization (a Trip is Project-scoped and
 * invisible outside it), the absent-vs-null distinction that lets a patch clear one field
 * without blanking the others, directory allocation and its collision suffix, and the
 * deletion contract — the row goes, the conversations survive as floating, the person's
 * files stay on disk.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionResponse, TripResponse, TripsResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { tripDirBasename } from "../src/services/trip-service.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("trips", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;

  const sessionRow = (sessionId: string, overrides: Partial<SessionRow> = {}): SessionRow => ({
    sessionId,
    projectId,
    agentId: "default_agent",
    provider: "custom",
    modelId: "m1",
    workspace: "/tmp/some-workspace",
    approvalMode: "always-ask",
    title: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  const createTrip = async (body: Record<string, unknown> = {}) => {
    const res = await api.post(`/api/projects/${projectId}/trips`, body);
    expect(res.status).toBe(201);
    return ((await res.json()) as TripResponse).trip;
  };

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "tripper");
    api = apiClient(t.app, cookie);
    projectId = "tripper-default_project";
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("creates a trip with a directory, a trip.json mirror, and a name from the destination", async () => {
    const trip = await createTrip({
      destination: "Tokyo",
      when: { kind: "flexible", days: 5, months: ["2026-10"] },
      who: { adults: 2, children: 0, infants: 0 },
      budget: "mid",
    });

    expect(trip.name).toBe("Tokyo");
    expect(trip.destination).toBe("Tokyo");
    expect(trip.when).toEqual({ kind: "flexible", days: 5, months: ["2026-10"] });
    expect(trip.who).toEqual({ adults: 2, children: 0, infants: 0, pets: 0 });
    expect(trip.budget).toBe("mid");
    expect(trip.dirExists).toBe(true);
    expect(path.basename(trip.dir)).toBe("tokyo-2026-10");

    const mirror = JSON.parse(await fs.readFile(path.join(trip.dir, "trip.json"), "utf8"));
    expect(mirror).toMatchObject({
      version: 2,
      tripId: trip.tripId,
      name: "Tokyo",
      destination: "Tokyo",
      budget: "mid",
    });
  });

  it("persists shared notes, mirrors edits and clears them without changing other identity", async () => {
    const trip = await createTrip({
      destination: "Kyoto",
      notes: "Quiet rooms.\nKeep afternoons free.",
    });
    expect(trip.notes).toBe("Quiet rooms.\nKeep afternoons free.");
    const read = async () =>
      ((await (await api.get(`/api/trips/${trip.tripId}`)).json()) as TripResponse).trip;
    const mirror = async () =>
      JSON.parse(await fs.readFile(path.join(trip.dir, "trip.json"), "utf8"));
    expect((await mirror()).notes).toBe(trip.notes);
    await api.patch(`/api/trips/${trip.tripId}`, { name: "Autumn" });
    expect((await read()).notes).toBe(trip.notes);
    await api.patch(`/api/trips/${trip.tripId}`, { notes: "Near a station" });
    expect((await mirror()).notes).toBe("Near a station");
    await api.patch(`/api/trips/${trip.tripId}`, { notes: "" });
    expect(await read()).toMatchObject({ notes: "", destination: "Kyoto", name: "Autumn" });
    expect((await mirror()).notes).toBe("");
    for (const notes of [42, {}, "x".repeat(8001)]) {
      expect((await api.patch(`/api/trips/${trip.tripId}`, { notes })).status).toBe(400);
    }
    expect((await createTrip()).notes).toBe("");
  });

  it("reads rows written in the retired shapes as today's shapes", async () => {
    // Before 2026-08-30, flexible `when` carried one `month: string` and `who` had no `pets`.
    // Dev databases hold such rows; they must translate on read, not crash the sidebar's
    // meta line (`when.months.join`) or degrade to "not set".
    const trip = await createTrip({ destination: "Kyoto" });
    t.deps.db
      .prepare("UPDATE trips SET when_json = ?, who_json = ? WHERE trip_id = ?")
      .run(
        JSON.stringify({ kind: "flexible", days: 5, month: "2026-10" }),
        JSON.stringify({ adults: 2, children: 1, infants: 0 }),
        trip.tripId,
      );

    const res = await api.get(`/api/trips/${trip.tripId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TripResponse;
    expect(body.trip.when).toEqual({ kind: "flexible", days: 5, months: ["2026-10"] });
    expect(body.trip.who).toEqual({ adults: 2, children: 1, infants: 0, pets: 0 });
  });

  it("stores, patches and validates the whole-trip amount together with its currency", async () => {
    const trip = await createTrip({
      destination: "Kyoto",
      budgetAmount: 20000,
      budgetCurrency: "CNY",
    });
    expect(trip.budgetAmount).toBe(20000);
    expect(trip.budgetCurrency).toBe("CNY");

    // Fractions truncate to whole units; the field is a statement, not accounting. The unit
    // the row already holds carries over when only the amount is patched.
    const patched = await api.patch(`/api/trips/${trip.tripId}`, { budgetAmount: 8000.9 });
    const afterPatch = ((await patched.json()) as TripResponse).trip;
    expect(afterPatch.budgetAmount).toBe(8000);
    expect(afterPatch.budgetCurrency).toBe("CNY");

    const swapped = await api.patch(`/api/trips/${trip.tripId}`, { budgetCurrency: "USD" });
    expect(((await swapped.json()) as TripResponse).trip.budgetCurrency).toBe("USD");

    // Clearing the amount clears its unit: a currency with nothing to measure is noise.
    const cleared = await api.patch(`/api/trips/${trip.tripId}`, { budgetAmount: null });
    const afterClear = ((await cleared.json()) as TripResponse).trip;
    expect(afterClear.budgetAmount).toBeNull();
    expect(afterClear.budgetCurrency).toBeNull();

    // An amount never enters without its unit — nothing implies one any more.
    expect((await api.patch(`/api/trips/${trip.tripId}`, { budgetAmount: 5000 })).status).toBe(400);
    expect(
      (await api.post(`/api/projects/${projectId}/trips`, { budgetAmount: 5000 })).status,
    ).toBe(400);

    for (const bad of [0, -1, 100_000_000, "20000", true]) {
      const res = await api.patch(`/api/trips/${trip.tripId}`, {
        budgetAmount: bad,
        budgetCurrency: "CNY",
      });
      expect(res.status, `budgetAmount=${String(bad)}`).toBe(400);
    }
    for (const bad of ["cny", "RMB", "", 7]) {
      const res = await api.patch(`/api/trips/${trip.tripId}`, {
        budgetAmount: 5000,
        budgetCurrency: bad,
      });
      expect(res.status, `budgetCurrency=${String(bad)}`).toBe(400);
    }
  });

  it("creates a trip from nothing: no destination, no dates, an honest name", async () => {
    const trip = await createTrip({});
    expect(trip.name).toBe("Untitled trip");
    expect(trip.destination).toBe("");
    expect(trip.when).toBeNull();
    expect(trip.who).toBeNull();
    expect(trip.budget).toBeNull();
    expect(trip.dirExists).toBe(true);
  });

  it("gives two trips to the same place separate directories", async () => {
    const first = await createTrip({ destination: "Kyoto" });
    const second = await createTrip({ destination: "Kyoto" });
    expect(first.dir).not.toBe(second.dir);
    expect(path.basename(second.dir)).toBe("kyoto-2");
  });

  it("reports a filesystem failure without creating a Trip or replacing the blocking file", async () => {
    const root = path.join(t.root, "trips");
    await fs.writeFile(root, "Keep this file");
    const response = await api.post(`/api/projects/${projectId}/trips`, { destination: "Kyoto" });
    expect(response.status).toBe(500);
    expect(await fs.readFile(root, "utf8")).toBe("Keep this file");
    const listed = (await (
      await api.get(`/api/projects/${projectId}/trips`)
    ).json()) as TripsResponse;
    expect(listed.trips).toEqual([]);
  });

  it.each([
    { destination: "" },
    { destination: "Kyoto", when: { kind: "dates", start: "2026-10-01", end: "2026-10-05" } },
  ])("allocates concurrent trips beyond 50 occupied names: %j", async (body) => {
    const first = await createTrip(body);
    const root = path.dirname(first.dir);
    const basename = path.basename(first.dir);
    const occupied = Array.from({ length: 50 }, (_, i) =>
      path.join(root, i === 0 ? basename : `${basename}-${i + 1}`),
    );
    for (const dir of occupied) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "keep.txt"), "Existing travel notes");
    }
    const created = await Promise.all(Array.from({ length: 3 }, () => createTrip(body)));
    expect(new Set(created.map((trip) => trip.dir)).size).toBe(3);
    for (const trip of created) {
      expect(occupied).not.toContain(trip.dir);
      const mirror = JSON.parse(await fs.readFile(path.join(trip.dir, "trip.json"), "utf8"));
      expect(mirror.tripId).toBe(trip.tripId);
    }
    for (const dir of occupied) {
      expect(await fs.readFile(path.join(dir, "keep.txt"), "utf8")).toBe("Existing travel notes");
    }
  });

  it("names the folder for the destination the sender stated, not the day they clicked", async () => {
    // The flow this pins: "new trip" writes nothing, and the first message creates the trip
    // from the chips — so a destination is known by then and the folder can be named for it.
    // Creating first and asking later produced `trip-<date>` every time, because at click
    // time there is nothing to name it after.
    const trip = await createTrip({
      destination: "Kyoto",
      when: { kind: "dates", start: "2026-11-03", end: "2026-11-08" },
    });
    expect(path.basename(trip.dir)).toBe("kyoto-2026-11");
    expect(trip.name).toBe("Kyoto");
  });

  it("still accepts a trip created knowing nothing, and says so honestly", async () => {
    // Sending without filling a single chip is a real thing to do; it is not junk, and it is
    // not pretended to be more than it is.
    const trip = await createTrip({ destination: "", when: null, who: null, budget: null });
    expect(trip.name).toBe("Untitled trip");
    expect(path.basename(trip.dir)).toMatch(/^trip-\d{4}-\d{2}-\d{2}$/);
  });

  it("names the directory by date when the destination yields no ASCII slug", () => {
    const at = new Date("2026-10-12T00:00:00Z");
    expect(tripDirBasename("东京", null, at)).toBe("trip-2026-10-12");
    expect(tripDirBasename("", null, at)).toBe("trip-2026-10-12");
    expect(tripDirBasename("Tokyo", { kind: "dates", start: "2026-10-12", end: "" }, at)).toBe(
      "tokyo-2026-10",
    );
  });

  it("patches only the fields present, and null clears one field alone", async () => {
    const trip = await createTrip({
      destination: "Osaka",
      who: { adults: 2, children: 1, infants: 0 },
      budget: "high",
    });

    const renamed = await api.patch(`/api/trips/${trip.tripId}`, { name: "Family trip" });
    expect(renamed.status).toBe(200);
    const afterRename = ((await renamed.json()) as TripResponse).trip;
    expect(afterRename.name).toBe("Family trip");
    // Omitted keys survive a patch.
    expect(afterRename.budget).toBe("high");
    expect(afterRename.who).toEqual({ adults: 2, children: 1, infants: 0, pets: 0 });

    const cleared = await api.patch(`/api/trips/${trip.tripId}`, { budget: null });
    const afterClear = ((await cleared.json()) as TripResponse).trip;
    expect(afterClear.budget).toBeNull();
    // Clearing one field left the others alone.
    expect(afterClear.name).toBe("Family trip");
    expect(afterClear.who).toEqual({ adults: 2, children: 1, infants: 0, pets: 0 });

    // The mirror follows the row.
    const mirror = JSON.parse(await fs.readFile(path.join(trip.dir, "trip.json"), "utf8"));
    expect(mirror).toMatchObject({ name: "Family trip", budget: null });
  });

  it("rejects a patch with no fields, and malformed identity values", async () => {
    const trip = await createTrip({ destination: "Nara" });
    expect((await api.patch(`/api/trips/${trip.tripId}`, {})).status).toBe(400);
    expect((await api.patch(`/api/trips/${trip.tripId}`, { budget: "cheap" })).status).toBe(400);
    expect(
      (await api.patch(`/api/trips/${trip.tripId}`, { when: { kind: "dates", start: "10/12" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await api.patch(`/api/trips/${trip.tripId}`, {
          who: { adults: -1, children: 0, infants: 0 },
        })
      ).status,
    ).toBe(400);
    expect(
      (await api.patch(`/api/trips/${trip.tripId}`, { when: { kind: "someday" } })).status,
    ).toBe(400);
  });

  it("lists a project's trips newest first, and hides them from other users", async () => {
    // Created back to back on purpose: these two land in the same millisecond, so this also
    // pins the tie-break. Ordering by trip id here would shuffle the sidebar between reads,
    // because a trip id is random; insertion order is what "newest first" has to mean.
    await createTrip({ destination: "Sapporo" });
    await createTrip({ destination: "Fukuoka" });

    const mine = (await (
      await api.get(`/api/projects/${projectId}/trips`)
    ).json()) as TripsResponse;
    expect(mine.trips.map((x) => x.destination)).toEqual(["Fukuoka", "Sapporo"]);

    const { cookie } = await provisionUser(t.app, "outsider");
    const outsider = apiClient(t.app, cookie);
    expect((await outsider.get(`/api/projects/${projectId}/trips`)).status).toBe(404);
    expect((await outsider.get(`/api/trips/${mine.trips[0]!.tripId}`)).status).toBe(404);
    expect(
      (await outsider.patch(`/api/trips/${mine.trips[0]!.tripId}`, { name: "x" })).status,
    ).toBe(404);
    expect((await outsider.delete(`/api/trips/${mine.trips[0]!.tripId}`)).status).toBe(404);
  });

  it("re-homing never touches the workspace", async () => {
    const first = await createTrip({ destination: "Tokyo" });
    const second = await createTrip({ destination: "Kyoto" });
    const row = sessionRow("s-rehome", { workspace: "/tmp/fixed-workspace" });
    t.deps.sessionsRepo.insert(row);

    // Floating to begin with.
    expect(t.deps.sessionsRepo.findById("s-rehome")?.tripId).toBeNull();

    const attach = await api.put("/api/sessions/s-rehome/trip", { tripId: first.tripId });
    expect(attach.status).toBe(200);
    expect(((await attach.json()) as SessionResponse).session.tripId).toBe(first.tripId);

    await api.put("/api/sessions/s-rehome/trip", { tripId: second.tripId });
    expect(t.deps.sessionsRepo.findById("s-rehome")?.tripId).toBe(second.tripId);

    const detach = await api.put("/api/sessions/s-rehome/trip", { tripId: null });
    expect(detach.status).toBe(200);
    expect(t.deps.sessionsRepo.findById("s-rehome")?.tripId).toBeNull();

    // The point of the whole design: through attach, move and detach, the workspace — which
    // the engine fixed at creation and derives memory scope from — never moved.
    expect(t.deps.sessionsRepo.findById("s-rehome")?.workspace).toBe("/tmp/fixed-workspace");
  });

  it("rejects re-homing to an unknown trip, a malformed body, and another user's trip", async () => {
    t.deps.sessionsRepo.insert(sessionRow("s-guard"));
    expect((await api.put("/api/sessions/s-guard/trip", {})).status).toBe(400);
    expect((await api.put("/api/sessions/s-guard/trip", { tripId: 7 })).status).toBe(400);
    expect((await api.put("/api/sessions/s-guard/trip", { tripId: "t-nope" })).status).toBe(404);

    const { cookie } = await provisionUser(t.app, "other");
    const other = apiClient(t.app, cookie);
    const foreign = (
      (await (
        await other.post("/api/projects/other-default_project/trips", {})
      ).json()) as TripResponse
    ).trip;
    // Visible to neither: this user cannot see that Trip at all.
    expect((await api.put("/api/sessions/s-guard/trip", { tripId: foreign.tripId })).status).toBe(
      404,
    );
    expect(t.deps.sessionsRepo.findById("s-guard")?.tripId).toBeNull();
  });

  it("rejects creating a conversation in a trip the caller cannot open", async () => {
    const { cookie } = await provisionUser(t.app, "stranger");
    const stranger = apiClient(t.app, cookie);
    const created = await stranger.post("/api/projects/stranger-default_project/trips", {});
    const foreign = ((await created.json()) as TripResponse).trip;

    const res = await api.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {
      tripId: foreign.tripId,
    });
    // 404 rather than 403: a trip in another Project is not something to be told about.
    expect(res.status).toBe(404);

    const unknown = await api.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {
      tripId: "t-nope",
    });
    expect(unknown.status).toBe(404);
  });

  it("lists a trip's conversations, newest first", async () => {
    const trip = await createTrip({ destination: "Hakone" });
    t.deps.sessionsRepo.insert(
      sessionRow("s-old", { tripId: trip.tripId, createdAt: "2026-08-01T00:00:00.000Z" }),
    );
    t.deps.sessionsRepo.insert(
      sessionRow("s-new", { tripId: trip.tripId, createdAt: "2026-08-02T00:00:00.000Z" }),
    );
    t.deps.sessionsRepo.insert(sessionRow("s-floating"));

    const res = await api.get(`/api/trips/${trip.tripId}/sessions`);
    expect(res.status).toBe(200);
    const { sessions } = (await res.json()) as { sessions: { sessionId: string }[] };
    expect(sessions.map((s) => s.sessionId)).toEqual(["s-new", "s-old"]);
  });

  it("serves the itinerary the agent wrote, and reports its absence as a state", async () => {
    const trip = await createTrip({ destination: "Kanazawa" });

    // A journey has no plan until the agent writes one: absence is 200 + exists:false, not a
    // 404 the page would have to render as a failure.
    const before = await api.get(`/api/trips/${trip.tripId}/itinerary`);
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ exists: false, markdown: "" });

    await fs.writeFile(path.join(trip.dir, "itinerary.md"), "# Day 1\n\nKenroku-en\n", "utf8");
    const after = await api.get(`/api/trips/${trip.tripId}/itinerary`);
    const body = (await after.json()) as { exists: boolean; markdown: string; updatedAt?: string };
    expect(body.exists).toBe(true);
    expect(body.markdown).toBe("# Day 1\n\nKenroku-en\n");
    expect(body.updatedAt).toBeTypeOf("string");
  });

  it("reports a missing folder's itinerary as absent rather than failing", async () => {
    const trip = await createTrip({ destination: "Toyama" });
    await fs.rm(trip.dir, { recursive: true, force: true });
    const res = await api.get(`/api/trips/${trip.tripId}/itinerary`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ exists: false });
  });

  it("serves a file from the trip folder, and refuses to escape it", async () => {
    const trip = await createTrip({ destination: "Sendai" });
    await fs.writeFile(path.join(trip.dir, "map.png"), "not-really-a-png", "utf8");

    const ok = await api.get(`/api/trips/${trip.tripId}/file?path=map.png`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("not-really-a-png");

    // The folder is the boundary: an agent-written document naming a path outside it gets
    // nothing, whichever way it spells the escape.
    expect((await api.get(`/api/trips/${trip.tripId}/file?path=../trip.json`)).status).not.toBe(
      200,
    );
    expect((await api.get(`/api/trips/${trip.tripId}/file?path=/etc/hosts`)).status).not.toBe(200);
    expect((await api.get(`/api/trips/${trip.tripId}/file?path=missing.png`)).status).toBe(404);
  });

  it("does not serve another user's trip files", async () => {
    const trip = await createTrip({ destination: "Aomori" });
    await fs.writeFile(path.join(trip.dir, "map.png"), "x", "utf8");
    const { cookie } = await provisionUser(t.app, "peeker");
    expect(
      (await apiClient(t.app, cookie).get(`/api/trips/${trip.tripId}/file?path=map.png`)).status,
    ).toBe(404);
  });

  it("does not serve another user's itinerary", async () => {
    const trip = await createTrip({ destination: "Matsumoto" });
    const { cookie } = await provisionUser(t.app, "nosy");
    expect((await apiClient(t.app, cookie).get(`/api/trips/${trip.tripId}/itinerary`)).status).toBe(
      404,
    );
  });

  it("deleting a trip that was never used leaves no empty folder behind", async () => {
    // The rollback path: a send that fails after the trip was created deletes it, and the
    // folder must go with it. Otherwise every failed send leaves a husk holding one file
    // nothing references — the junk this whole flow was rearranged to stop producing.
    const trip = await createTrip({ destination: "Kanazawa" });
    expect(await fs.readdir(trip.dir)).toEqual(["trip.json"]);

    expect((await api.delete(`/api/trips/${trip.tripId}`)).status).toBe(204);
    await expect(fs.stat(trip.dir)).rejects.toThrow();
  });

  it("keeps the folder when anything but our own trip.json is in it", async () => {
    // Even a file nobody recognizes means hands off: erring towards keeping a folder costs
    // an empty directory, erring the other way costs someone's trip.
    const trip = await createTrip({ destination: "Takayama" });
    await fs.writeFile(path.join(trip.dir, ".DS_Store"), "", "utf8");

    expect((await api.delete(`/api/trips/${trip.tripId}`)).status).toBe(204);
    expect(await fs.readdir(trip.dir)).toContain(".DS_Store");
  });

  it("deleting a trip detaches its conversations and leaves the person's files alone", async () => {
    const trip = await createTrip({ destination: "Nikko" });
    t.deps.sessionsRepo.insert(sessionRow("s-kept", { tripId: trip.tripId }));
    await fs.writeFile(path.join(trip.dir, "itinerary.md"), "# Day 1\n", "utf8");

    expect((await api.delete(`/api/trips/${trip.tripId}`)).status).toBe(204);

    expect((await api.get(`/api/trips/${trip.tripId}`)).status).toBe(404);
    // The conversation survives as a floating one.
    const kept = t.deps.sessionsRepo.findById("s-kept");
    expect(kept).not.toBeNull();
    expect(kept?.tripId).toBeNull();
    // The directory and its contents are the person's, and are never deleted.
    expect(await fs.readFile(path.join(trip.dir, "itinerary.md"), "utf8")).toBe("# Day 1\n");
  });

  it("reports a directory the person moved away as missing, without hiding the trip", async () => {
    const trip = await createTrip({ destination: "Otaru" });
    await fs.rm(trip.dir, { recursive: true, force: true });

    const res = await api.get(`/api/trips/${trip.tripId}`);
    expect(res.status).toBe(200);
    const after = ((await res.json()) as TripResponse).trip;
    expect(after.dirExists).toBe(false);
    expect(after.dir).toBe(trip.dir);

    // A rename still succeeds: the row is the source of truth, and the mirror write is
    // best-effort precisely so a moved folder cannot brick the trip in the app.
    const renamed = await api.patch(`/api/trips/${trip.tripId}`, { name: "Otaru winter" });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as TripResponse).trip.name).toBe("Otaru winter");
  });

  // The agent may fill a destination the chips left blank, and may never overwrite one the
  // person gave. Both halves are asserted here because the safety of the whole arrangement is
  // the second half: a model that misreads a sentence can only ever fill in an empty field.
  const writeMirror = async (dir: string, patch: Record<string, unknown>) => {
    const file = path.join(dir, "trip.json");
    const body = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    await fs.writeFile(file, `${JSON.stringify({ ...body, ...patch }, null, 2)}\n`, "utf8");
  };

  it("adopts a destination the agent wrote into a blank one, and renames an untitled trip", async () => {
    const trip = await createTrip({});
    expect(trip.name).toBe("Untitled trip");
    expect(trip.destination).toBe("");

    await writeMirror(trip.dir, { destination: "Shanghai" });

    const res = await api.get(`/api/trips/${trip.tripId}`);
    expect(res.status).toBe(200);
    const after = ((await res.json()) as TripResponse).trip;
    expect(after.destination).toBe("Shanghai");
    expect(after.name).toBe("Shanghai");

    // Adoption writes through to the row, so a second read is not a second adoption.
    const mirror = JSON.parse(await fs.readFile(path.join(trip.dir, "trip.json"), "utf8")) as {
      destination: string;
      name: string;
    };
    expect(mirror.destination).toBe("Shanghai");
    expect(mirror.name).toBe("Shanghai");
  });

  it("never lets the agent overwrite a destination or a name the person gave", async () => {
    const trip = await createTrip({ destination: "Kyoto", name: "Autumn in Kyoto" });

    await writeMirror(trip.dir, { destination: "Osaka", name: "Osaka trip" });

    const res = await api.get(`/api/trips/${trip.tripId}`);
    const after = ((await res.json()) as TripResponse).trip;
    expect(after.destination, "the person's destination stands").toBe("Kyoto");
    expect(after.name, "and so does their name").toBe("Autumn in Kyoto");
  });

  it("keeps a name the person chose even while adopting a blank destination", async () => {
    const trip = await createTrip({ name: "Business trip" });
    expect(trip.destination).toBe("");

    await writeMirror(trip.dir, { destination: "Shanghai" });

    const after = ((await (await api.get(`/api/trips/${trip.tripId}`)).json()) as TripResponse)
      .trip;
    expect(after.destination, "the blank is filled").toBe("Shanghai");
    expect(after.name, "but a name they chose is not a blank").toBe("Business trip");
  });

  it("refuses to adopt when the person answered while the mirror was being read", async () => {
    const trip = await createTrip({});
    await writeMirror(trip.dir, { destination: "Shanghai" });

    // The race the re-read closes: adoption captures the row, awaits the file, and only then
    // writes. A PATCH landing inside that window is the person answering for themselves, and the
    // earlier snapshot must not be allowed to win. Issuing both without awaiting the first is
    // what puts the PATCH inside the read.
    const [, patched] = await Promise.all([
      api.get(`/api/trips/${trip.tripId}`),
      api.patch(`/api/trips/${trip.tripId}`, { destination: "Kyoto" }),
    ]);
    expect(patched.status).toBe(200);

    const after = ((await (await api.get(`/api/trips/${trip.tripId}`)).json()) as TripResponse)
      .trip;
    expect(after.destination, "the person's answer stands").toBe("Kyoto");
  });

  it("adopts through the project list as well as a single get", async () => {
    const trip = await createTrip({});
    await writeMirror(trip.dir, { destination: "Nara" });

    const body = (await (
      await api.get(`/api/projects/${projectId}/trips`)
    ).json()) as TripsResponse;
    const listed = body.trips.find((t) => t.tripId === trip.tripId);
    expect(listed?.destination).toBe("Nara");
    expect(listed?.name).toBe("Nara");
  });

  it("adopts the destination and nothing else, however much the mirror claims", async () => {
    const trip = await createTrip({});
    await writeMirror(trip.dir, {
      destination: "Osaka",
      when: { kind: "dates", start: "2027-01-01", end: "2027-01-09" },
      who: { adults: 9, children: 9 },
      budget: "high",
      tripId: "t-somebody-elses",
    });

    const after = ((await (await api.get(`/api/trips/${trip.tripId}`)).json()) as TripResponse)
      .trip;
    expect(after.destination, "the one field it may write").toBe("Osaka");
    expect(after.when, "dates are a commitment, not an observation").toBeNull();
    expect(after.who).toBeNull();
    expect(after.budget).toBeNull();
    expect(after.tripId, "identity is not the mirror's to claim").toBe(trip.tripId);
  });

  it("ignores a mirror that is missing, unreadable or not JSON", async () => {
    const trip = await createTrip({});
    await fs.writeFile(path.join(trip.dir, "trip.json"), "not json at all", "utf8");
    const after = ((await (await api.get(`/api/trips/${trip.tripId}`)).json()) as TripResponse)
      .trip;
    expect(after.destination).toBe("");
    expect(after.name).toBe("Untitled trip");

    // A missing mirror is the ordinary case for a folder the person moved, and it has to read as
    // "nothing to adopt" rather than as an error.
    const gone = await createTrip({});
    await fs.rm(path.join(gone.dir, "trip.json"));
    const stillBlank = ((await (await api.get(`/api/trips/${gone.tripId}`)).json()) as TripResponse)
      .trip;
    expect(stillBlank.destination).toBe("");
  });
});
