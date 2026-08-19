/**
 * Reading a real Chrome profile, built here rather than mocked.
 *
 * The reader's risk is not its logic — it is that the *schema assumptions are wrong*: a column
 * named `samesite` and not `same_site`, `blacklisted_by_user` on a table that no longer has it, a
 * `hidden` flag that does not exist. Every one of those produces an exception at import time on a
 * user's machine and nothing at all in a test that stubs SQLite. So these tests write genuine
 * SQLite files with Chromium's real column layout, encrypt the values the way Chromium encrypts
 * them, and read them back through the actual code path.
 *
 * The WAL case is here for the same reason: it is the difference between importing the sign-in the
 * person created five minutes ago and silently importing yesterday's state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCipheriv } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deriveCbcKey } from "../src/browser-import/chrome-crypto.js";
import {
  countItems,
  readCookies,
  readHistory,
  readLogins,
} from "../src/browser-import/chrome-store.js";

const sqlite = process.getBuiltinModule("node:sqlite");
const KEY = deriveCbcKey("peanuts", "linux");
const CHROME_EPOCH_OFFSET = 11_644_473_600_000_000n;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-import-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Encrypts exactly as Chromium does on a keyring-less Linux box. */
function seal(plaintext: string): Buffer {
  const cipher = createCipheriv("aes-128-cbc", KEY, Buffer.alloc(16, " "));
  return Buffer.concat([
    Buffer.from("v10", "latin1"),
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
}

function chromeTime(iso: string): bigint {
  return BigInt(Date.parse(iso)) * 1000n + CHROME_EPOCH_OFFSET;
}

/** Chromium's `cookies` table, with the columns the reader names. */
function writeCookiesDb(file: string, rows: Record<string, unknown>[]): void {
  const db = new sqlite.DatabaseSync(file);
  db.exec(`CREATE TABLE cookies (
    creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, name TEXT NOT NULL,
    value TEXT NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL,
    is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL, has_expires INTEGER NOT NULL,
    samesite INTEGER NOT NULL, encrypted_value BLOB)`);
  const insert = db.prepare(
    `INSERT INTO cookies (creation_utc, host_key, name, value, path, expires_utc, is_secure,
      is_httponly, has_expires, samesite, encrypted_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(
      0,
      row.host_key as string,
      row.name as string,
      (row.value as string) ?? "",
      (row.path as string) ?? "/",
      (row.expires_utc as bigint) ?? 0n,
      (row.is_secure as number) ?? 0,
      (row.is_httponly as number) ?? 0,
      (row.has_expires as number) ?? 0,
      (row.samesite as number) ?? -1,
      (row.encrypted_value as Buffer) ?? null,
    );
  }
  db.close();
}

describe("reading cookies", () => {
  it("decrypts values and reconstructs the URL Electron needs", async () => {
    const file = path.join(dir, "Cookies");
    writeCookiesDb(file, [
      {
        host_key: ".ctrip.com",
        name: "SESSION",
        path: "/",
        is_secure: 1,
        is_httponly: 1,
        has_expires: 1,
        expires_utc: chromeTime("2027-01-01T00:00:00Z"),
        samesite: 1,
        encrypted_value: seal("signed-in-token"),
      },
    ]);

    const result = await readCookies(file, { scheme: "cbc", key: KEY }, "linux");
    expect(result.fatal).toBeNull();
    expect(result.items).toHaveLength(1);
    const cookie = result.items[0]!;
    expect(cookie.value).toBe("signed-in-token");
    // The leading dot is Chromium's "and subdomains"; it belongs in `domain`, not in the URL.
    expect(cookie.url).toBe("https://ctrip.com/");
    expect(cookie.domain).toBe(".ctrip.com");
    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(new Date((cookie.expirationDate as number) * 1000).getUTCFullYear()).toBe(2027);
  });

  it("keeps session cookies, which are the ones carrying a live sign-in", async () => {
    const file = path.join(dir, "Cookies");
    writeCookiesDb(file, [
      {
        host_key: "www.ctrip.com",
        name: "LIVE",
        has_expires: 0,
        expires_utc: 0n,
        encrypted_value: seal("live"),
      },
    ]);
    const result = await readCookies(file, { scheme: "cbc", key: KEY }, "linux");
    expect(result.items).toHaveLength(1);
    // No expirationDate at all — Electron reads that as a session cookie, exactly as Chromium does.
    expect(result.items[0]!.expirationDate).toBeUndefined();
  });

  it("reads an unencrypted value, which Chromium writes when os_crypt was unavailable", async () => {
    const file = path.join(dir, "Cookies");
    writeCookiesDb(file, [{ host_key: "example.com", name: "PLAIN", value: "visible" }]);
    const result = await readCookies(file, { scheme: "cbc", key: KEY }, "linux");
    expect(result.items[0]!.value).toBe("visible");
  });

  it("counts an undecryptable row as skipped and imports the rest", async () => {
    const file = path.join(dir, "Cookies");
    writeCookiesDb(file, [
      { host_key: "a.com", name: "GOOD", encrypted_value: seal("ok") },
      // A v10 body that is not a whole number of AES blocks: one bad row, not a failed import.
      {
        host_key: "b.com",
        name: "BAD",
        encrypted_value: Buffer.concat([Buffer.from("v10"), Buffer.alloc(7)]),
      },
      { host_key: "c.com", name: "ALSO_GOOD", encrypted_value: seal("ok2") },
    ]);
    const result = await readCookies(file, { scheme: "cbc", key: KEY }, "linux");
    expect(result.items).toHaveLength(2);
    expect(result.skipped).toBe(1);
    expect(result.fatal).toBeNull();
  });

  it("stops at the first fatal row instead of retrying every remaining one", async () => {
    const file = path.join(dir, "Cookies");
    writeCookiesDb(file, [
      {
        host_key: "a.com",
        name: "V20",
        encrypted_value: Buffer.concat([Buffer.from("v20"), Buffer.alloc(48)]),
      },
      { host_key: "b.com", name: "OTHER", encrypted_value: seal("never-read") },
    ]);
    const result = await readCookies(file, { scheme: "cbc", key: KEY }, "linux");
    expect(result.fatal).toMatch(/App-Bound/);
  });

  it("reads rows still sitting in the WAL, not just the committed file", async () => {
    // The whole reason `withDatabaseCopy` copies the sidecars. A cookie written seconds ago lives
    // in `Cookies-wal`; copying only the main database imports yesterday's state and looks like a
    // success.
    const file = path.join(dir, "Cookies");
    writeCookiesDb(file, []);
    const db = new sqlite.DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    db.prepare(
      `INSERT INTO cookies (creation_utc, host_key, name, value, path, expires_utc, is_secure,
        is_httponly, has_expires, samesite, encrypted_value) VALUES (0,?,?,'','/',0,0,0,0,-1,?)`,
    ).run("fresh.com", "JUST_SIGNED_IN", seal("fresh-token"));
    // Deliberately NOT closed: the rows are in the WAL, exactly as they are while Chrome runs.
    const result = await readCookies(file, { scheme: "cbc", key: KEY }, "linux");
    db.close();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.value).toBe("fresh-token");
  });

  it("leaves the source database untouched", async () => {
    const file = path.join(dir, "Cookies");
    writeCookiesDb(file, [{ host_key: "a.com", name: "X", encrypted_value: seal("v") }]);
    const before = fs.readFileSync(file);
    await readCookies(file, { scheme: "cbc", key: KEY }, "linux");
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it("does not leave a copy of the cookie jar in the temp directory", async () => {
    const file = path.join(dir, "Cookies");
    writeCookiesDb(file, [{ host_key: "a.com", name: "X", encrypted_value: seal("v") }]);
    // Point the temp directory somewhere only this test writes. Counting entries in the shared
    // `os.tmpdir()` made the assertion a race: vitest runs test files in parallel workers, and the
    // import-service file creates and removes copies under the same prefix while this one counts.
    // `os.tmpdir()` re-reads TMPDIR on every call, so the code under test follows this override.
    const privateTmp = fs.mkdtempSync(path.join(dir, "tmp-"));
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = privateTmp;
    try {
      await readCookies(file, { scheme: "cbc", key: KEY }, "linux");
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
    }
    expect(fs.readdirSync(privateTmp)).toEqual([]);
  });
});

describe("reading saved logins", () => {
  function writeLoginsDb(file: string, rows: Record<string, unknown>[]): void {
    const db = new sqlite.DatabaseSync(file);
    db.exec(`CREATE TABLE logins (
      origin_url TEXT NOT NULL, action_url TEXT, username_value TEXT,
      password_value BLOB, date_created INTEGER NOT NULL DEFAULT 0,
      blacklisted_by_user INTEGER NOT NULL DEFAULT 0)`);
    const insert = db.prepare(
      `INSERT INTO logins (origin_url, action_url, username_value, password_value,
        date_created, blacklisted_by_user) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(
        row.origin_url as string,
        (row.action_url as string) ?? null,
        (row.username_value as string) ?? "",
        (row.password_value as Buffer) ?? null,
        (row.date_created as bigint) ?? 0n,
        (row.blacklisted_by_user as number) ?? 0,
      );
    }
    db.close();
  }

  it("decrypts a login and keeps the origin and account", async () => {
    const file = path.join(dir, "Login Data");
    writeLoginsDb(file, [
      {
        origin_url: "https://passport.ctrip.com/login",
        action_url: "https://passport.ctrip.com/post",
        username_value: "youhai@example.com",
        password_value: seal("hunter2"),
        date_created: chromeTime("2025-03-01T10:00:00Z"),
      },
    ]);
    const result = await readLogins(file, { scheme: "cbc", key: KEY }, "linux");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      origin: "https://passport.ctrip.com/login",
      username: "youhai@example.com",
      password: "hunter2",
    });
    expect(result.items[0]!.createdAt).toBe("2025-03-01T10:00:00.000Z");
  });

  it("skips the rows written when the person answered Never to the save prompt", async () => {
    // These hold no password. Importing them would put a blank credential into the store for a
    // site the person explicitly refused to save.
    const file = path.join(dir, "Login Data");
    writeLoginsDb(file, [
      { origin_url: "https://never.example", blacklisted_by_user: 1 },
      { origin_url: "https://ok.example", username_value: "u", password_value: seal("p") },
    ]);
    const result = await readLogins(file, { scheme: "cbc", key: KEY }, "linux");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.origin).toBe("https://ok.example");
  });

  it("skips a row whose password decrypts to nothing", async () => {
    const file = path.join(dir, "Login Data");
    writeLoginsDb(file, [
      { origin_url: "https://empty.example", username_value: "u", password_value: seal("") },
    ]);
    expect((await readLogins(file, { scheme: "cbc", key: KEY }, "linux")).items).toHaveLength(0);
  });
});

