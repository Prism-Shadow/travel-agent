/**
 * Feature flags (state/feature-flags.ts): defaults, override parsing, dependency closure and
 * the runtime probe. All pure functions — no filesystem, no Electron, no network.
 *
 * The cases worth having are the ones that assert a *refusal*: an override that asks for a
 * capability whose prerequisites are missing must come back off, because design/003's
 * fail-closed rules are only real if the combination cannot be expressed.
 */
import { describe, expect, it } from "vitest";
import {
  FLAG_DEFAULTS,
  applyCapabilityProbe,
  isFeatureFlag,
  listFeatureFlags,
  parseFlagOverrides,
  resolveFlags,
  resolveFlagsFromEnv,
} from "../src/state/feature-flags.js";
import type { CapabilityProbe, FeatureFlag, FeatureFlags } from "../src/state/feature-flags.js";

/** A host that measured both facts and found them satisfied. Never a default — see the module header. */
const TRUSTED_PROBE: CapabilityProbe = {
  encryptedStorageAvailable: true,
  agentRuntimeIsolated: true,
};

/** Every gated capability requested at once, for tests that assert what survives. */
const ALL_REQUESTED: Partial<Record<FeatureFlag, boolean>> = {
  "iab.enabled": true,
  "chrome.fallback": true,
  "secret_entry.contract": true,
  "vault.enabled": true,
  "vault.l2l3": true,
  "secret_entry.live": true,
  "payments.execute": true,
  "payments.agent_click_pay": true,
  "audit.chain": true,
};

describe("feature flag defaults", () => {
  it("ships both browser backends on and every security-sensitive capability off", () => {
    for (const flag of listFeatureFlags()) {
      expect(FLAG_DEFAULTS[flag], `${flag} has the wrong product default`).toBe(
        flag === "iab.enabled" || flag === "chrome.fallback",
      );
    }
  });

  it("resolves to both browser backends with no overrides and reports no denials", () => {
    const { flags, denials } = resolveFlags();
    expect(flags["iab.enabled"]).toBe(true);
    expect(flags["chrome.fallback"]).toBe(true);
    expect(
      Object.entries(flags).every(
        ([flag, enabled]) => flag === "iab.enabled" || flag === "chrome.fallback" || !enabled,
      ),
    ).toBe(true);
    expect(denials).toEqual([]);
  });

  it("recognises declared names and rejects typos", () => {
    expect(isFeatureFlag("iab.enabled")).toBe(true);
    expect(isFeatureFlag("iab.enable")).toBe(false);
    expect(isFeatureFlag("")).toBe(false);
  });
});

describe("the defaults table cannot be mutated by an importer", () => {
  // The invariant at stake: FLAG_DEFAULTS is the single source of product defaults, so one
  // mutation anywhere in the process would silently move the default for every later
  // resolveFlags() call. The type stops a compile-time write; the freeze stops a runtime one.
  it("is frozen", () => {
    expect(Object.isFrozen(FLAG_DEFAULTS)).toBe(true);
  });

  it("ignores or throws on a write, and keeps the value either way", () => {
    const mutable = FLAG_DEFAULTS as FeatureFlags;
    // Sloppy mode ignores the write, strict mode throws; the assertion that matters is the value.
    expect(() => {
      mutable["payments.execute"] = true;
    }).toThrow(TypeError);
    expect(FLAG_DEFAULTS["payments.execute"]).toBe(false);
  });

  it("rejects added and deleted keys", () => {
    const mutable = FLAG_DEFAULTS as unknown as Record<string, boolean>;
    expect(() => {
      mutable["brand.new"] = true;
    }).toThrow(TypeError);
    expect(() => {
      delete mutable["iab.enabled"];
    }).toThrow(TypeError);
    expect(FLAG_DEFAULTS["iab.enabled"]).toBe(true);
  });

  it("still spreads into a fresh mutable object for resolution", () => {
    const first = resolveFlags({ "iab.enabled": false });
    expect(first.flags["iab.enabled"]).toBe(false);
    // The next resolution must not have inherited the previous one's value.
    expect(resolveFlags().flags["iab.enabled"]).toBe(true);
    expect(FLAG_DEFAULTS["iab.enabled"]).toBe(true);
  });

  it("hands out a copy of the flag list, so a caller cannot shorten it", () => {
    const list = listFeatureFlags();
    const originalLength = list.length;
    list.length = 0;
    expect(listFeatureFlags()).toHaveLength(originalLength);
  });
});

