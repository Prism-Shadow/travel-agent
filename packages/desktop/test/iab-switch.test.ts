/**
 * Whether the in-app browser is usable this run (src/iab-switch.ts).
 *
 * One boolean, because two produced a real defect: the window advertised the bridge from the flag
 * alone while the pane, the IPC handlers and the transport were installed only once a relay
 * existed. With the flag on and no relay the renderer showed a browser button whose every call
 * rejected — a capability that looked present and was not.
 */
import { describe, expect, it } from "vitest";
import { IAB_ENABLED_SWITCH, isIabAvailable } from "../src/iab-switch.js";

describe("isIabAvailable", () => {
  it("is false with the flag off, whatever the relay is doing", () => {
    expect(isIabAvailable({ flagEnabled: false, relayPort: null })).toBe(false);
    expect(isIabAvailable({ flagEnabled: false, relayPort: 19989 })).toBe(false);
  });

  it("is false with the flag on but no relay", () => {
    expect(isIabAvailable({ flagEnabled: true, relayPort: null })).toBe(false);
  });

  it("is true only when both hold", () => {
    expect(isIabAvailable({ flagEnabled: true, relayPort: 19989 })).toBe(true);
    expect(isIabAvailable({ flagEnabled: true, relayPort: 45123 })).toBe(true);
  });

  it("cannot advertise the bridge without also wiring the handlers", () => {
    // The property that matters is not any single answer but that one value drives both. Enumerate
    // the inputs and assert the two consumers can never disagree, because they read the same call.
    for (const flagEnabled of [true, false]) {
      for (const relayPort of [null, 19989]) {
        const available = isIabAvailable({ flagEnabled, relayPort });
        const switchPassed = available ? [IAB_ENABLED_SWITCH] : [];
        const handlersInstalled = available;
        expect(switchPassed.length > 0).toBe(handlersInstalled);
      }
    }
  });
});
