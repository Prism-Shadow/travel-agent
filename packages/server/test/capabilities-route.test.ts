/**
 * The capabilities report: the UI's only source for "what is on, and why the rest is off".
 *
 * The gating chain needs proving end to end: a probe
 * that fails → the flag resolves off → the UI has a reason to show. The route is the middle of
 * that chain, so what is pinned here is that a *requested* capability whose prerequisites are not
 * met comes back `false` **with its reason**, not merely false — and that the report never carries
 * anything secret, because every logged-in user can read it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CapabilityReport } from "../src/http/routes/capabilities.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

let t: TestApp;
let cookie: string;
let savedFlags: string | undefined;
let savedSocket: string | undefined;

beforeEach(async () => {
  savedFlags = process.env.PENGUIN_FLAGS;
  savedSocket = process.env.PENGUIN_BROKER_SOCKET;
  delete process.env.PENGUIN_BROKER_SOCKET;
  t = await createTestApp();
  ({ cookie } = await provisionUser(t.app, "observer"));
});

afterEach(async () => {
  if (savedFlags === undefined) delete process.env.PENGUIN_FLAGS;
  else process.env.PENGUIN_FLAGS = savedFlags;
  if (savedSocket === undefined) delete process.env.PENGUIN_BROKER_SOCKET;
  else process.env.PENGUIN_BROKER_SOCKET = savedSocket;
  await t.cleanup();
});

async function report(): Promise<CapabilityReport> {
  const response = await apiClient(t.app, cookie).get("/api/capabilities");
  expect(response.status).toBe(200);
  return (await response.json()) as CapabilityReport;
}

describe("the capability report", () => {
  it("shows every presented optional capability off by default, with no shell present", async () => {
    delete process.env.PENGUIN_FLAGS;
    const seen = await report();
    expect(Object.values(seen.flags).every((value) => value === false)).toBe(true);
    expect(seen.shellPresent).toBe(false);
    expect(seen.denials).toEqual([]);
  });

  it("explains a requested capability that failed its probe — the chain the fail-closed rule requires", async () => {
    // The person asked for the whole payment stack. No probe reported an isolated runtime or
    // usable encrypted storage, so all of it resolves off — and each flag carries a sentence the
    // settings page can show, which is what stops "off" from looking like a bug.
    process.env.PENGUIN_FLAGS =
      "vault.enabled,vault.l2l3,payments.execute,secret_entry.contract,secret_entry.live";
    const seen = await report();

    expect(seen.flags["vault.enabled"]).toBe(false);
    expect(seen.flags["payments.execute"]).toBe(false);
    expect(seen.flags["secret_entry.live"]).toBe(false);

    const denied = Object.fromEntries(seen.denials.map((entry) => [entry.flag, entry.reason]));
    expect(denied["vault.enabled"]).toMatch(/refuses to start|basic_text|unavailable/);
    expect(denied["payments.execute"]).toBeDefined();
    expect(denied["secret_entry.live"]).toBeDefined();
  });

  it("reports misconfiguration instead of silently resolving it", async () => {
    process.env.PENGUIN_FLAGS = "payments.execute=flase,not_a_flag";
    const seen = await report();
    expect(seen.misconfigured.unknown).toEqual(["not_a_flag"]);
    expect(seen.misconfigured.invalid).toEqual([{ flag: "payments.execute", value: "flase" }]);
    expect(seen.flags["payments.execute"]).toBe(false);
  });

  it("reports the shell when the fork environment says one is there", async () => {
    process.env.PENGUIN_BROKER_SOCKET = "/tmp/broker.sock";
    expect((await report()).shellPresent).toBe(true);
  });

  it("carries nothing secret", async () => {
    process.env.PENGUIN_BROKER_SOCKET = "/tmp/broker.sock";
    const raw = JSON.stringify(await report());
    // The socket path and any token stay out of the body; presence is a boolean.
    expect(raw).not.toContain("/tmp/broker.sock");
    expect(raw).not.toMatch(/token/i);
  });

  it("is not readable without a login", async () => {
    const anonymous = await t.app.request("/api/capabilities");
    expect([401, 302]).toContain(anonymous.status);
  });
});
