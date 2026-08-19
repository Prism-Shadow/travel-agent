/**
 * Reading the other browser's SQLite files without disturbing them.
 *
 * Everything here copies before it reads. Three reasons, and the third is the one that actually
 * bites:
 *
 * 1. Chrome holds `Cookies` and `History` open. On Windows the lock is mandatory and opening the
 *    original fails outright; on Unix it succeeds and then returns `SQLITE_BUSY` partway through.
 * 2. Opening a live database read-write — which any SQLite handle may do while recovering a hot
 *    journal — can *modify another application's file*. Nothing in an import is worth that risk.
 * 3. **A WAL is not optional to copy.** `Cookies-journal` / `Cookies-wal` holds the most recent
 *    writes, which is to say the freshest session cookies — the exact ones the person is importing
 *    for. Copying only the main file silently imports yesterday's state and looks like a success.
 *
 * So: copy the database *and* its sidecars into a temporary directory, open the copy read-only,
 * read, and delete the copy. The temporary directory is created with `mkdtemp` inside the OS temp
 * root with 0700, and it is removed in a `finally` — a leftover copy of somebody's cookie jar is
 * the worst kind of litter this feature could leave.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  chromeTimeToIso,
  chromeTimeToUnixSeconds,
  ChromeDecryptError,
  decryptValue,
  stripCookieDomainHash,
} from "./chrome-crypto.js";
import type { ChromeKey } from "./chrome-crypto.js";
import type { ImportKind } from "./chrome-profiles.js";

/**
 * `node:sqlite`, reached the way the server already reaches it.
 *
 * `process.getBuiltinModule` rather than a static import because bundlers' builtin lists do not all
 * know `node:sqlite` yet and would try to resolve it from disk — the same reason and the same
 * workaround as `packages/server/src/db/database.ts`.
 */
function sqlite(): typeof import("node:sqlite") {
  return process.getBuiltinModule("node:sqlite");
}

/** SQLite's sidecars. Copied alongside the database, when they exist. */
const SIDECARS = ["-journal", "-wal", "-shm"];

/**
 * Reads a statement's rows with integers as `BigInt`.
 *
 * Not a precaution — a requirement. Chromium timestamps are microseconds since 1601, which puts
 * every real one around 1.3 × 10^16: past `Number.MAX_SAFE_INTEGER`, so `node:sqlite` refuses to
 * narrow them and throws `RangeError: Value is too large to be represented as a JavaScript number`.
 * Every row of every genuine profile carries one. Without this the import does not degrade, it
 * fails outright on the first cookie that has an expiry.
 *
 * The knock-on is that *all* integer columns arrive as `BigInt`, so every consumer below reads them
 * through `Number(...)` — which is correct for the small flags (`is_secure`, `visit_count`) and is
 * why the timestamp helpers take `number | bigint`.
 */
function allBigInt(
  statement: import("node:sqlite").StatementSync,
  ...parameters: unknown[]
): Record<string, unknown>[] {
  statement.setReadBigInts(true);
  return statement.all(...(parameters as never[])) as Record<string, unknown>[];
}

/**
 * Runs `read` against a private copy of `file`, then deletes the copy.
 *
 * The copy is opened read-only. `readonly` is belt-and-braces next to copying — the file is already
 * ours and disposable — but it also stops SQLite from replaying a hot journal into it, which would
 * make the read depend on the state of a journal the source browser may still be writing.
 */
export async function withDatabaseCopy<T>(
  file: string,
  read: (db: import("node:sqlite").DatabaseSync) => T,
): Promise<T> {
  const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penguin-import-"));
  try {
    await fs.promises.chmod(scratch, 0o700);
    const copy = path.join(scratch, path.basename(file));
    await fs.promises.copyFile(file, copy);
    for (const suffix of SIDECARS) {
      try {
        await fs.promises.copyFile(`${file}${suffix}`, `${copy}${suffix}`);
      } catch {
        // Absent sidecars are the normal case for a cleanly closed database.
      }
    }
    const db = new (sqlite().DatabaseSync)(copy, { readOnly: true });
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    await fs.promises.rm(scratch, { recursive: true, force: true }).catch(() => {
      // A temp directory that will not delete is worth neither a thrown import nor silence in a
      // log nobody reads; the OS clears it eventually.
    });
  }
}