describe("override parsing", () => {
  it("treats a bare name as on and name=false as off", () => {
    const { overrides } = parseFlagOverrides("iab.enabled,chrome.fallback=false");
    expect(overrides["iab.enabled"]).toBe(true);
    expect(overrides["chrome.fallback"]).toBe(false);
  });

  it("accepts the documented false spellings", () => {
    const { overrides, invalid } = parseFlagOverrides(
      "iab.enabled=0,chrome.fallback=off,vault.enabled=FALSE,audit.chain=no",
    );
    expect(overrides["iab.enabled"]).toBe(false);
    expect(overrides["chrome.fallback"]).toBe(false);
    expect(overrides["vault.enabled"]).toBe(false);
    expect(overrides["audit.chain"]).toBe(false);
    expect(invalid).toEqual([]);
  });

  it("accepts the documented true spellings", () => {
    const { overrides, invalid } = parseFlagOverrides(
      "iab.enabled=1,chrome.fallback=ON,vault.enabled=true,audit.chain=yes",
    );
    expect(overrides["iab.enabled"]).toBe(true);
    expect(overrides["chrome.fallback"]).toBe(true);
    expect(overrides["vault.enabled"]).toBe(true);
    expect(overrides["audit.chain"]).toBe(true);
    expect(invalid).toEqual([]);
  });

  it("tolerates spacing and empty entries", () => {
    const { overrides, unknown, invalid } = parseFlagOverrides(
      "  iab.enabled , , chrome.fallback ",
    );
    expect(overrides["iab.enabled"]).toBe(true);
    expect(overrides["chrome.fallback"]).toBe(true);
    expect(unknown).toEqual([]);
    expect(invalid).toEqual([]);
  });

  it("surfaces unknown names instead of dropping them", () => {
    const { overrides, unknown } = parseFlagOverrides("iab.enabled,vault.enabledd");
    expect(overrides["iab.enabled"]).toBe(true);
    expect(unknown).toEqual(["vault.enabledd"]);
  });

  it("returns nothing for an absent variable", () => {
    expect(parseFlagOverrides(undefined)).toEqual({ overrides: {}, unknown: [], invalid: [] });
  });
});

describe("override parsing rejects unrecognised values instead of coercing them", () => {
  // The regression this guards: a parser that treated "not a false spelling" as true would read
  // `payments.execute=flase` as a *request to enable payments*. A typo must never be the reason
  // a capability turns on.
  it("does not enable a payment flag on a misspelled false", () => {
    const { overrides, invalid } = parseFlagOverrides("payments.execute=flase");
    expect(overrides["payments.execute"]).toBe(false);
    expect(invalid).toEqual([{ flag: "payments.execute", value: "flase" }]);
  });

  it.each([
    ["vault.l2l3=flase", "vault.l2l3", "flase"],
    ["secret_entry.live=nope", "secret_entry.live", "nope"],
    ["payments.agent_click_pay=disabled", "payments.agent_click_pay", "disabled"],
    ["vault.enabled=2", "vault.enabled", "2"],
    ["audit.chain=", "audit.chain", ""],
  ])("leaves %s off and reports it", (entry, flag, value) => {
    const { overrides, invalid } = parseFlagOverrides(entry);
    expect(overrides[flag as FeatureFlag]).toBe(false);
    expect(invalid).toEqual([{ flag, value }]);
  });

  it("keeps the resolved value disabled when the value is unparseable", () => {
    // Deliberately not phrased as "at its default": a default may one day be true, and the
    // guarantee being asserted is that an unparseable value resolves to false regardless.
    const { overrides } = parseFlagOverrides("payments.execute=flase");
    const { flags } = resolveFlags(overrides, TRUSTED_PROBE);
    expect(flags["payments.execute"]).toBe(false);
  });

  it("does not let a bad entry disturb the good ones beside it", () => {
    const { overrides, invalid, unknown } = parseFlagOverrides(
      "iab.enabled,vault.enabled=maybe,chrome.fallback=false,nope.flag",
    );
    expect(overrides["iab.enabled"]).toBe(true);
    expect(overrides["chrome.fallback"]).toBe(false);
    expect(overrides["vault.enabled"]).toBe(false);
    expect(invalid).toEqual([{ flag: "vault.enabled", value: "maybe" }]);
    expect(unknown).toEqual(["nope.flag"]);
  });

  it("reports an explicitly-off flag as valid, not invalid", () => {
    const { overrides, invalid } = parseFlagOverrides("payments.execute=false");
    expect(overrides["payments.execute"]).toBe(false);
    expect(invalid).toEqual([]);
  });
});

