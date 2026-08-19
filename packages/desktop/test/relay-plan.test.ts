/**
 * How the shell decides which relay to use (src/browser-relay.ts `planRelay`).
 *
 * Three forces meet in this decision and each has produced a real regression:
 *
 *   - The Chrome extension has 19989 compiled in and cannot follow a dynamic port, so the default
 *     IAB and optional extension backend should share it whenever it is free.
 *   - The `/iab` key is minted per launch, so a relay this process did not fork has never seen it —
 *     borrowing one gives a permanent, silent 401 loop.
 *   - Another user's process is not ours to kill.
 *
 * Pure, so all four combinations can be stated rather than reasoned about.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONVENTIONAL_RELAY_PORT,
  hasConnectedBrowserExtension,
  IAB_KEY,
  planRelay,
  relayChildEnvironment,
} from "../src/browser-relay.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const EPHEMERAL = 45123;

describe("relay child environment", () => {
  it("replaces inherited mixed-case relay variables with the canonical enabled values", () => {
    const env = relayChildEnvironment(
      { Penguin_Iab_Key: "stale-parent-key", penguin_browser_port: "1", KEEP_ME: "yes" },
      EPHEMERAL,
      true,
    );
    expect(env).toMatchObject({
      PENGUIN_BROWSER_PORT: String(EPHEMERAL),
      PENGUIN_IAB_KEY: IAB_KEY,
      KEEP_ME: "yes",
    });
    expect(Object.keys(env).filter((name) => name.toUpperCase() === "PENGUIN_IAB_KEY")).toEqual([
      "PENGUIN_IAB_KEY",
    ]);
    expect(
      Object.keys(env).filter((name) => name.toUpperCase() === "PENGUIN_BROWSER_PORT"),
    ).toEqual(["PENGUIN_BROWSER_PORT"]);
  });

  it("removes every inherited key spelling while IAB is explicitly disabled", () => {
    const env = relayChildEnvironment(
      { Penguin_Iab_Key: "stale-parent-key", PENGUIN_BROWSER_PORT: "1", KEEP_ME: "yes" },
      EPHEMERAL,
      false,
    );
    expect(env).toMatchObject({ PENGUIN_BROWSER_PORT: String(EPHEMERAL), KEEP_ME: "yes" });
    expect(Object.keys(env).some((name) => name.toUpperCase() === "PENGUIN_IAB_KEY")).toBe(false);
  });
});

describe("Chrome extension readiness", () => {
  it("recognizes a connected extension without counting the IAB host", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ extensions: [{ browserKey: "chrome-profile" }] }), {
        status: 200,
      }),
    );

    await expect(hasConnectedBrowserExtension(CONVENTIONAL_RELAY_PORT)).resolves.toBe(true);
  });

  it("keeps Chrome selectable for setup when no extension is connected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ extensions: [] }), { status: 200 }),
    );

    await expect(hasConnectedBrowserExtension(CONVENTIONAL_RELAY_PORT)).resolves.toBe(false);
  });

  it("treats an unreachable or invalid status endpoint as not connected", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("not json", { status: 200 }));

    await expect(hasConnectedBrowserExtension(CONVENTIONAL_RELAY_PORT)).resolves.toBe(false);
    await expect(hasConnectedBrowserExtension(CONVENTIONAL_RELAY_PORT)).resolves.toBe(false);
  });
});

describe("the conventional port is free", () => {
  it.each([true, false])("takes it (in-app browser enabled: %s)", (iabEnabled) => {
    const plan = planRelay({
      iabEnabled,
      conventionalPortFree: true,
      existingIsCompatibleRelay: false,
      ephemeralPort: EPHEMERAL,
    });
    expect(plan).toMatchObject({ action: "own", port: CONVENTIONAL_RELAY_PORT });
  });

  it("explains itself in terms of the extension", () => {
    const plan = planRelay({
      iabEnabled: true,
      conventionalPortFree: true,
      existingIsCompatibleRelay: false,
      ephemeralPort: EPHEMERAL,
    });
    expect(plan.reason).toMatch(/extension/i);
  });
});

describe("another relay already owns the conventional port", () => {
  it("reuses it when the in-app browser is off", () => {
    // The explicit off state. There is no key to honour, and starting a second relay would leave
    // the extension talking to one while the embedded agent talked to the other.
    const plan = planRelay({
      iabEnabled: false,
      conventionalPortFree: false,
      existingIsCompatibleRelay: true,
      ephemeralPort: EPHEMERAL,
    });
    expect(plan).toMatchObject({ action: "reuse", port: CONVENTIONAL_RELAY_PORT });
  });

  it("starts its own when the in-app browser is on", () => {
    // That relay never received this run's key, so the transport could never authenticate to it.
    const plan = planRelay({
      iabEnabled: true,
      conventionalPortFree: false,
      existingIsCompatibleRelay: true,
      ephemeralPort: EPHEMERAL,
    });
    expect(plan).toMatchObject({ action: "own", port: EPHEMERAL });
  });

  it("says out loud that the extension keeps using the other relay", () => {
    const plan = planRelay({
      iabEnabled: true,
      conventionalPortFree: false,
      existingIsCompatibleRelay: true,
      ephemeralPort: EPHEMERAL,
    });
    expect(plan.reason).toMatch(/extension/i);
  });

  it("never proposes killing it", () => {
    for (const iabEnabled of [true, false]) {
      const plan = planRelay({
        iabEnabled,
        conventionalPortFree: false,
        existingIsCompatibleRelay: true,
        ephemeralPort: EPHEMERAL,
      });
      expect(plan.action).not.toBe("kill");
      expect(plan.reason).not.toMatch(/kill|terminate/i);
    }
  });
});

describe("something that is not a relay owns the conventional port", () => {
  it.each([true, false])("fails with an actionable message (enabled: %s)", (iabEnabled) => {
    // Silently continuing would leave both the extension and the agent pointed at a stranger.
    const plan = planRelay({
      iabEnabled,
      conventionalPortFree: false,
      existingIsCompatibleRelay: false,
      ephemeralPort: EPHEMERAL,
    });
    expect(plan.action).toBe("fail");
    expect(plan.reason).toMatch(/19989/);
    expect(plan.reason).toMatch(/free it|stop the process/i);
  });
});

describe("port choice", () => {
  it("only ever returns the conventional port or the reserved ephemeral one", () => {
    const combinations = [true, false].flatMap((iabEnabled) =>
      [true, false].flatMap((free) =>
        [true, false].map((compatible) => ({
          iabEnabled,
          conventionalPortFree: free,
          existingIsCompatibleRelay: compatible,
          ephemeralPort: EPHEMERAL,
        })),
      ),
    );
    for (const input of combinations) {
      const plan = planRelay(input);
      if (plan.action === "fail") continue;
      expect([CONVENTIONAL_RELAY_PORT, EPHEMERAL]).toContain(plan.port);
    }
  });
});
