/**
 * Offering and typing a saved website login.
 *
 * The tests that matter here are the refusals. A saved password is the most dangerous thing this
 * application holds, and the two ways to lose one are not exotic:
 *
 *   - the origin being taken from the *caller* rather than from the tab, so a page can ask for
 *     somebody else's password;
 *   - the page navigating between the offer being drawn and the button being pressed, so the
 *     credential chosen for one site is typed into another. On a sign-in page a navigation is not
 *     a rare event — it is what happens when one succeeds.
 *
 * Both are pinned below. The third property — that the plaintext never appears in a return value,
 * a log line or an error — is pinned by asserting on everything the service hands back.
 */
import { describe, expect, it, vi } from "vitest";

import { LoginService } from "../src/browser-import/login-service.js";
import type { IsolatedWorldPort, TabUrlSource } from "../src/browser-import/login-service.js";
import { credentialKey } from "../src/browser-import/credential-store.js";

const SECRET = "s3cr3t-password";

/** A credential store double with the same surface the service uses. */
function fakeStore(entries: { origin: string; username: string; password?: string }[]) {
  const rows = entries.map((entry) => ({
    id: credentialKey(entry.origin, entry.username),
    origin: new URL(entry.origin).origin,
    username: entry.username,
    password: entry.password ?? SECRET,
    updatedAt: "2026-08-17T00:00:00.000Z",
    source: "chrome:Default",
  }));
  return {
    rows,
    store: {
      forOrigin: (origin: string) => rows.filter((row) => row.origin === origin),
      useForFillAsync: async <T>(id: string, use: (password: string) => Promise<T>): Promise<T> => {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw new Error("No saved login with that id.");
        return use(row.password);
      },
    } as never,
  };
}

function tabsAt(url: string | null): TabUrlSource {
  return { urlOf: () => url };
}

/** A world double that records what was evaluated and answers a scripted result. */
function fakeWorld(answers: unknown[]): IsolatedWorldPort & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  let index = 0;
  return {
    calls,
    evaluate: async <T>(input: { declaration: string; args: unknown[] }): Promise<T | null> => {
      calls.push(input.args);
      return (answers[index++] ?? null) as T | null;
    },
  };
}

const FORM_FOUND = { found: true, hasUsernameField: true, passwordCount: 1 };

describe("offering a saved login", () => {
  it("offers the accounts stored for the origin the tab is actually on", async () => {
    const { store } = fakeStore([
      { origin: "https://passport.ctrip.com/login", username: "youhai" },
      { origin: "https://passport.ctrip.com/signin", username: "second" },
      { origin: "https://elsewhere.example", username: "nope" },
    ]);
    const service = new LoginService({
      credentials: async () => store,
      world: fakeWorld([FORM_FOUND]),
      tabs: tabsAt("https://passport.ctrip.com/login?redirect=%2F"),
    });

    const answer = await service.offersFor("target-1");
    expect(answer.formPresent).toBe(true);
    expect(answer.offers.map((offer) => offer.username).sort()).toEqual(["second", "youhai"]);
  });

  it("offers nothing when the page has no sign-in form, whatever is stored", async () => {
    const { store } = fakeStore([{ origin: "https://a.example", username: "u" }]);
    const service = new LoginService({
      credentials: async () => store,
      world: fakeWorld([{ found: false }]),
      tabs: tabsAt("https://a.example/home"),
    });
    const answer = await service.offersFor("target-1");
    expect(answer.formPresent).toBe(false);
    expect(answer.offers).toEqual([]);
  });

  it("does not look at the store before it knows there is a form", async () => {
    // Unlocking the credential store can touch the OS keychain. Doing it for every page load
    // would be a keychain access per navigation, for pages that mostly have no sign-in form.
    const credentials = vi.fn(async () => null);
    const service = new LoginService({
      credentials,
      world: fakeWorld([{ found: false }]),
      tabs: tabsAt("https://a.example"),
    });
    await service.offersFor("target-1");
    expect(credentials).not.toHaveBeenCalled();
  });

  it("says why when there is a form but no encrypted storage", async () => {
    const service = new LoginService({
      credentials: async () => null,
      world: fakeWorld([FORM_FOUND]),
      tabs: tabsAt("https://a.example/login"),
    });
    const answer = await service.offersFor("target-1");
    expect(answer.formPresent).toBe(true);
    expect(answer.unavailable).toMatch(/encrypted storage/);
  });

  it("offers nothing for a tab that is gone", async () => {
    const { store } = fakeStore([{ origin: "https://a.example", username: "u" }]);
    const service = new LoginService({
      credentials: async () => store,
      world: fakeWorld([FORM_FOUND]),
      tabs: tabsAt(null),
    });
    expect((await service.offersFor("target-1")).formPresent).toBe(false);
  });

  it("never carries a password in what it offers", async () => {
    const { store } = fakeStore([{ origin: "https://a.example/login", username: "u" }]);
    const service = new LoginService({
      credentials: async () => store,
      world: fakeWorld([FORM_FOUND]),
      tabs: tabsAt("https://a.example/login"),
    });
    expect(JSON.stringify(await service.offersFor("target-1"))).not.toContain(SECRET);
  });
});