/** How many rows one kind holds, for the count beside its checkbox. Null when it cannot be read. */
export async function countItems(file: string, kind: ImportKind): Promise<number | null> {
  const table = { cookies: "cookies", passwords: "logins", history: "urls" }[kind];
  try {
    return await withDatabaseCopy(file, (db) => {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n?: unknown };
      return typeof row?.n === "number" ? row.n : Number(row?.n ?? 0);
    });
  } catch {
    return null;
  }
}

/** One cookie, in the shape Electron's `cookies.set` wants it. */
export interface ImportedCookie {
  url: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Unix seconds. Absent for a session cookie. */
  expirationDate?: number;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}

/** What one kind's read produced, including what it could not read. */
export interface ReadResult<T> {
  items: T[];
  /** Rows present in the file that could not be decrypted. Reported, never hidden. */
  skipped: number;
  /** Set when the whole scheme failed, so no row could ever have worked. */
  fatal: string | null;
}

/** Chromium's `same_site` column: -1 unspecified, 0 none, 1 lax, 2 strict. */
function sameSiteOf(raw: unknown): ImportedCookie["sameSite"] {
  switch (Number(raw)) {
    case 0:
      return "no_restriction";
    case 1:
      return "lax";
    case 2:
      return "strict";
    default:
      return "unspecified";
  }
}

/**
 * The URL a cookie is filed under.
 *
 * Electron's `cookies.set` takes a URL, not a domain, and it derives the cookie's scope from it —
 * so this has to reconstruct one that means the same thing as the row. A leading dot on
 * `host_key` is Chromium's spelling of "and all subdomains"; the URL drops it and the `domain`
 * field carries that meaning instead.
 */
function cookieUrl(hostKey: string, cookiePath: string, secure: boolean): string {
  const host = hostKey.startsWith(".") ? hostKey.slice(1) : hostKey;
  const scheme = secure ? "https" : "http";
  return `${scheme}://${host}${cookiePath.startsWith("/") ? cookiePath : `/${cookiePath}`}`;
}

/**
 * Every cookie in a profile, decrypted.
 *
 * Session cookies (`has_expires = 0`) are kept. They are the ones that carry a live sign-in, and
 * dropping them would defeat the main reason anybody imports cookies at all — Electron treats a
 * cookie with no `expirationDate` as a session cookie exactly as Chromium does.
 */
export async function readCookies(
  file: string,
  key: ChromeKey,
  platform: NodeJS.Platform = process.platform,
): Promise<ReadResult<ImportedCookie>> {
  const items: ImportedCookie[] = [];
  let skipped = 0;
  let fatal: string | null = null;

  await withDatabaseCopy(file, (db) => {
    const rows = allBigInt(
      db.prepare(
        "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, " +
          "is_httponly, has_expires, samesite FROM cookies",
      ),
    );

    for (const row of rows) {
      if (fatal !== null) break;
      const hostKey = String(row.host_key ?? "");
      const name = String(row.name ?? "");
      if (hostKey === "" || name === "") continue;

      let value: string;
      try {
        const encrypted = row.encrypted_value;
        if (encrypted instanceof Uint8Array && encrypted.length > 0) {
          // The plaintext of a v24+ cookie is `SHA-256(host_key) ‖ value`; the hash is stripped
          // here rather than inside `decryptValue`, which has no business knowing about cookies.
          value = stripCookieDomainHash(
            decryptValue(Buffer.from(encrypted), key, platform),
            hostKey,
          ).toString("utf8");
        } else {
          // Chromium leaves `value` in the clear when os_crypt was unavailable at write time.
          value = String(row.value ?? "");
        }
      } catch (error) {
        if (error instanceof ChromeDecryptError && error.fatal) {
          fatal = error.message;
          break;
        }
        skipped += 1;
        continue;
      }

      const secure = Number(row.is_secure) === 1;
      const cookiePath = String(row.path ?? "/") || "/";
      const cookie: ImportedCookie = {
        url: cookieUrl(hostKey, cookiePath, secure),
        name,
        value,
        domain: hostKey,
        path: cookiePath,
        secure,
        httpOnly: Number(row.is_httponly) === 1,
        sameSite: sameSiteOf(row.samesite),
      };
      if (Number(row.has_expires) === 1) {
        const expires = chromeTimeToUnixSeconds(row.expires_utc as number | bigint);
        if (expires !== null) cookie.expirationDate = expires;
      }
      items.push(cookie);
    }
  });

  return { items, skipped, fatal };
}

