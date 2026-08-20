import { describe, expect, it } from "vitest";

import type { CapabilityReport } from "../src/features/capabilities/capability-model";
import {
  parsePrivateProfileTab,
  privateProfileCapabilityState,
} from "../src/features/private-profile/private-profile-model";

function reportOf(overrides: Partial<CapabilityReport> = {}): CapabilityReport {
  return {
    flags: { "vault.enabled": false, "vault.l2l3": false },
    denials: [],
    shellPresent: true,
    misconfigured: { unknown: [], invalid: [] },
    ...overrides,
  };
}

describe("Private Profile routing", () => {
  it("accepts known tabs and sends unknown input to the overview", () => {
    expect(parsePrivateProfileTab("preferences")).toBe("preferences");
    expect(parsePrivateProfileTab("not-a-tab")).toBe("overview");
    expect(parsePrivateProfileTab(null)).toBe("overview");
  });
});

describe("Private Profile capability state", () => {
  it("keeps the standalone web form visibly distinct from a desktop vault", () => {
    expect(privateProfileCapabilityState(reportOf({ shellPresent: false })).storage).toBe(
      "desktop_required",
    );
  });

  it("shows a requested capability denial and preserves the runtime reason", () => {
    const state = privateProfileCapabilityState(
      reportOf({
        denials: [{ flag: "vault.enabled", reason: "encrypted storage is unavailable" }],
      }),
    );

    expect(state.storage).toBe("denied");
    expect(state.storageReason).toBe("encrypted storage is unavailable");
  });

  it("does not confuse a quietly-off flag with a refused one", () => {
    const state = privateProfileCapabilityState(reportOf());
    expect(state.storage).toBe("off");
    expect(state.storageReason).toBeUndefined();
  });

  it("reports L2 independently from ordinary encrypted profile storage", () => {
    const state = privateProfileCapabilityState(
      reportOf({
        flags: { "vault.enabled": true, "vault.l2l3": false },
        denials: [{ flag: "vault.l2l3", reason: "agent runtime isolation is not proven" }],
      }),
    );

    expect(state.storage).toBe("available");
    expect(state.l2Available).toBe(false);
    expect(state.l2Reason).toMatch(/isolation/);
  });
});