describe("filling a saved login", () => {
  it("types the username and password into the page", async () => {
    const { store, rows } = fakeStore([
      { origin: "https://passport.ctrip.com/login", username: "youhai" },
    ]);
    const world = fakeWorld([{ filled: true, wroteUsername: true }]);
    const service = new LoginService({
      credentials: async () => store,
      world,
      tabs: tabsAt("https://passport.ctrip.com/login"),
    });

    const result = await service.fill({ targetId: "t", credentialId: rows[0]!.id });
    expect(result).toEqual({ ok: true, username: "youhai", wroteUsername: true });
    expect(world.calls[0]).toEqual(["youhai", SECRET]);
  });

  it("refuses when the tab navigated to another site after the offer was drawn", async () => {
    // The credential is real and the id is right — but the page under it is not the one it was
    // chosen for. Without this check the password for one site is typed into another.
    const { store, rows } = fakeStore([
      { origin: "https://passport.ctrip.com/login", username: "youhai" },
    ]);
    const world = fakeWorld([{ filled: true }]);
    const service = new LoginService({
      credentials: async () => store,
      world,
      tabs: tabsAt("https://attacker.example/login"),
    });

    const result = await service.fill({ targetId: "t", credentialId: rows[0]!.id });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/not for the page/) });
    // Nothing was typed anywhere.
    expect(world.calls).toHaveLength(0);
  });

  it("refuses a credential id it does not hold", async () => {
    const { store } = fakeStore([{ origin: "https://a.example/login", username: "u" }]);
    const world = fakeWorld([{ filled: true }]);
    const service = new LoginService({
      credentials: async () => store,
      world,
      tabs: tabsAt("https://a.example/login"),
    });
    const result = await service.fill({ targetId: "t", credentialId: "made-up" });
    expect(result.ok).toBe(false);
    expect(world.calls).toHaveLength(0);
  });

  it("refuses for a tab that is gone", async () => {
    const { store, rows } = fakeStore([{ origin: "https://a.example/login", username: "u" }]);
    const service = new LoginService({
      credentials: async () => store,
      world: fakeWorld([{ filled: true }]),
      tabs: tabsAt(null),
    });
    expect((await service.fill({ targetId: "t", credentialId: rows[0]!.id })).ok).toBe(false);
  });

  it("reports a form that would not take the value, without blaming the password", async () => {
    const { store, rows } = fakeStore([{ origin: "https://a.example/login", username: "u" }]);
    const service = new LoginService({
      credentials: async () => store,
      world: fakeWorld([{ filled: false, reason: "no_password_field" }]),
      tabs: tabsAt("https://a.example/login"),
    });
    const result = await service.fill({ targetId: "t", credentialId: rows[0]!.id });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/did not accept/) });
  });

  it("never returns or logs the password, on success or on failure", async () => {
    const lines: string[] = [];
    const { store, rows } = fakeStore([{ origin: "https://a.example/login", username: "u" }]);
    const service = new LoginService({
      credentials: async () => store,
      world: fakeWorld([{ filled: true }, { filled: false }]),
      tabs: tabsAt("https://a.example/login"),
      log: (message) => lines.push(message),
    });

    const ok = await service.fill({ targetId: "t", credentialId: rows[0]!.id });
    const bad = await service.fill({ targetId: "t", credentialId: "wrong" });
    expect(JSON.stringify([ok, bad])).not.toContain(SECRET);
    expect(lines.join("\n")).not.toContain(SECRET);
  });
});
