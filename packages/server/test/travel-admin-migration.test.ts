import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCHEMA_SQL } from "../src/db/schema.js";
import { openDatabase } from "../src/db/database.js";
import { hashPassword } from "../src/auth/password.js";
import { buildAppDeps, createApp } from "../src/app.js";
import { apiClient, loginUser, testConfig } from "./helpers.js";

const sqlite = process.getBuiltinModule("node:sqlite");
const NOW = "2026-01-01T00:00:00.000Z";
let root: string;
let dbPath: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "travel-admin-upgrade-"));
  dbPath = path.join(root, "web.db");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seedLegacy(
  initial = false,
  source: "admin" | "travel" = "admin",
  previous?: "admin",
) {
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  if (source === "admin") db.exec("ALTER TABLE users DROP COLUMN previous_user_id");
  const hash = await hashPassword("existing-password");
  const insertUser = db.prepare(
    "INSERT INTO users (user_id, password_hash, is_admin, password_is_initial, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  insertUser.run(source, hash, 1, initial ? 1 : 0, NOW);
  insertUser.run("alice", hash, 0, 0, NOW);
  if (previous)
    db.prepare("UPDATE users SET previous_user_id=? WHERE user_id=?").run(previous, source);
  db.exec(`
    INSERT INTO projects VALUES ('default_project', '${source}', '${NOW}');
    INSERT INTO projects VALUES ('alice-project', 'alice', '${NOW}');
    INSERT INTO project_members VALUES ('alice-project', '${source}', '${NOW}');
    INSERT INTO project_members VALUES ('default_project', 'alice', '${NOW}');
    INSERT INTO ui_prefs VALUES ('${source}', '{"theme":"dark","lastProjectId":"default_project"}');
    INSERT INTO ui_prefs VALUES ('alice', '{"theme":"light"}');
    INSERT INTO schedule_state (project_id, agent_id, name, creator_user_id, start_at_ms, def_hash)
      VALUES ('default_project', 'default_agent', 'check', '${source}', 1, 'hash');
    INSERT INTO agents VALUES ('default_project', 'default_agent', '${NOW}');
  `);
  db.prepare(
    "INSERT INTO auth_sessions VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', 'password')",
  ).run(createHash("sha256").update("old-cookie").digest("hex"), source, NOW);
  db.prepare(
    "INSERT INTO auth_sessions VALUES ('alice-token', 'alice', ?, '2099-01-01T00:00:00.000Z', 'password')",
  ).run(NOW);
  const tripDir = path.join(root, "trips", "kyoto");
  const workspace = path.join(root, "original-workspace");
  await mkdir(tripDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(tripDir, "itinerary.md"), "# Kyoto\nWalk slowly.\n");
  await writeFile(path.join(workspace, "notes.txt"), "Conversation artifact");
  db.prepare(
    "INSERT INTO trips (trip_id, project_id, name, dir, created_at, updated_at, notes) VALUES ('t-kept', 'default_project', 'Kyoto', ?, ?, ?, 'Quiet hotel')",
  ).run(tripDir, NOW, NOW);
  db.prepare(
    "INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at, trip_id) VALUES ('session-kept', 'default_project', 'default_agent', 'custom', 'model', ?, ?, 't-kept')",
  ).run(workspace, NOW);
  db.close();
  return { hash, tripDir, workspace };
}

describe("traveler administrator upgrade", () => {
  it.each([
    [false, "admin", undefined],
    [true, "admin", undefined],
    [false, "travel", "admin"],
    [true, "travel", undefined],
  ] as const)(
    "preserves account data and password (initial=%s, source=%s, original=%s)",
    async (initial, source, previous) => {
      const before = await seedLegacy(initial, source, previous);
      const deps = buildAppDeps({ ...testConfig(root), dbPath }, { log: () => {} });
      try {
        expect(await deps.authService.seedAdmin()).toBeNull();
        const db = deps.db;
        expect(db.prepare("SELECT * FROM users WHERE user_id = 'admin'").get()).toBeUndefined();
        expect(db.prepare("SELECT * FROM users WHERE user_id = 'travel'").get()).toBeUndefined();
        expect(db.prepare("SELECT * FROM users WHERE user_id = 'traveler'").get()).toMatchObject({
          password_hash: before.hash,
          is_admin: 1,
          password_is_initial: initial ? 1 : 0,
          created_at: NOW,
          previous_user_id: previous ?? source,
        });
        expect(
          db.prepare("SELECT * FROM projects WHERE project_id='default_project'").get(),
        ).toMatchObject({ owner_user_id: "traveler" });
        expect(
          db.prepare("SELECT * FROM project_members WHERE project_id='alice-project'").get(),
        ).toMatchObject({ user_id: "traveler" });
        expect(db.prepare("SELECT * FROM ui_prefs WHERE user_id='traveler'").get()).toMatchObject({
          prefs_json: '{"theme":"dark","lastProjectId":"default_project"}',
        });
        expect(db.prepare("SELECT creator_user_id FROM schedule_state").get()).toMatchObject({
          creator_user_id: "traveler",
        });
        expect(db.prepare("SELECT user_id FROM auth_sessions").all()).toEqual([
          { user_id: "alice" },
        ]);
        expect(
          db.prepare("SELECT * FROM sessions WHERE session_id='session-kept'").get(),
        ).toMatchObject({ workspace: before.workspace, trip_id: "t-kept" });
        expect(db.prepare("SELECT * FROM trips WHERE trip_id='t-kept'").get()).toMatchObject({
          dir: before.tripDir,
          notes: "Quiet hotel",
        });
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(await readFile(path.join(before.tripDir, "itinerary.md"), "utf8")).toBe(
          "# Kyoto\nWalk slowly.\n",
        );
        expect(await readFile(path.join(before.workspace, "notes.txt"), "utf8")).toBe(
          "Conversation artifact",
        );

        const app = createApp(deps);
        const login = await loginUser(app, "traveler", "existing-password");
        expect(login.user).toMatchObject({
          userId: "traveler",
          previousUserId: previous ?? source,
          isAdmin: true,
        });
        expect(deps.authService.authenticateWithMeta("old-cookie")).toBeNull();
        const api = apiClient(app, login.cookie);
        expect((await api.get("/api/admin/users")).status).toBe(200);
        expect(
          deps.projectService.requireProjectOwner("traveler", "default_project").ownerUserId,
        ).toBe("traveler");
        expect(deps.authService.loginDesktop().user.userId).toBe("traveler");
        for (const retired of ["admin", "travel"]) {
          const old = await app.request("/api/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId: retired, password: "existing-password" }),
          });
          expect(old.status).toBe(401);
          expect(
            (await api.post("/api/admin/users", { userId: retired, password: "another-password" }))
              .status,
          ).toBe(400);
        }
        expect(
          (
            await api.put("/api/me/password", {
              oldPassword: "existing-password",
              newPassword: "Travel-updated-2026!",
            })
          ).status,
        ).toBe(204);
        await loginUser(app, "traveler", "Travel-updated-2026!");
      } finally {
        deps.channels.dispose();
        deps.db.close();
      }
      const again = openDatabase(dbPath);
      try {
        expect(again.prepare("SELECT COUNT(*) AS n FROM users").get()?.n).toBe(2);
        expect(
          again.prepare("SELECT password_is_initial FROM users WHERE user_id='traveler'").get()
            ?.password_is_initial,
        ).toBe(0);
        expect(again.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n).toBe(1);
      } finally {
        again.close();
      }
    },
  );

  it.each([
    ["admin", "travel"],
    ["admin", "traveler"],
    ["travel", "traveler"],
  ] as const)(
    "refuses %s -> %s with an occupied target without changing either account",
    async (source, target) => {
      await seedLegacy(false, source);
      const before = new sqlite.DatabaseSync(dbPath);
      before
        .prepare(
          "INSERT INTO users (user_id, password_hash, is_admin, password_is_initial, created_at) VALUES (?, 'unrelated-hash', 0, 0, ?)",
        )
        .run(target, NOW);
      before.close();
      expect(() => openDatabase(dbPath)).toThrow(`${target} account already exists`);
      const after = new sqlite.DatabaseSync(dbPath);
      try {
        expect(
          after.prepare("SELECT password_hash FROM users WHERE user_id=?").get(target)
            ?.password_hash,
        ).toBe("unrelated-hash");
        expect(
          after
            .prepare("SELECT owner_user_id FROM projects WHERE project_id='default_project'")
            .get()?.owner_user_id,
        ).toBe(source);
        expect(
          after.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?").get(source)?.n,
        ).toBe(1);
        expect(
          after.prepare("SELECT previous_user_id FROM users WHERE user_id=?").get(source)
            ?.previous_user_id,
        ).toBeNull();
      } finally {
        after.close();
      }
    },
  );

  it.each(["admin", "travel"] as const)(
    "leaves a non-privileged %s account and its data untouched",
    async (source) => {
      await seedLegacy(false, source);
      const before = new sqlite.DatabaseSync(dbPath);
      before.prepare("UPDATE users SET is_admin = 0 WHERE user_id = ?").run(source);
      before.close();
      const after = openDatabase(dbPath);
      try {
        expect(after.prepare("SELECT * FROM users WHERE user_id='traveler'").get()).toBeUndefined();
        expect(
          after.prepare("SELECT previous_user_id FROM users WHERE user_id=?").get(source)
            ?.previous_user_id,
        ).toBeNull();
        expect(
          after
            .prepare("SELECT owner_user_id FROM projects WHERE project_id='default_project'")
            .get()?.owner_user_id,
        ).toBe(source);
        expect(
          after.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?").get(source)?.n,
        ).toBe(1);
      } finally {
        after.close();
      }
    },
  );

  it("rolls back every update when an account write fails", async () => {
    await seedLegacy();
    const before = new sqlite.DatabaseSync(dbPath);
    before.exec(
      "CREATE TRIGGER reject_rename BEFORE UPDATE OF user_id ON users WHEN NEW.user_id='traveler' BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    before.close();
    expect(() => openDatabase(dbPath)).toThrow(/injected failure/);
    const after = new sqlite.DatabaseSync(dbPath);
    try {
      expect(
        after.prepare("SELECT owner_user_id FROM projects WHERE project_id='default_project'").get()
          ?.owner_user_id,
      ).toBe("admin");
      expect(
        after.prepare("SELECT creator_user_id FROM schedule_state").get()?.creator_user_id,
      ).toBe("admin");
      expect(
        after.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='admin'").get()?.n,
      ).toBe(1);
      expect(after.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      after.close();
    }
  });
});
