import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasConnectedBrowserExtension,
  IAB_KEY,
  relayChildEnvironment,
  browserTaskEnvironment,
} from "../src/browser-relay.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const EPHEMERAL = 45123;

describe("relay child environment", () => {
  it("pins task endpoints and strips inherited hosts and browser credentials", () => {
    const env = browserTaskEnvironment(
      {
        Penguin_Browser_Host: "another-host",
        PENGUIN_BROWSER_TOKEN: "another-token",
        PENGUIN_EXTENSION_KEY: "private",
        PENGUIN_IAB_KEY: "private",
        KEEP_ME: "yes",
      },
      { port: EPHEMERAL, instanceId: "this-launch" },
    );
    expect(env).toEqual({
      KEEP_ME: "yes",
      PENGUIN_BROWSER_PORT: String(EPHEMERAL),
      PENGUIN_RELAY_INSTANCE_ID: "this-launch",
    });
    expect(browserTaskEnvironment({}, null)).toEqual({
      PENGUIN_BROWSER_PORT: "0",
      PENGUIN_RELAY_INSTANCE_ID: "unavailable",
    });
  });
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

    await expect(hasConnectedBrowserExtension(45123)).resolves.toBe(true);
  });

  it("keeps Chrome selectable for setup when no extension is connected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ extensions: [] }), { status: 200 }),
    );

    await expect(hasConnectedBrowserExtension(45123)).resolves.toBe(false);
  });

  it("treats an unreachable or invalid status endpoint as not connected", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("not json", { status: 200 }));

    await expect(hasConnectedBrowserExtension(45123)).resolves.toBe(false);
    await expect(hasConnectedBrowserExtension(45123)).resolves.toBe(false);
  });
});