describe("repeated entries are last-entry-wins, and an invalid value still means off", () => {
  // The regression this guards: skipping an invalid entry instead of writing `false` reaches the
  // default only when nothing set the flag earlier. With an earlier `=true` in the same string,
  // the bad entry meant to reject it would have left the capability enabled.
  it("true then invalid resolves to false and still reports the bad value", () => {
    const { overrides, invalid } = parseFlagOverrides(
      "payments.execute=true,payments.execute=flase",
    );
    expect(overrides["payments.execute"]).toBe(false);
    expect(invalid).toEqual([{ flag: "payments.execute", value: "flase" }]);
  });

  it("invalid then true resolves to true and still reports the earlier bad value", () => {
    const { overrides, invalid } = parseFlagOverrides(
      "payments.execute=flase,payments.execute=true",
    );
    expect(overrides["payments.execute"]).toBe(true);
    expect(invalid).toEqual([{ flag: "payments.execute", value: "flase" }]);
  });

  it("takes the last value for a plainly repeated flag", () => {
    expect(parseFlagOverrides("iab.enabled=true,iab.enabled=false").overrides["iab.enabled"]).toBe(
      false,
    );
    expect(parseFlagOverrides("iab.enabled=false,iab.enabled=true").overrides["iab.enabled"]).toBe(
      true,
    );
  });

  it("carries the last-entry-wins result through to the resolved flags", () => {
    // vault.l2l3 needs vault.enabled, so the surviving `false` must also take the dependant down.
    const { overrides } = parseFlagOverrides(
      "vault.enabled=true,vault.l2l3=true,vault.enabled=flase",
    );
    const { flags } = resolveFlags(overrides);
    expect(flags["vault.enabled"]).toBe(false);
    expect(flags["vault.l2l3"]).toBe(false);
  });

  it("reports every invalid occurrence, not just the last", () => {
    const { invalid } = parseFlagOverrides("audit.chain=maybe,audit.chain=perhaps");
    expect(invalid).toEqual([
      { flag: "audit.chain", value: "maybe" },
      { flag: "audit.chain", value: "perhaps" },
    ]);
  });
});

describe("what Phase 3 ships with", () => {
  // Pinned rather than assumed. Both of these decide whether an application types a one-time code
  // or presses a button that moves money, and both are off in every configuration this phase can
  // produce: their prerequisites need a vault and an isolated agent runtime, which are Phase 4/5.
  it("never types a real one-time code", () => {
    expect(resolveFlags().flags["secret_entry.live"]).toBe(false);
    // Even asked for directly, and even with the contract on.
    expect(
      resolveFlags({ "secret_entry.contract": true, "secret_entry.live": true }).flags[
        "secret_entry.live"
      ],
    ).toBe(false);
  });

  it("never presses the site's pay button", () => {
    expect(resolveFlags().flags["payments.agent_click_pay"]).toBe(false);
    expect(
      resolveFlags({ "payments.agent_click_pay": true }).flags["payments.agent_click_pay"],
    ).toBe(false);
    // It takes the whole Phase 4 chain — a vault, real L2/L3, an execute path — *and* both runtime
    // facts before this can be on at all.
    expect(
      resolveFlags(
        {
          "vault.enabled": true,
          "vault.l2l3": true,
          "payments.execute": true,
          "payments.agent_click_pay": true,
        },
        { encryptedStorageAvailable: true, agentRuntimeIsolated: true },
      ).flags["payments.agent_click_pay"],
    ).toBe(true);
  });
});

