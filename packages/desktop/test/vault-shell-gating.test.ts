/**
 * The gating decision the shell makes, without Electron.
 *
 * `startVaultShell` itself reaches for `app`, `dialog` and `safeStorage`, so it is not what runs
 * here. What runs is the same resolution it performs — flags resolved with the storage probe folded
 * in — proving the two properties 004 Phase 4's exit criteria name: a failed probe turns the gated
 * flags off *with reasons*, and `secret_entry.live` stays off in this phase because nothing
 * reports the isolation it requires.
 */
import { describe, expect, it } from "vitest";

import { resolveFlags } from "@prismshadow/penguin-core";
import { judgeStorage } from "../src/vault/safe-storage.js";

/** The probe the shell builds: storage from `judgeStorage`, isolation never true this phase. */
function probeFor(facts: Parameters<typeof judgeStorage>[0]) {
  return { encryptedStorageAvailable: judgeStorage(facts).usable };
}

const ASKING_FOR_EVERYTHING = {
  "vault.enabled": true,
  "vault.l2l3": true,
  "audit.chain": true,
  "secret_entry.contract": true,
  "secret_entry.live": true,
} as const;

describe("with usable encrypted storage but no isolation — this phase's machine", () => {
  const resolved = resolveFlags(
    ASKING_FOR_EVERYTHING,
    probeFor({ platform: "darwin", encryptionAvailable: true, backend: null }),
  );

  it("lets the vault and its L1 machinery on", () => {
    expect(resolved.flags["vault.enabled"]).toBe(true);
    expect(resolved.flags["audit.chain"]).toBe(true);
    expect(resolved.flags["secret_entry.contract"]).toBe(true);
  });

  it("keeps every capability that needs isolation off, with a reason", () => {
    for (const flag of ["vault.l2l3", "secret_entry.live"] as const) {
      expect(resolved.flags[flag]).toBe(false);
    }
    const reasons = resolved.denials.map((denial) => denial.reason).join(" ");
    expect(reasons).toMatch(/isolat/i);
  });
});

describe("on a Linux box with no keyring — attack A9", () => {
  const resolved = resolveFlags(
    ASKING_FOR_EVERYTHING,
    probeFor({ platform: "linux", encryptionAvailable: true, backend: "basic_text" }),
  );

  it("refuses the vault outright, so startVaultShell returns null", () => {
    expect(resolved.flags["vault.enabled"]).toBe(false);
    // And with the vault off, everything that stands on it falls too.
    expect(resolved.flags["audit.chain"]).toBe(false);
    expect(resolved.flags["vault.l2l3"]).toBe(false);
    expect(
      resolved.denials.some((denial) => /basic_text|unavailable|refuses/i.test(denial.reason)),
    ).toBe(true);
  });
});

describe("the ordering that keeps secret_entry.live gated", () => {
  it("cannot be turned on without vault.l2l3, which cannot be turned on without isolation", () => {
    // secret_entry.live depends on vault.l2l3 (real L3 material), which depends on the
    // isolation probe. So there is no environment in this phase where the live fill is reachable —
    // exactly the sequence a test is asked to pin.
    const resolved = resolveFlags(
      { "vault.enabled": true, "secret_entry.contract": true, "secret_entry.live": true },
      probeFor({ platform: "darwin", encryptionAvailable: true, backend: null }),
    );
    expect(resolved.flags["secret_entry.live"]).toBe(false);
  });
});
