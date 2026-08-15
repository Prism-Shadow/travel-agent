/**
 * The in-app browser's session policy (src/session-partition.ts), for the parts that are pure.
 *
 * The permission predicate is tested apart from Electron because the property that matters is the
 * *direction* it fails in. An earlier revision listed permissions to deny, which granted everything
 * absent from the list — including every permission a future Chromium introduces. For a surface
 * rendering a booking site inside the application window, that is the wrong default, and a test
 * that only checked today's list would not have caught it.
 */
import { describe, expect, it } from "vitest";
import { chromeLikeUserAgent, isPermissionAllowed } from "../src/session-partition.js";

describe("isPermissionAllowed", () => {
  it.each([
    "media",
    "geolocation",
    "notifications",
    "midi",
    "midiSysex",
    "pointerLock",
    "fullscreen",
    "openExternal",
    "display-capture",
    "clipboard-read",
    "hid",
    "serial",
    "usb",
    "window-management",
  ])("denies %s", (permission) => {
    expect(isPermissionAllowed(permission)).toBe(false);
  });

  it("denies a permission nobody has heard of yet", () => {
    // The regression guard: default-deny means a Chromium upgrade cannot silently grant something.
    expect(isPermissionAllowed("some-future-capability")).toBe(false);
    expect(isPermissionAllowed("")).toBe(false);
  });
});

describe("chromeLikeUserAgent", () => {
  it("strips the Electron token", () => {
    const input =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) travel-agent/0.2.2 Chrome/150.0.0.0 Electron/43.2.0 Safari/537.36";
    const result = chromeLikeUserAgent(input);
    expect(result).not.toMatch(/Electron/);
    expect(result).toMatch(/Chrome\/150\.0\.0\.0/);
  });

  it("leaves an already-clean agent alone", () => {
    const input =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
    expect(chromeLikeUserAgent(input)).toBe(input);
  });

  it("does not leave double spaces behind", () => {
    expect(chromeLikeUserAgent("A Electron/1.0 B")).not.toMatch(/ {2}/);
  });
});
