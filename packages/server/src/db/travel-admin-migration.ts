/** Explicit product identity upgrade, committed as one transaction without changing ids or paths. */
import type { DatabaseSync } from "node:sqlite";

/** The login id PenguinHarness seeded before travel-agent chose its own. */
export const LEGACY_ADMIN_USER_ID = "admin";
const TARGET_ADMIN_USER_ID = "traveler";

export function migrateTravelAdministrator(db: DatabaseSync): void {
  const source = LEGACY_ADMIN_USER_ID;
  const target = TARGET_ADMIN_USER_ID;
  db.exec("BEGIN IMMEDIATE");
  try {
    // References have no ON UPDATE CASCADE. Check them after all dependent rows move.
    db.exec("PRAGMA defer_foreign_keys = ON");
    const legacy = db.prepare("SELECT is_admin FROM users WHERE user_id = ?").get(source);
    if (legacy?.is_admin === 1) {
      if (db.prepare("SELECT 1 FROM users WHERE user_id = ?").get(target)) {
        throw new Error(
          `Cannot migrate the administrator: a ${target} account already exists. ` +
            "Resolve the account-name conflict before restarting; no accounts were merged.",
        );
      }
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(source);
      for (const [table, column] of [
        ["projects", "owner_user_id"],
        ["project_members", "user_id"],
        ["ui_prefs", "user_id"],
        ["schedule_state", "creator_user_id"],
      ]) {
        db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(target, source);
      }
      // Keep the original identity so a browser that has not visited since can recover its drafts.
      db.prepare(
        "UPDATE users SET user_id = ?, previous_user_id = COALESCE(previous_user_id, ?) WHERE user_id = ?",
      ).run(target, source, source);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