describe("resolveFlags applies the capability probe, so it cannot be skipped", () => {
  // The regression this guards: resolveFlags used to stop after the dependency closure, so a
  // production caller could ask for payments.execute and simply receive it — the module's
  // "forgetting to probe enables nothing" claim was false for anyone who called it directly.
  it("refuses every runtime-gated capability when no probe is passed", () => {
    const { flags } = resolveFlags(ALL_REQUESTED);
    expect(flags["vault.enabled"]).toBe(false);
    expect(flags["vault.l2l3"]).toBe(false);
    expect(flags["secret_entry.live"]).toBe(false);
    expect(flags["payments.execute"]).toBe(false);
    expect(flags["payments.agent_click_pay"]).toBe(false);
    expect(flags["audit.chain"]).toBe(false);
  });

  it("leaves browser flags alone under an empty probe", () => {
    const { flags } = resolveFlags(ALL_REQUESTED);
    expect(flags["iab.enabled"]).toBe(true);
    expect(flags["chrome.fallback"]).toBe(true);
    // The synthetic-only contract is not gated on a runtime fact either.
    expect(flags["secret_entry.contract"]).toBe(true);
  });

  it("grants the full payment and secret chain when both facts are measured true", () => {
    const { flags, denials } = resolveFlags(ALL_REQUESTED, TRUSTED_PROBE);
    expect(flags["vault.enabled"]).toBe(true);
    expect(flags["vault.l2l3"]).toBe(true);
    expect(flags["secret_entry.live"]).toBe(true);
    expect(flags["payments.execute"]).toBe(true);
    expect(flags["payments.agent_click_pay"]).toBe(true);
    expect(flags["audit.chain"]).toBe(true);
    expect(denials).toEqual([]);
  });

  it("refuses the protected tier when only storage is measured", () => {
    const { flags } = resolveFlags(ALL_REQUESTED, { encryptedStorageAvailable: true });
    expect(flags["vault.enabled"]).toBe(true);
    expect(flags["vault.l2l3"]).toBe(false);
    expect(flags["secret_entry.live"]).toBe(false);
    expect(flags["payments.execute"]).toBe(false);
  });

  it("refuses everything vault-backed when only isolation is measured", () => {
    const { flags } = resolveFlags(ALL_REQUESTED, { agentRuntimeIsolated: true });
    expect(flags["vault.enabled"]).toBe(false);
    expect(flags["vault.l2l3"]).toBe(false);
    expect(flags["payments.execute"]).toBe(false);
  });

  // Both resolution stages can deny the same flag, and their lists are merged first-wins. The
  // merge helper is private, so this asserts the observable property across every shape a caller
  // can actually produce rather than unit-testing the helper directly.
  it.each([
    ["no probe", {} as CapabilityProbe],
    ["storage only", { encryptedStorageAvailable: true } as CapabilityProbe],
    ["isolation only", { agentRuntimeIsolated: true } as CapabilityProbe],
    [
      "storage false, isolation false",
      {
        encryptedStorageAvailable: false,
        agentRuntimeIsolated: false,
      } as CapabilityProbe,
    ],
  ])("reports each denied flag at most once (%s)", (_label, probe) => {
    const denied = resolveFlags(ALL_REQUESTED, probe).denials.map((d) => d.flag);
    expect(new Set(denied).size).toBe(denied.length);
  });

  it("reports each denied flag at most once when only the closure denies", () => {
    // vault.l2l3 and payments.execute fall to the dependency closure, not the probe.
    const denied = resolveFlags(
      { "vault.l2l3": true, "payments.execute": true, "audit.chain": true },
      TRUSTED_PROBE,
    ).denials.map((d) => d.flag);
    expect(new Set(denied).size).toBe(denied.length);
    expect(denied.length).toBeGreaterThan(0);
  });

  it("keeps the first reason when a flag could be denied by both stages", () => {
    const denials = resolveFlags(ALL_REQUESTED, { encryptedStorageAvailable: false }).denials;
    const forL2L3 = denials.filter((d) => d.flag === "vault.l2l3");
    expect(forL2L3).toHaveLength(1);
  });
});

