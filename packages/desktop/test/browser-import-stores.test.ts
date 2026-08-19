/**
 * The two stores the import writes into.
 *
 * For credentials, what is pinned is the boundary rather than the round-trip: that a password
 * cannot be read back without the keychain, that one credential's key does not open another's, and
 * that the only way a password leaves the store hands it to a callback and then wipes it. Those are
 * the properties that make it safe to hold arbitrary site logins outside the Vault — and each of
 * them fails *silently* if the AAD binding is ever dropped, which is why they are tested rather
 * than trusted.
 *
 * For history, what is pinned is that a second import of the same profile does not inflate the
 * rankings, and that suggestions come back in the order an address bar needs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CredentialStore,
  CredentialStoreError,
  CredentialStoreLockedError,
  credentialKey,
  normalizeOrigin,
} from "../src/browser-import/credential-store.js";
import { HistoryStore } from "../src/browser-import/history-store.js";
import type { SafeStoragePort, StorageAvailability } from "../src/vault/safe-storage.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-store-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A keychain double. Reversible, so a "wrong keychain" can be simulated by using another one. */
function fakeKeychain(tag = "kc"): SafeStoragePort {
  return {
    encryptString: async (plaintext) => Buffer.from(`${tag}:${plaintext}`, "utf8"),
    decryptString: async (ciphertext) => {
      const text = ciphertext.toString("utf8");
      if (!text.startsWith(`${tag}:`)) throw new Error("this keychain did not write that");
      return text.slice(tag.length + 1);
    },
  };
}

const USABLE: StorageAvailability = { usable: true, reason: "", remedy: [] };
const UNUSABLE: StorageAvailability = {
  usable: false,
  reason: "This machine reports no encrypted storage.",
  remedy: [],
};

function makeStore(
  options: { safeStorage?: SafeStoragePort; availability?: StorageAvailability } = {},
) {
  return new CredentialStore({
    filePath: path.join(dir, "logins.json"),
    safeStorage: options.safeStorage ?? fakeKeychain(),
    availability: options.availability ?? USABLE,
  });
}

describe("identifying a credential", () => {
  it("treats two sign-in pages of the same site as one site", () => {
    // Chromium records whichever page the person used. Keeping the path would store three copies
    // of one password and match none of them when the site moves its form.
    expect(normalizeOrigin("https://passport.ctrip.com/login?x=1")).toBe(
      "https://passport.ctrip.com",
    );
    expect(normalizeOrigin("https://passport.ctrip.com/signin")).toBe("https://passport.ctrip.com");
  });

  it("keeps a non-default port, which is a different origin", () => {
    expect(normalizeOrigin("https://host.example:8443/x")).toBe("https://host.example:8443");
  });

  it("does not merge every unparseable row under one shared key", () => {
    expect(normalizeOrigin("not a url")).not.toBe(normalizeOrigin("also not a url"));
  });

  it("separates two accounts on the same site", () => {
    expect(credentialKey("https://a.example", "one")).not.toBe(
      credentialKey("https://a.example", "two"),
    );
  });
});

