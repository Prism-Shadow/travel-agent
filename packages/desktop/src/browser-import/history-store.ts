/**
 * The in-app browser's history, which until now it did not have.
 *
 * The pane has always had per-tab back/forward — that is Chromium's, held in the `WebContents` —
 * but nothing that outlives a tab. Importing browsing history therefore needs somewhere to put it,
 * and the address bar needs somewhere to read suggestions from. This is both.
 *
 * **SQLite, not JSON.** The other stores in this feature are small enough to rewrite whole; history
 * is tens of thousands of rows and is queried on every keystroke in the address bar. `node:sqlite`
 * is already a dependency-free builtin here (`packages/server/src/db/database.ts` uses it the same
 * way), an indexed `LIKE` prefix query stays fast at that size, and the alternative — parsing a
 * 20MB JSON file to answer a three-character prefix — is not one.
 *
 * **Not encrypted, and that is a decision rather than an oversight.** It is a real question, since
 * a history is a sensitive thing to leave on a disk. Three reasons it is stored in the clear:
 * the file lives in the app's own userData directory with the same protection as every other thing
 * there; the entire feature exists to serve keystroke-latency prefix queries, which an encrypted
 * store cannot do without decrypting the whole index; and — decisively — the thing a history would
 * be encrypted *against* is another process running as the same user, a threat the vault already
 * does not defend against either. What would be gained is the appearance
 * of protection. Passwords are different, are in `credential-store.ts`, and are encrypted.
 *
 * What the agent may see: **nothing here, by default**. History is for the person's address bar.
 * No tool reads this store, and adding one would be a privacy decision with a grant attached, not
 * a convenience.
 */
import fs from "node:fs";
import path from "node:path";

function sqlite(): typeof import("node:sqlite") {
  return process.getBuiltinModule("node:sqlite");
}

/** One entry, as the address bar wants it. */
export interface HistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  lastVisitedAt: string | null;
}

export interface HistoryStoreOptions {
  filePath: string;
  now?: () => Date;
}

export class HistoryStore {
  private readonly options: HistoryStoreOptions;
  private db: import("node:sqlite").DatabaseSync | null = null;

  constructor(options: HistoryStoreOptions) {
    this.options = options;
  }

  private handle(): import("node:sqlite").DatabaseSync {
    if (this.db !== null) return this.db;
    fs.mkdirSync(path.dirname(this.options.filePath), { recursive: true });
    const db = new (sqlite().DatabaseSync)(this.options.filePath);
    // WAL so a long import does not block the address bar's reads, and so a crash mid-import
    // leaves a consistent file rather than a half-written page.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS visits (
        url TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        visit_count INTEGER NOT NULL DEFAULT 1,
        last_visited_at TEXT,
        source TEXT NOT NULL DEFAULT 'local'
      );
      CREATE INDEX IF NOT EXISTS visits_recent ON visits (last_visited_at DESC);
    `);
    this.db = db;
    return db;
  }

  /**
   * Records a visit the person made in the pane.
   *
   * Upserts on URL and *adds* to the visit count, so a page opened ten times ranks above one opened
   * once — which is the whole basis of a useful address bar. `MAX` on the timestamp so that
   * importing older history after live browsing cannot move a page's last-visited time backwards.
   */
  record(input: { url: string; title?: string; at?: Date }): void {
    const at = (input.at ?? this.options.now?.() ?? new Date()).toISOString();
    this.handle()
      .prepare(
        `INSERT INTO visits (url, title, visit_count, last_visited_at, source)
         VALUES (?, ?, 1, ?, 'local')
         ON CONFLICT(url) DO UPDATE SET
           title = CASE WHEN excluded.title != '' THEN excluded.title ELSE visits.title END,
           visit_count = visits.visit_count + 1,
           last_visited_at = MAX(COALESCE(visits.last_visited_at, ''), excluded.last_visited_at)`,
      )
      .run(input.url, input.title ?? "", at);
  }

  /**
   * Adds imported entries in one transaction.
   *
   * A transaction rather than a loop of writes because twenty thousand individual commits is tens
   * of seconds of fsync; inside one it is well under a second. On conflict the *larger* visit count
   * wins rather than the sum: importing the same Chrome profile twice should not make every page
   * look twice as popular as it is.
   */
  importMany(entries: Iterable<HistoryEntry>, source: string): number {
    const db = this.handle();
    const insert = db.prepare(
      `INSERT INTO visits (url, title, visit_count, last_visited_at, source)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         title = CASE WHEN excluded.title != '' THEN excluded.title ELSE visits.title END,
         visit_count = MAX(visits.visit_count, excluded.visit_count),
         last_visited_at = MAX(COALESCE(visits.last_visited_at, ''), COALESCE(excluded.last_visited_at, ''))`,
    );
    let written = 0;
    db.exec("BEGIN");
    try {
      for (const entry of entries) {
        if (entry.url === "") continue;
        insert.run(entry.url, entry.title, entry.visitCount, entry.lastVisitedAt, source);
        written += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return written;
  }

  /**
   * Address-bar suggestions for what the person has typed.
   *
   * Ranked by visit count then recency, which is the ordering every browser's omnibox uses and the
   * reason a site visited daily beats one visited once last night. The match is a substring rather
   * than a prefix so that typing `ctrip` finds `https://www.ctrip.com` — a prefix match against the
   * full URL would require the person to type `https://` first, which nobody does.
   */
  suggest(query: string, limit = 8): HistoryEntry[] {
    const trimmed = query.trim();
    if (trimmed === "") return [];
    const pattern = `%${trimmed.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    const rows = this.handle()
      .prepare(
        `SELECT url, title, visit_count, last_visited_at FROM visits
         WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
         ORDER BY visit_count DESC, last_visited_at DESC
         LIMIT ?`,
      )
      .all(pattern, pattern, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      url: String(row.url),
      title: String(row.title ?? ""),
      visitCount: Number(row.visit_count ?? 0),
      lastVisitedAt: row.last_visited_at === null ? null : String(row.last_visited_at),
    }));
  }

  get size(): number {
    const row = this.handle().prepare("SELECT COUNT(*) AS n FROM visits").get() as { n?: unknown };
    return Number(row?.n ?? 0);
  }

  /** Forgets everything. Paired with the pane's existing "clear browser data". */
  clear(): number {
    const removed = this.size;
    this.handle().exec("DELETE FROM visits");
    return removed;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