describe("dependency closure", () => {
  it("keeps independent flags on", () => {
    const { flags, denials } = resolveFlags({ "iab.enabled": true, "chrome.fallback": true });
    expect(flags["iab.enabled"]).toBe(true);
    expect(flags["chrome.fallback"]).toBe(true);
    expect(denials).toEqual([]);
  });

  it("refuses vault.l2l3 without vault.enabled", () => {
    const { flags, denials } = resolveFlags({ "vault.l2l3": true });
    expect(flags["vault.l2l3"]).toBe(false);
    expect(denials.map((d) => d.flag)).toContain("vault.l2l3");
  });

  it("refuses a live secret fill without the contract and the protected tier", () => {
    const bare = resolveFlags({ "secret_entry.live": true });
    expect(bare.flags["secret_entry.live"]).toBe(false);

    const withContractOnly = resolveFlags({
      "secret_entry.contract": true,
      "secret_entry.live": true,
    });
    expect(withContractOnly.flags["secret_entry.live"]).toBe(false);

    // A plain vault is not enough: a live fill handles real L3 material, so it sits behind the
    // same gate as L2 storage (003 §7.3).
    const withPlainVault = resolveFlags({
      "secret_entry.contract": true,
      "vault.enabled": true,
      "secret_entry.live": true,
    });
    expect(withPlainVault.flags["secret_entry.live"]).toBe(false);

    const withProtectedTier = resolveFlags(
      {
        "secret_entry.contract": true,
        "vault.enabled": true,
        "vault.l2l3": true,
        "secret_entry.live": true,
      },
      TRUSTED_PROBE,
    );
    expect(withProtectedTier.flags["secret_entry.live"]).toBe(true);
  });

  it("collapses a two-hop chain when the root is off", () => {
    // payments.execute → vault.l2l3 → vault.enabled
    const { flags } = resolveFlags({ "payments.execute": true, "vault.l2l3": true });
    expect(flags["vault.enabled"]).toBe(false);
    expect(flags["vault.l2l3"]).toBe(false);
    expect(flags["payments.execute"]).toBe(false);
  });

  it("collapses the three-hop chain down to agent_click_pay", () => {
    const { flags } = resolveFlags({ "payments.agent_click_pay": true });
    expect(flags["payments.agent_click_pay"]).toBe(false);
  });

  it("grants the full payment chain only when every link is present", () => {
    const { flags, denials } = resolveFlags(
      {
        "vault.enabled": true,
        "vault.l2l3": true,
        "payments.execute": true,
        "payments.agent_click_pay": true,
      },
      TRUSTED_PROBE,
    );
    expect(flags["payments.agent_click_pay"]).toBe(true);
    expect(denials).toEqual([]);
  });
});

describe("capability probe", () => {
  const fullyOn: Partial<Record<FeatureFlag, boolean>> = {
    "iab.enabled": true,
    "chrome.fallback": true,
    "secret_entry.contract": true,
    "vault.enabled": true,
    "vault.l2l3": true,
    "secret_entry.live": true,
    "payments.execute": true,
    "payments.agent_click_pay": true,
    "audit.chain": true,
  };

  it("clears every vault-backed capability when storage is not encrypted", () => {
    const granted = resolveFlags(fullyOn, TRUSTED_PROBE).flags;
    const { flags, denials } = applyCapabilityProbe(granted, {
      encryptedStorageAvailable: false,
      agentRuntimeIsolated: true,
    });
    expect(flags["vault.enabled"]).toBe(false);
    expect(flags["vault.l2l3"]).toBe(false);
    expect(flags["secret_entry.live"]).toBe(false);
    expect(flags["payments.execute"]).toBe(false);
    expect(flags["audit.chain"]).toBe(false);
    expect(denials.length).toBeGreaterThan(0);
    // The browser itself is untouched: 004 §5 keeps phases 0-3 out of the security gate.
    expect(flags["iab.enabled"]).toBe(true);
    expect(flags["chrome.fallback"]).toBe(true);
  });

  it("clears real personal data, live secret fills and payments when the runtime is not isolated", () => {
    const granted = resolveFlags(fullyOn, TRUSTED_PROBE).flags;
    const { flags, denials } = applyCapabilityProbe(granted, {
      encryptedStorageAvailable: true,
      agentRuntimeIsolated: false,
    });
    expect(flags["vault.l2l3"]).toBe(false);
    expect(flags["payments.execute"]).toBe(false);
    expect(flags["payments.agent_click_pay"]).toBe(false);
    // A live fill puts a real CVV/OTP into a page the agent can read once its CDP capability
    // returns (003 §1.3, §7.3), so an unisolated runtime must take it down too.
    expect(flags["secret_entry.live"]).toBe(false);
    expect(denials.find((d) => d.flag === "secret_entry.live")?.reason).toMatch(/isolat/i);
    // An L1-only vault survives: that is the "guards against accidents" mode of 003 §0.3.
    expect(flags["vault.enabled"]).toBe(true);
    // The contract itself is synthetic-only, so it is unaffected.
    expect(flags["secret_entry.contract"]).toBe(true);
  });

  it("treats an unprobed capability as unmet", () => {
    const granted = resolveFlags(fullyOn, TRUSTED_PROBE).flags;
    const { flags } = applyCapabilityProbe(granted, {});
    expect(flags["vault.enabled"]).toBe(false);
    expect(flags["vault.l2l3"]).toBe(false);
    expect(flags["payments.execute"]).toBe(false);
  });

  it("never turns an additional flag on", () => {
    const defaults = resolveFlags().flags;
    const { flags } = applyCapabilityProbe(defaults, {
      encryptedStorageAvailable: true,
      agentRuntimeIsolated: true,
    });
    expect(flags).toEqual(defaults);
  });

  it("explains each denial in terms a log can carry", () => {
    const granted = resolveFlags(fullyOn, TRUSTED_PROBE).flags;
    const { denials } = applyCapabilityProbe(granted, { encryptedStorageAvailable: false });
    const vault = denials.find((d) => d.flag === "vault.enabled");
    expect(vault?.reason).toMatch(/encrypted storage/i);
    expect(vault?.reason).toMatch(/003/);
  });
});