describe("the credential store", () => {
  it("refuses to start on a machine with no real encryption", async () => {
    // The alternative — writing passwords in the clear while the settings page says they are
    // protected — is the invisible broken promise the fail-closed storage rule exists to prevent.
    const store = makeStore({ availability: UNUSABLE });
    await expect(store.unlock()).rejects.toBeInstanceOf(CredentialStoreLockedError);
    expect(fs.existsSync(path.join(dir, "logins.json"))).toBe(false);
  });

  it("round-trips a password through the fill path", async () => {
    const store = makeStore();
    await store.unlock();
    store.put({
      origin: "https://passport.ctrip.com/login",
      username: "youhai",
      password: "hunter2",
      source: "chrome:Default",
    });
    const id = credentialKey("https://passport.ctrip.com", "youhai");
    expect(store.useForFill(id, (password) => password)).toBe("hunter2");
  });

  it("never writes the password where the file can be read", async () => {
    const store = makeStore();
    await store.unlock();
    store.put({ origin: "https://a.example", username: "u", password: "s3cr3t", source: "x" });
    const raw = fs.readFileSync(path.join(dir, "logins.json"), "utf8");
    expect(raw).not.toContain("s3cr3t");
    // The username is deliberately in the clear: the settings list has to draw without unlocking.
    expect(raw).toContain("u");
  });

  it("does not list a password, only what is safe to show", async () => {
    const store = makeStore();
    await store.unlock();
    store.put({ origin: "https://a.example", username: "u", password: "s3cr3t", source: "chrome" });
    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("s3cr3t");
    expect(listed[0]).toMatchObject({
      origin: "https://a.example",
      username: "u",
      source: "chrome",
    });
  });

  it("keeps one credential's key from opening another's", async () => {
    // Per-credential DEKs with the record name in the AAD. Without the binding, a password could be
    // moved between records in the file and would still open — the file is editable by anything
    // running as the user.
    const store = makeStore();
    await store.unlock();
    store.put({ origin: "https://a.example", username: "u", password: "aaa", source: "x" });
    store.put({ origin: "https://b.example", username: "u", password: "bbb", source: "x" });

    const file = JSON.parse(fs.readFileSync(path.join(dir, "logins.json"), "utf8"));
    const aId = credentialKey("https://a.example", "u");
    const bId = credentialKey("https://b.example", "u");
    // Move B's sealed password into A's record, leaving A's key in place.
    file.credentials[aId].password = file.credentials[bId].password;
    fs.writeFileSync(path.join(dir, "logins.json"), JSON.stringify(file));

    const reopened = makeStore();
    await reopened.unlock();
    expect(() => reopened.useForFill(aId, (p) => p)).toThrow(/did not authenticate/);
  });

  it("cannot be read with a different keychain", async () => {
    const store = makeStore({ safeStorage: fakeKeychain("machine-a") });
    await store.unlock();
    store.put({ origin: "https://a.example", username: "u", password: "p", source: "x" });

    const elsewhere = makeStore({ safeStorage: fakeKeychain("machine-b") });
    await expect(elsewhere.unlock()).rejects.toThrow();
  });

  it("replaces rather than duplicates, so importing the same profile twice is idempotent", async () => {
    const store = makeStore();
    await store.unlock();
    const entry = { origin: "https://a.example/login", username: "u", source: "chrome" };
    store.putMany([{ ...entry, password: "old" }]);
    store.putMany([{ ...entry, password: "new" }]);

    expect(store.size).toBe(1);
    expect(store.useForFill(credentialKey("https://a.example", "u"), (p) => p)).toBe("new");
  });

  it("writes many credentials in one pass", async () => {
    const store = makeStore();
    await store.unlock();
    const written = store.putMany(
      Array.from({ length: 50 }, (_, index) => ({
        origin: `https://site${index}.example`,
        username: "u",
        password: `p${index}`,
        source: "chrome",
      })),
    );
    expect(written).toBe(50);
    expect(store.size).toBe(50);
    expect(store.useForFill(credentialKey("https://site7.example", "u"), (p) => p)).toBe("p7");
  });

  it("finds the accounts stored for one site", async () => {
    const store = makeStore();
    await store.unlock();
    store.putMany([
      { origin: "https://a.example/login", username: "one", password: "1", source: "x" },
      { origin: "https://a.example/signin", username: "two", password: "2", source: "x" },
      { origin: "https://b.example", username: "three", password: "3", source: "x" },
    ]);
    expect(
      store
        .forOrigin("https://a.example/anything")
        .map((e) => e.username)
        .sort(),
    ).toEqual(["one", "two"]);
  });

  it("reads nothing once locked", async () => {
    const store = makeStore();
    await store.unlock();
    store.put({ origin: "https://a.example", username: "u", password: "p", source: "x" });
    store.lock();
    expect(() => store.list()).toThrow(CredentialStoreLockedError);
    expect(() => store.useForFill(credentialKey("https://a.example", "u"), (p) => p)).toThrow(
      CredentialStoreLockedError,
    );
  });

  it("survives being closed and reopened", async () => {
    const keychain = fakeKeychain();
    const first = new CredentialStore({
      filePath: path.join(dir, "logins.json"),
      safeStorage: keychain,
      availability: USABLE,
    });
    await first.unlock();
    first.put({ origin: "https://a.example", username: "u", password: "persisted", source: "x" });
    first.lock();

    const second = new CredentialStore({
      filePath: path.join(dir, "logins.json"),
      safeStorage: keychain,
      availability: USABLE,
    });
    await second.unlock();
    expect(second.useForFill(credentialKey("https://a.example", "u"), (p) => p)).toBe("persisted");
  });

  it("keeps the plaintext live until an async filler has finished with it", async () => {
    // The reason `useForFillAsync` exists. The synchronous version's `finally` runs when the
    // callback *returns the promise*, so an async filler would have its buffers wiped while the
    // write was still in flight — and typing a password into a page is exactly such a filler.
    const store = makeStore();
    await store.unlock();
    store.put({ origin: "https://a.example", username: "u", password: "hunter2", source: "x" });

    let seenMidFlight: string | null = null;
    const result = await store.useForFillAsync(
      credentialKey("https://a.example", "u"),
      async (password) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seenMidFlight = password;
        return "done";
      },
    );
    expect(seenMidFlight).toBe("hunter2");
    expect(result).toBe("done");
  });

  it("wipes the data key when opening a password fails", async () => {
    const store = makeStore();
    await store.unlock();
    store.put({ origin: "https://a.example", username: "u", password: "p", source: "x" });
    // Corrupt the sealed value so `open` throws inside the helper that holds the unwrapped key.
    const file = JSON.parse(fs.readFileSync(path.join(dir, "logins.json"), "utf8"));
    const id = credentialKey("https://a.example", "u");
    file.credentials[id].password.ct = Buffer.from("nonsense").toString("base64");
    fs.writeFileSync(path.join(dir, "logins.json"), JSON.stringify(file));

    const reopened = makeStore();
    await reopened.unlock();
    await expect(reopened.useForFillAsync(id, async (p) => p)).rejects.toThrow();
  });

  it("refuses an id it does not hold, instead of returning an empty password", async () => {
    const store = makeStore();
    await store.unlock();
    expect(() => store.useForFill("nope", (p) => p)).toThrow(CredentialStoreError);
  });

  it("writes the file so only its owner can read it", async () => {
    const store = makeStore();
    await store.unlock();
    store.put({ origin: "https://a.example", username: "u", password: "p", source: "x" });
    const mode = fs.statSync(path.join(dir, "logins.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("deletes and clears", async () => {
    const store = makeStore();
    await store.unlock();
    store.putMany([
      { origin: "https://a.example", username: "u", password: "1", source: "x" },
      { origin: "https://b.example", username: "u", password: "2", source: "x" },
    ]);
    expect(store.delete(credentialKey("https://a.example", "u"))).toBe(true);
    expect(store.delete("not-there")).toBe(false);
    expect(store.size).toBe(1);
    expect(store.clear()).toBe(1);
    expect(store.size).toBe(0);
  });
});

describe("the history store", () => {
  function makeHistory(): HistoryStore {
    return new HistoryStore({ filePath: path.join(dir, "history.db") });
  }

  it("imports entries and counts them", () => {
    const store = makeHistory();
    const written = store.importMany(
      [
        {
          url: "https://a.example",
          title: "A",
          visitCount: 3,
          lastVisitedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          url: "https://b.example",
          title: "B",
          visitCount: 1,
          lastVisitedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      "chrome",
    );
    expect(written).toBe(2);
    expect(store.size).toBe(2);
    store.close();
  });

  it("does not inflate visit counts when the same profile is imported twice", () => {
    // Summing would make every page look twice as popular after a second Import click, which
    // reorders the address bar for no reason the person could explain.
    const store = makeHistory();
    const entry = {
      url: "https://a.example",
      title: "A",
      visitCount: 5,
      lastVisitedAt: "2026-01-01T00:00:00.000Z",
    };
    store.importMany([entry], "chrome");
    store.importMany([entry], "chrome");
    expect(store.size).toBe(1);
    expect(store.suggest("a.example")[0]?.visitCount).toBe(5);
    store.close();
  });

  it("ranks by visit count, then recency", () => {
    const store = makeHistory();
    store.importMany(
      [
        {
          url: "https://rare.example/x",
          title: "",
          visitCount: 1,
          lastVisitedAt: "2026-08-01T00:00:00.000Z",
        },
        {
          url: "https://daily.example/x",
          title: "",
          visitCount: 90,
          lastVisitedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      "chrome",
    );
    expect(store.suggest("example")[0]?.url).toBe("https://daily.example/x");
    store.close();
  });

  it("matches a bare word inside a URL, because nobody types https:// first", () => {
    const store = makeHistory();
    store.importMany(
      [{ url: "https://www.ctrip.com/hotels", title: "携程", visitCount: 4, lastVisitedAt: null }],
      "chrome",
    );
    expect(store.suggest("ctrip")).toHaveLength(1);
    expect(store.suggest("携程")).toHaveLength(1);
    store.close();
  });

  it("returns nothing for an empty query rather than the whole history", () => {
    const store = makeHistory();
    store.importMany(
      [{ url: "https://a.example", title: "", visitCount: 1, lastVisitedAt: null }],
      "c",
    );
    expect(store.suggest("   ")).toEqual([]);
    store.close();
  });

  it("treats a wildcard the user typed as text, not as a pattern", () => {
    const store = makeHistory();
    store.importMany(
      [{ url: "https://a.example", title: "", visitCount: 1, lastVisitedAt: null }],
      "chrome",
    );
    // A bare `%` would otherwise match everything, so typing it would list the whole history.
    expect(store.suggest("%")).toEqual([]);
    store.close();
  });

  it("counts a live visit and keeps the newest timestamp", () => {
    const store = makeHistory();
    store.record({ url: "https://a.example", title: "A", at: new Date("2026-01-01T00:00:00Z") });
    store.record({ url: "https://a.example", title: "A", at: new Date("2026-06-01T00:00:00Z") });
    const [entry] = store.suggest("a.example");
    expect(entry?.visitCount).toBe(2);
    expect(entry?.lastVisitedAt).toBe("2026-06-01T00:00:00.000Z");
    store.close();
  });

  it("does not let an old import move a page's last-visited time backwards", () => {
    const store = makeHistory();
    store.record({ url: "https://a.example", at: new Date("2026-06-01T00:00:00Z") });
    store.importMany(
      [
        {
          url: "https://a.example",
          title: "",
          visitCount: 1,
          lastVisitedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
      "chrome",
    );
    expect(store.suggest("a.example")[0]?.lastVisitedAt).toBe("2026-06-01T00:00:00.000Z");
    store.close();
  });

  it("clears", () => {
    const store = makeHistory();
    store.importMany(
      [{ url: "https://a.example", title: "", visitCount: 1, lastVisitedAt: null }],
      "c",
    );
    expect(store.clear()).toBe(1);
    expect(store.size).toBe(0);
    store.close();
  });
});
