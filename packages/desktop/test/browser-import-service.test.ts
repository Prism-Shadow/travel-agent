/**
 * Finding profiles, and the rules the import itself follows.
 *
 * Two of these tests are about refusing things rather than doing them, and they are the reason the
 * feature is safe to expose over IPC at all: a source id is a *name we issued*, never a path, so a
 * renderer cannot use this channel to read an arbitrary SQLite file off the disk and get it back
 * decrypted. The traversal cases are written out because "it is only ever called with ids we made"
 * is exactly the assumption that stops being true when someone adds a second caller.
 *
 * The rest pin the two promises the dialog makes: a kind nobody ticked is never read (so it never
 * provokes a keychain prompt), and a partial import is reported as partial rather than rounded up
 * to success.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  discoverSources,
  parseSourceId,
  profileDirectories,
  resolveSource,
} from "../src/browser-import/chrome-profiles.js";
import { runImport } from "../src/browser-import/import-service.js";
import type { ChromeKey } from "../src/browser-import/chrome-crypto.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-home-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

/** Builds a Chrome user-data directory the way Chrome lays one out. */
function makeChromeProfile(options: {
  profile?: string;
  displayName?: string;
  files?: string[];
}): string {
  const userData = path.join(home, ".config/google-chrome");
  const profile = options.profile ?? "Default";
  const profileDir = path.join(userData, profile);
  fs.mkdirSync(profileDir, { recursive: true });
  for (const file of options.files ?? ["Cookies", "Login Data", "History"]) {
    fs.writeFileSync(path.join(profileDir, file), "");
  }
  const localStatePath = path.join(userData, "Local State");
  const existing = fs.existsSync(localStatePath)
    ? JSON.parse(fs.readFileSync(localStatePath, "utf8"))
    : { profile: { info_cache: {} } };
  if (options.displayName !== undefined) {
    existing.profile.info_cache[profile] = { name: options.displayName };
  }
  fs.writeFileSync(localStatePath, JSON.stringify(existing));
  return profileDir;
}

describe("discovering profiles", () => {
  it("names a profile the way its owner does, not 'Profile 3'", () => {
    makeChromeProfile({ displayName: "youhai" });
    const { sources } = discoverSources({ platform: "linux", home });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: "chrome:Default",
      browserLabel: "Google Chrome",
      profileLabel: "youhai",
    });
  });

  it("falls back to no label rather than inventing one", () => {
    makeChromeProfile({});
    expect(discoverSources({ platform: "linux", home }).sources[0]?.profileLabel).toBeNull();
  });

  it("lists several profiles, Default first and then numerically", () => {
    makeChromeProfile({ profile: "Profile 10" });
    makeChromeProfile({ profile: "Profile 2" });
    makeChromeProfile({ profile: "Default" });
    const { sources } = discoverSources({ platform: "linux", home });
    expect(sources.map((source) => source.id)).toEqual([
      "chrome:Default",
      "chrome:Profile 2",
      "chrome:Profile 10",
    ]);
  });

  it("leaves out the guest and system profiles", () => {
    // Importing the guest profile would bring over a session the person asked not to be remembered.
    const userData = path.join(home, ".config/google-chrome");
    for (const name of ["Guest Profile", "System Profile"]) {
      fs.mkdirSync(path.join(userData, name), { recursive: true });
      fs.writeFileSync(path.join(userData, name, "Cookies"), "");
    }
    expect(profileDirectories(userData)).toEqual([]);
  });

  it("offers only the kinds whose files are actually there", () => {
    makeChromeProfile({ files: ["Cookies"] });
    const source = discoverSources({ platform: "linux", home }).sources[0];
    expect(source?.available).toEqual(["cookies"]);
  });

  it("reports a running browser so the dialog can ask for it to be closed", () => {
    makeChromeProfile({});
    const { runningBrowsers } = discoverSources({
      platform: "linux",
      home,
      isRunning: (family) => family === "chrome",
    });
    expect(runningBrowsers).toEqual(["Google Chrome"]);
  });

  it("finds nothing, without throwing, on a machine with no browser", () => {
    expect(discoverSources({ platform: "linux", home }).sources).toEqual([]);
  });

  it("shows the count beside a kind, and tolerates one it cannot count", () => {
    makeChromeProfile({ files: ["Cookies", "History"] });
    const source = discoverSources({
      platform: "linux",
      home,
      countItems: (_file, kind) => (kind === "cookies" ? 65 : null),
    }).sources[0];
    expect(source?.counts.cookies).toBe(65);
    expect(source?.counts.history).toBeNull();
  });
});

describe("a source id is a name, never a path", () => {
  it("accepts only the shape Chrome uses", () => {
    expect(parseSourceId("chrome:Default")).toEqual({ familyId: "chrome", profileDir: "Default" });
    expect(parseSourceId("chrome:Profile 3")).toEqual({
      familyId: "chrome",
      profileDir: "Profile 3",
    });
  });

  it("refuses traversal, absolute paths and anything else that is not a profile name", () => {
    // The grammar cannot express these at all, which is stronger than stripping them.
    for (const id of [
      "chrome:../../../../etc/passwd",
      "chrome:/etc/passwd",
      "chrome:Default/../../Local State",
      "chrome:..",
      "chrome:",
      "chrome:Profile",
      "chrome:default",
      "unknown-browser:Default",
      "Default",
      "",
    ]) {
      expect(parseSourceId(id), id).toBeNull();
    }
  });

  it("refuses a non-string", () => {
    for (const id of [null, undefined, 42, {}, []]) expect(parseSourceId(id)).toBeNull();
  });

  it("resolves only to a profile that is really there", () => {
    makeChromeProfile({});
    expect(resolveSource("chrome:Default", { platform: "linux", home })).not.toBeNull();
    // Deleted between the dialog opening and Import being pressed.
    expect(resolveSource("chrome:Profile 4", { platform: "linux", home })).toBeNull();
  });
});