/** One saved login. `password` is plaintext and must not outlive the import. */
export interface ImportedLogin {
  /** The sign-in page's origin, e.g. `https://passport.ctrip.com`. */
  origin: string;
  /** Where the form posts, when Chromium recorded it. Used to match a form we are asked to fill. */
  actionUrl: string | null;
  username: string;
  password: string;
  /** ISO. Chromium's `date_created`; used to keep the newer of two rows for the same account. */
  createdAt: string | null;
}

/**
 * Every saved login in a profile, decrypted.
 *
 * Blocklisted entries — the rows Chromium writes when the person answered "Never" to the save
 * prompt — are skipped. They hold no password, and importing them as empty credentials would put a
 * blank password into the store for a site the person explicitly refused to save.
 */
export async function readLogins(
  file: string,
  key: ChromeKey,
  platform: NodeJS.Platform = process.platform,
): Promise<ReadResult<ImportedLogin>> {
  const items: ImportedLogin[] = [];
  let skipped = 0;
  let fatal: string | null = null;

  await withDatabaseCopy(file, (db) => {
    const rows = allBigInt(
      db.prepare(
        "SELECT origin_url, action_url, username_value, password_value, date_created, " +
          "blacklisted_by_user FROM logins",
      ),
    );

    for (const row of rows) {
      if (fatal !== null) break;
      if (Number(row.blacklisted_by_user) === 1) continue;
      const origin = String(row.origin_url ?? "");
      if (origin === "") continue;

      let password: string;
      try {
        const encrypted = row.password_value;
        if (!(encrypted instanceof Uint8Array) || encrypted.length === 0) continue;
        password = decryptValue(Buffer.from(encrypted), key, platform).toString("utf8");
      } catch (error) {
        if (error instanceof ChromeDecryptError && error.fatal) {
          fatal = error.message;
          break;
        }
        skipped += 1;
        continue;
      }
      if (password === "") continue;

      items.push({
        origin,
        actionUrl:
          typeof row.action_url === "string" && row.action_url !== "" ? row.action_url : null,
        username: String(row.username_value ?? ""),
        password,
        createdAt: chromeTimeToIso(row.date_created as number | bigint),
      });
    }
  });

  return { items, skipped, fatal };
}

/** One visited page. */
export interface ImportedVisit {
  url: string;
  title: string;
  visitCount: number;
  /** ISO, or null when Chromium never recorded a visit time. */
  lastVisitedAt: string | null;
}

/**
 * Browsing history, most recently visited first.
 *
 * Capped, and the cap is a real decision rather than a guard: a long-lived Chrome profile holds
 * hundreds of thousands of rows, and the only thing this app does with history is complete what the
 * user types in the address bar. The most recent tens of thousands cover that completely, and
 * importing the rest would cost startup time on every launch afterwards for suggestions nobody
 * would ever see. The number actually taken is reported, so a truncated import says so.
 */
export async function readHistory(
  file: string,
  options: { limit?: number } = {},
): Promise<ReadResult<ImportedVisit>> {
  const limit = options.limit ?? 20_000;
  const items = await withDatabaseCopy(file, (db) => {
    const rows = allBigInt(
      db.prepare(
        "SELECT url, title, visit_count, last_visit_time FROM urls " +
          "WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?",
      ),
      limit,
    );
    return rows
      .map((row) => ({
        url: String(row.url ?? ""),
        title: String(row.title ?? ""),
        visitCount: Number(row.visit_count ?? 0) || 0,
        lastVisitedAt: chromeTimeToIso(row.last_visit_time as number | bigint),
      }))
      .filter((visit) => visit.url !== "");
  });
  return { items, skipped: 0, fatal: null };
}