describe("reading history", () => {
  function writeHistoryDb(file: string, rows: Record<string, unknown>[]): void {
    const db = new sqlite.DatabaseSync(file);
    db.exec(`CREATE TABLE urls (
      url TEXT, title TEXT, visit_count INTEGER DEFAULT 0,
      last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0)`);
    const insert = db.prepare(
      "INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)",
    );
    for (const row of rows) {
      insert.run(
        row.url as string,
        (row.title as string) ?? "",
        (row.visit_count as number) ?? 0,
        (row.last_visit_time as bigint) ?? 0n,
        (row.hidden as number) ?? 0,
      );
    }
    db.close();
  }

  it("returns most recent first and converts the timestamps", async () => {
    const file = path.join(dir, "History");
    writeHistoryDb(file, [
      {
        url: "https://old.example",
        title: "Old",
        visit_count: 1,
        last_visit_time: chromeTime("2024-01-01T00:00:00Z"),
      },
      {
        url: "https://new.example",
        title: "New",
        visit_count: 9,
        last_visit_time: chromeTime("2026-08-01T00:00:00Z"),
      },
    ]);
    const result = await readHistory(file);
    expect(result.items.map((visit) => visit.url)).toEqual([
      "https://new.example",
      "https://old.example",
    ]);
    expect(result.items[0]!.lastVisitedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(result.items[0]!.visitCount).toBe(9);
  });

  it("leaves out the rows Chromium marks hidden", async () => {
    const file = path.join(dir, "History");
    writeHistoryDb(file, [
      { url: "https://shown.example", last_visit_time: chromeTime("2026-01-01T00:00:00Z") },
      {
        url: "https://hidden.example",
        last_visit_time: chromeTime("2026-01-01T00:00:00Z"),
        hidden: 1,
      },
    ]);
    const result = await readHistory(file);
    expect(result.items.map((visit) => visit.url)).toEqual(["https://shown.example"]);
  });

  it("honours the cap, so a decade-old profile does not import half a million rows", async () => {
    const file = path.join(dir, "History");
    writeHistoryDb(
      file,
      Array.from({ length: 50 }, (_, index) => ({
        url: `https://example.com/${index}`,
        last_visit_time: chromeTime("2026-01-01T00:00:00Z"),
      })),
    );
    expect((await readHistory(file, { limit: 10 })).items).toHaveLength(10);
  });
});

describe("counting for the dialog", () => {
  it("counts rows without decrypting any of them", async () => {
    // The count is drawn next to a checkbox the person has not ticked yet, so it must not need the
    // key — on macOS that would mean a keychain prompt before any consent was given.
    const file = path.join(dir, "Cookies");
    writeCookiesDb(file, [
      { host_key: "a.com", name: "1", encrypted_value: seal("x") },
      { host_key: "b.com", name: "2", encrypted_value: seal("y") },
    ]);
    expect(await countItems(file, "cookies")).toBe(2);
  });

  it("answers null for a file it cannot read, rather than throwing into the dialog", async () => {
    fs.writeFileSync(path.join(dir, "Cookies"), "this is not a database");
    expect(await countItems(path.join(dir, "Cookies"), "cookies")).toBeNull();
  });
});