describe("running an import", () => {
  /** A session double that records what would have been written to the cookie jar. */
  function fakeSession(options: { reject?: (name: string) => boolean } = {}) {
    const set: string[] = [];
    return {
      set,
      session: {
        cookies: {
          set: async (cookie: { name: string }) => {
            if (options.reject?.(cookie.name) === true) throw new Error("refused");
            set.push(cookie.name);
          },
        },
      } as never,
    };
  }

  const key: ChromeKey = { scheme: "cbc", key: Buffer.alloc(16) };

  it("refuses an id it never issued", async () => {
    // A bug or an attempt, not a condition to report in a dialog — so this one throws.
    await expect(
      runImport(
        { sourceId: "chrome:../../etc", kinds: ["cookies"] },
        {
          session: fakeSession().session,
          credentials: async () => null,
          history: () => null,
          home,
        },
      ),
    ).rejects.toThrow(/no longer on this machine/);
  });

  it("never asks for the key when only history was ticked", async () => {
    // History is not encrypted. On macOS, acquiring a key shows a system keychain prompt — asking
    // for one to import history would be a prompt the person cannot connect to anything they chose.
    makeChromeProfile({ files: ["History"] });
    const acquireKey = vi.fn();
    const history = { importMany: () => 0 } as never;

    await runImport(
      { sourceId: "chrome:Default", kinds: ["history"] },
      {
        session: fakeSession().session,
        credentials: async () => null,
        history: () => history,
        platform: "linux",
        home,
        acquireKey: acquireKey as never,
      },
    );
    expect(acquireKey).not.toHaveBeenCalled();
  });

  it("asks for the key once even when two kinds need it", async () => {
    // A declined macOS prompt must not be shown again for the second kind: asking twice for one
    // Import click reads as the app not taking no for an answer.
    makeChromeProfile({ files: ["Cookies", "Login Data"] });
    const acquireKey = vi.fn(async () => key);

    await runImport(
      { sourceId: "chrome:Default", kinds: ["cookies", "passwords"] },
      {
        session: fakeSession().session,
        credentials: async () => null,
        history: () => null,
        platform: "linux",
        home,
        acquireKey: acquireKey as never,
      },
    );
    expect(acquireKey).toHaveBeenCalledTimes(1);
  });

  it("reports a refused keychain as a failure per kind, not as a thrown import", async () => {
    makeChromeProfile({ files: ["Cookies"] });
    const outcome = await runImport(
      { sourceId: "chrome:Default", kinds: ["cookies"] },
      {
        session: fakeSession().session,
        credentials: async () => null,
        history: () => null,
        platform: "linux",
        home,
        acquireKey: (async () => {
          throw new Error("macOS did not release the browser's encryption key.");
        }) as never,
      },
    );
    expect(outcome.anythingImported).toBe(false);
    expect(outcome.results[0]?.failure).toMatch(/did not release/);
  });

  it("keeps the kinds that worked when one fails", async () => {
    // A thrown import would lose the two kinds that succeeded, which is the whole reason failures
    // are values here rather than exceptions.
    const profileDir = makeChromeProfile({ files: ["Cookies"] });
    // A real history database next to a Cookies file that is not one at all.
    const db = new (process.getBuiltinModule("node:sqlite").DatabaseSync)(
      path.join(profileDir, "History"),
    );
    db.exec(
      "CREATE TABLE urls (url TEXT, title TEXT, visit_count INTEGER, " +
        "last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0)",
    );
    db.prepare("INSERT INTO urls VALUES (?, ?, ?, ?, 0)").run("https://a.example", "A", 1, 0);
    db.close();
    const history = { importMany: () => 7 } as never;
    const outcome = await runImport(
      { sourceId: "chrome:Default", kinds: ["cookies", "history"] },
      {
        session: fakeSession().session,
        credentials: async () => null,
        history: () => history,
        platform: "linux",
        home,
        // The Cookies file exists but is empty, so reading it fails; History still imports.
        acquireKey: (async () => key) as never,
      },
    );
    const byKind = Object.fromEntries(outcome.results.map((result) => [result.kind, result]));
    expect(byKind.cookies?.failure).not.toBeNull();
    expect(byKind.history?.imported).toBe(7);
    expect(outcome.anythingImported).toBe(true);
  });

  it("refuses to store passwords when there is nowhere encrypted to put them", async () => {
    makeChromeProfile({ files: ["Login Data"] });
    const outcome = await runImport(
      { sourceId: "chrome:Default", kinds: ["passwords"] },
      {
        session: fakeSession().session,
        credentials: async () => null,
        history: () => null,
        platform: "linux",
        home,
        acquireKey: (async () => key) as never,
      },
    );
    expect(outcome.results[0]?.imported).toBe(0);
    expect(outcome.results[0]?.failure).toMatch(/encrypted storage/);
  });
});
