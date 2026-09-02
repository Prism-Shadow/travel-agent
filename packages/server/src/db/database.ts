/**
 * SQLite connection & initialization (node:sqlite DatabaseSync).
 *
 * Single process, single writer: a synchronous API is sufficient and avoids a connection
 * pool; WAL mode and foreign key constraints are enabled. Table-creation SQL runs on open
 * (idempotent), with no migration branches (product not yet released).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

// Fetch the runtime module via process.getBuiltinModule (node >=22.3): avoids static
// resolution of `node:sqlite` by bundlers/vite (some tools' builtin lists don't yet
// recognize this experimental module).
const sqlite = process.getBuiltinModule("node:sqlite");

/** Open (creating if necessary) the database: ensure the parent directory exists, set PRAGMAs, run table creation. */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  // Columns added to the schema after a web.db was formed: CREATE TABLE IF NOT EXISTS never
  // touches an existing table, so they are ALTERed in here. Keep the list in sync with
  // schema.ts; drop entries only in a release allowed to break existing web.db files.
  ensureColumn(db, "sessions", "client", "TEXT");
  // No REFERENCES clause: SQLite cannot add a column with a foreign key to an existing
  // table. Fresh databases get the constraint from SCHEMA_SQL; upgraded ones enforce
  // the same rule in TripService, which is the only writer.
  ensureColumn(db, "sessions", "trip_id", "TEXT");
  ensureColumn(db, "trips", "budget_amount", "INTEGER");
  ensureColumn(db, "trips", "budget_currency", "TEXT");
  // A budget used to be a bare number of yuan (`budget_amount_cny`). A row written then still
  // states the fact the person gave, so it is carried over once, with the unit it always had;
  // a row that already has a unit is left alone. The retired column stays in place (this list
  // is additive) and nothing reads or writes it any more.
  if (hasColumn(db, "trips", "budget_amount_cny")) {
    db.exec(
      `UPDATE trips SET budget_amount = budget_amount_cny, budget_currency = 'CNY'
       WHERE budget_amount IS NULL AND budget_amount_cny IS NOT NULL`,
    );
  }
  ensureColumn(db, "sessions", "has_trace", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "auth_sessions", "via", "TEXT");
  ensureColumn(db, "trace_files", "page_stats", "TEXT");
  return db;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

/** Idempotent per-column upgrade for databases formed before the column existed. */
function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  if (hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