describe("resolveFlagsFromEnv", () => {
  it("combines env overrides with a probe and reports unknown names", () => {
    const result = resolveFlagsFromEnv(
      { PENGUIN_FLAGS: "iab.enabled,vault.enabled,nope.flag" },
      { encryptedStorageAvailable: false },
    );
    expect(result.flags["iab.enabled"]).toBe(true);
    expect(result.flags["vault.enabled"]).toBe(false);
    expect(result.unknown).toEqual(["nope.flag"]);
    expect(result.denials.map((d) => d.flag)).toContain("vault.enabled");
  });

  it("enables both browser backends for an empty environment", () => {
    const result = resolveFlagsFromEnv({}, {});
    expect(result.flags["iab.enabled"]).toBe(true);
    expect(result.flags["chrome.fallback"]).toBe(true);
    expect(
      Object.entries(result.flags).every(
        ([flag, enabled]) => flag === "iab.enabled" || flag === "chrome.fallback" || !enabled,
      ),
    ).toBe(true);
    expect(result.unknown).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it("passes an unparseable value through as invalid and leaves the flag off", () => {
    const result = resolveFlagsFromEnv(
      { PENGUIN_FLAGS: "payments.execute=flase" },
      { encryptedStorageAvailable: true, agentRuntimeIsolated: true },
    );
    expect(result.flags["payments.execute"]).toBe(false);
    expect(result.invalid).toEqual([{ flag: "payments.execute", value: "flase" }]);
  });

  it("fails closed on gated flags when the probe argument is omitted entirely", () => {
    // Same guarantee as resolveFlags: this path must not become the way to skip the probe.
    const result = resolveFlagsFromEnv({
      PENGUIN_FLAGS: "iab.enabled,vault.enabled,vault.l2l3,payments.execute",
    });
    expect(result.flags["vault.enabled"]).toBe(false);
    expect(result.flags["vault.l2l3"]).toBe(false);
    expect(result.flags["payments.execute"]).toBe(false);
    expect(result.flags["iab.enabled"]).toBe(true);
  });

  it("grants the gated chain when the environment and both measured facts agree", () => {
    const result = resolveFlagsFromEnv(
      { PENGUIN_FLAGS: "vault.enabled,vault.l2l3,payments.execute" },
      TRUSTED_PROBE,
    );
    expect(result.flags["payments.execute"]).toBe(true);
    expect(result.denials).toEqual([]);
  });

  it("still refuses a live secret fill on a probed-but-unisolated host", () => {
    const result = resolveFlagsFromEnv(
      {
        PENGUIN_FLAGS: "secret_entry.contract,vault.enabled,vault.l2l3,secret_entry.live",
      },
      { encryptedStorageAvailable: true, agentRuntimeIsolated: false },
    );
    expect(result.flags["secret_entry.live"]).toBe(false);
    expect(result.flags["vault.l2l3"]).toBe(false);
    expect(result.flags["vault.enabled"]).toBe(true);
  });
});
