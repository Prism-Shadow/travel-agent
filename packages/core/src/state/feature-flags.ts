/**
 * Feature flags for the browser-workspace and privacy/payment work.
 *
 * Every capability that design/004 §5 puts behind a gate is declared here, defaults
 * included, so that "what is on by default" is one readable table rather than a property
 * scattered across call sites. Nothing in this module reads a browser, a vault or a
 * payment path — it only answers *whether* a capability may be attempted.
 *
 * Three rules shape the design:
 *
 * 1. **Explicit, conservative product defaults.** The in-app browser is the desktop baseline and
 *    defaults on. Security-sensitive or optional capabilities stay off until their own rollout
 *    criteria are met, keeping those paths independently revertible (004 §3).
 *
 * 2. **Dependencies are declared, not remembered.** `secret_entry.live` must never be on
 *    while the vault is unavailable, and `payments.execute` must never be on while
 *    `vault.l2l3` is off (003 §0.3, §5). Encoding that here means a mis-set override
 *    degrades to "off" instead of to an unsafe combination — `resolveFlags` recomputes the
 *    closure every time rather than trusting the caller.
 *
 * 3. **A runtime probe can only tighten, never loosen — and it is not skippable.** The probe
 *    carries the facts a host discovered (is safeStorage usable, is the agent runtime isolated),
 *    and `resolveFlags` applies it as part of resolution rather than leaving it to the caller. It
 *    defaults to `{}`, which reports nothing, so a *missing* fact fails closed: an unprobed
 *    capability is treated as unmet and a host that passes no probe enables none of the gated
 *    ones. What this does **not** buy is protection from a probe that reports `true` when the
 *    fact is false: the flag then stays on, and the guarantee is only as good as the probe's
 *    source. Callers must therefore derive these fields from a real measurement (see
 *    `packages/desktop/scripts/probe-safe-storage.mjs`), never from a default or a cached guess.
 *
 * Overrides come from the environment (`PENGUIN_FLAGS="iab.enabled=false,vault.enabled"`) so that
 * a developer can change a capability for one run without editing code, and so the desktop shell
 * can pass a decision down to the server it forks. Product defaults never live in an env var; this
 * module is the single source for them.
 */

/** Every gated capability. Keep in sync with design/004 §5. */
export type FeatureFlag =
  /** Phase 1: render the in-app browser (WebContentsView) and route sessions to it. */
  | "iab.enabled"
  /** Phase 2: offer the user's real Chrome (extension backend) as a task-level alternative. */
  | "chrome.fallback"
  /** Phase 3: the `secret_entry` interaction contract, exercised with synthetic values only. */
  | "secret_entry.contract"
  /** Phase 4: let the main process fill *real* one-time codes (needs scoped secret phase). */
  | "secret_entry.live"
  /** Phase 4: the private profile vault, holding L1 projections. */
  | "vault.enabled"
  /** Phase 4/5: real L2/L3 fields. Requires OS-level agent isolation (003 §0.3). */
  | "vault.l2l3"
  /** Phase 4/5: the agent may trigger a real payment through a one-shot capability. */
  | "payments.execute"
  /** Phase 3: the agent may click the site's own "pay" button. Off until 003 §8's machinery lands. */
  | "payments.agent_click_pay"
  /** Phase 4: hash-chained local audit log. */
  | "audit.chain"
  /** Phase 5+: OCR fallback when redacting a value the page re-displayed elsewhere. */
  | "redaction.ocr";

export type FeatureFlags = Record<FeatureFlag, boolean>;

/**
 * Product defaults.
 *
 * The in-app browser is on so `pnpm desktop` provides the browser workspace without an environment
 * override. Every optional or security-sensitive capability remains off and must be enabled
 * explicitly after satisfying its own prerequisites.
 *
 * **Frozen, and typed read-only.** The `Readonly` type stops a compile-time write; `Object.freeze`
 * stops a runtime one. Both are needed: without the freeze, any importer could do
 * `(FLAG_DEFAULTS as FeatureFlags)["payments.execute"] = true` and move the product default for
 * every later `resolveFlags` call in the process — a single mutation, anywhere, silently
 * rewriting the product defaults this module exists to hold. Reading is unaffected, and
 * `resolveFlags` copies via spread before touching anything.
 */
export const FLAG_DEFAULTS: Readonly<FeatureFlags> = Object.freeze({
  "iab.enabled": true,
  "chrome.fallback": false,
  "secret_entry.contract": false,
  "secret_entry.live": false,
  "vault.enabled": false,
  "vault.l2l3": false,
  "payments.execute": false,
  "payments.agent_click_pay": false,
  "audit.chain": false,
  "redaction.ocr": false,
});

const ALL_FLAGS = Object.keys(FLAG_DEFAULTS) as FeatureFlag[];

/** Whether `name` is a declared flag (used to reject typos in overrides rather than ignore them). */
export function isFeatureFlag(name: string): name is FeatureFlag {
  return Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, name);
}

/** Every declared flag name, for diagnostics and settings UIs. */
export function listFeatureFlags(): FeatureFlag[] {
  return [...ALL_FLAGS];
}

/**
 * What a flag needs before it may be on, beyond being requested.
 *
 * Read as "this flag additionally requires all of these". Enforced by {@link resolveFlags} as a
 * fixpoint, so a chain (`payments.execute` → `vault.l2l3` → `vault.enabled`) collapses correctly
 * no matter which link is missing.
 */
const FLAG_REQUIRES: Partial<Record<FeatureFlag, FeatureFlag[]>> = {
  // A live secret fill handles real L3 material — a CVV, an OTP, a 3DS code — through the
  // scoped secret phase of 003 §7.3, which detaches the agent's CDP capability and refuses to
  // restore it until the field is proven clear. That machinery is part of the same protected
  // tier as L2 storage, so it depends on `vault.l2l3` rather than merely on a vault existing:
  // requiring the weaker `vault.enabled` would have let real secrets be filled on a host where
  // the agent runtime is not isolated, which is exactly what 003 §0.3 forbids.
  "secret_entry.live": ["secret_entry.contract", "vault.l2l3"],
  // L2/L3 are vault fields; there is no L2 without a vault.
  "vault.l2l3": ["vault.enabled"],
  // Paying needs a stored, decryptable payment credential, which is an L2 field (003 §9.2).
  "payments.execute": ["vault.l2l3"],
  // Clicking "pay" without the execute path would be the bypass 003 §10.3 exists to prevent.
  "payments.agent_click_pay": ["payments.execute"],
  // The audit chain's key is protected by the same keychain the vault uses (003 §5.3).
  "audit.chain": ["vault.enabled"],
};

/** Facts a host discovered at runtime. Absent fields mean "not yet probed" and are treated as unmet. */
export interface CapabilityProbe {
  /**
   * `safeStorage.isEncryptionAvailable()` and, on Linux, a backend other than `basic_text`.
   * See 003 §4.4 — a `basic_text` backend stores plaintext, so the vault must not start.
   */
  encryptedStorageAvailable?: boolean;
  /**
   * Whether the agent runtime is confined away from `userData`, the keychain and the main
   * process (003 §0.3). Without it the vault is a guard against accidents, not an attacker,
   * so real L2/L3 must stay off.
   */
  agentRuntimeIsolated?: boolean;
}

/** A flag that was requested but could not be granted, with the reason, for logging and UI. */
export interface FlagDenial {
  flag: FeatureFlag;
  reason: string;
}

export interface ResolvedFlags {
  flags: FeatureFlags;
  /** Requested-but-denied flags. Empty when nothing was asked for that could not be granted. */
  denials: FlagDenial[];
}

/** Accepted spellings. Anything else is rejected rather than coerced — see {@link parseFlagOverrides}. */
const TRUE_SPELLINGS = new Set(["true", "1", "on", "yes"]);
const FALSE_SPELLINGS = new Set(["false", "0", "off", "no"]);

/** An override entry that named a real flag but carried a value that is neither true nor false. */
export interface InvalidFlagValue {
  flag: FeatureFlag;
  /** The rejected value, as written (trimmed), so a log can show the typo back to the author. */
  value: string;
}

export interface FlagOverrideParse {
  overrides: Partial<FeatureFlags>;
  /** Entries whose name is not a declared flag. */
  unknown: string[];
  /** Entries with a valid name but an unrecognised value. Left **off**; never coerced to on. */
  invalid: InvalidFlagValue[];
}

/**
 * Parses `PENGUIN_FLAGS`: a comma-separated list, each entry `name` (on), `name=true` or
 * `name=false`. Accepted values are `true/1/on/yes` and `false/0/off/no`, case-insensitive.
 *
 * **Unrecognised values are rejected, not coerced.** An earlier revision treated "anything that
 * is not a false spelling" as true, which meant `payments.execute=flase` silently *requested*
 * the capability — a typo in a config string turning a payment path on is the wrong direction to
 * fail. Such an entry is now reported in `invalid`, so it surfaces as a misconfiguration instead
 * of as an enabled feature.
 *
 * **Repeats are last-entry-wins, and an invalid value counts as an entry.** A duplicated flag
 * takes the value of its final occurrence, and a final occurrence that cannot be parsed resolves
 * to `false` — it is written as `false` rather than skipped, because skipping would leave an
 * *earlier* `=true` standing (`payments.execute=true,payments.execute=flase` would have stayed
 * on). The rule to hold onto: an unparseable value can never be the reason a capability is
 * enabled, whatever came before it in the string.
 *
 * Unknown *names* are likewise returned rather than dropped: a mistyped flag name would
 * otherwise look exactly like a capability that refused to turn on.
 */
export function parseFlagOverrides(raw: string | undefined): FlagOverrideParse {
  const overrides: Partial<FeatureFlags> = {};
  const unknown: string[] = [];
  const invalid: InvalidFlagValue[] = [];
  if (!raw) return { overrides, unknown, invalid };

  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (entry === "") continue;

    const eq = entry.indexOf("=");
    const name = (eq === -1 ? entry : entry.slice(0, eq)).trim();
    if (!isFeatureFlag(name)) {
      unknown.push(name);
      continue;
    }

    // A bare `name` means "turn it on"; `name=<value>` must spell the value out.
    if (eq === -1) {
      overrides[name] = true;
      continue;
    }

    const written = entry.slice(eq + 1).trim();
    const value = written.toLowerCase();
    if (TRUE_SPELLINGS.has(value)) {
      overrides[name] = true;
    } else if (FALSE_SPELLINGS.has(value)) {
      overrides[name] = false;
    } else {
      // Written as `false`, not skipped. Skipping would only reach the default when nothing set
      // this flag earlier in the string; with `payments.execute=true,payments.execute=flase` the
      // earlier `true` would survive the very entry meant to reject it.
      overrides[name] = false;
      invalid.push({ flag: name, value: written });
    }
  }
  return { overrides, unknown, invalid };
}

/**
 * Concatenates two denial lists, keeping the **first** reason recorded for any given flag.
 *
 * Walks the sequence once and grows `seen` as it accepts, rather than seeding `seen` from
 * `primary` and filtering `extra` against that snapshot. The snapshot version let a flag through
 * twice if it appeared twice within `extra` — or within `primary` — because nothing was ever added
 * while scanning. Today's callers each emit at most one denial per flag, so the two versions agree
 * on every reachable input; the point is that the helper now satisfies the contract its name and
 * doc state, instead of relying on a property of its callers that a later caller need not share.
 */
function mergeDenials(primary: FlagDenial[], extra: FlagDenial[]): FlagDenial[] {
  const seen = new Set<FeatureFlag>();
  const merged: FlagDenial[] = [];
  for (const denial of [...primary, ...extra]) {
    if (seen.has(denial.flag)) continue;
    seen.add(denial.flag);
    merged.push(denial);
  }
  return merged;
}

/**
 * Applies a runtime probe to an **already-resolved** flag set, clearing what the environment
 * forbids.
 *
 * Exported for diagnostics and for tests that want to examine this step alone. It is **not** the
 * entry point a host should build on: {@link resolveFlags} and {@link resolveFlagsFromEnv} already
 * run it, and going through them is what makes "forgot to probe" impossible to express.
 *
 * Only ever turns flags **off** — there is no path here that sets one. So a *missing* fact fails
 * closed: an unprobed field is treated as unmet.
 *
 * A `true` in {@link CapabilityProbe} is trusted as given. This function does **not** protect
 * against a probe that reports `true` when the fact is false — that flag simply stays on. Each
 * field must therefore come from a live measurement on this host (see
 * `packages/desktop/scripts/probe-safe-storage.mjs`), never from a default, a cached result, or a
 * value carried over from another machine.
 */
export function applyCapabilityProbe(flags: FeatureFlags, probe: CapabilityProbe): ResolvedFlags {
  const next = { ...flags };
  const denials: FlagDenial[] = [];

  const deny = (flag: FeatureFlag, reason: string): void => {
    if (!next[flag]) return;
    next[flag] = false;
    denials.push({ flag, reason });
  };

  if (probe.encryptedStorageAvailable !== true) {
    const reason =
      "encrypted storage is unavailable (safeStorage off, or a basic_text backend on Linux); " +
      "the vault refuses to start rather than persisting plaintext — see design/003 §4.4";
    deny("vault.enabled", reason);
    deny("vault.l2l3", reason);
    deny("audit.chain", reason);
    deny("secret_entry.live", reason);
    deny("payments.execute", reason);
    deny("payments.agent_click_pay", reason);
  }

  if (probe.agentRuntimeIsolated !== true) {
    const reason =
      "the agent runtime is not isolated from userData, the keychain and the main process, " +
      "so real personal data, live secret fills and stored payment credentials stay off — " +
      "see design/003 §0.3";
    deny("vault.l2l3", reason);
    // Filling a real CVV/OTP puts L3 material into a page the agent can reach the moment its
    // CDP capability comes back (003 §1.3, §7.3). Denied explicitly rather than left to the
    // dependency closure, so the reason a reader sees names the isolation gap.
    deny("secret_entry.live", reason);
    deny("payments.execute", reason);
    deny("payments.agent_click_pay", reason);
  }

  const closed = closeDependencies(next);
  return { flags: closed.flags, denials: mergeDenials(denials, closed.denials) };
}

/**
 * Turns off any flag whose prerequisites are not met, repeatedly, until nothing changes.
 *
 * Iterating to a fixpoint rather than doing one pass is what makes order irrelevant: turning
 * `vault.enabled` off must also take `payments.execute` down through `vault.l2l3`, and that
 * chain is two hops long.
 */
function closeDependencies(input: FeatureFlags): ResolvedFlags {
  const flags = { ...input };
  const denials: FlagDenial[] = [];

  for (;;) {
    let changed = false;
    for (const flag of ALL_FLAGS) {
      if (!flags[flag]) continue;
      const missing = (FLAG_REQUIRES[flag] ?? []).filter((dep) => !flags[dep]);
      if (missing.length === 0) continue;
      flags[flag] = false;
      denials.push({
        flag,
        reason: `requires ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} off`,
      });
      changed = true;
    }
    if (!changed) break;
  }

  return { flags, denials };
}

/**
 * Resolves the effective flag set: defaults, then overrides, then dependency closure, then the
 * capability probe.
 *
 * **The probe is part of this path, not an optional follow-up.** It defaults to `{}`, and an empty
 * probe reports no facts, so every capability gated on a runtime fact — real L2/L3 data, live
 * secret fills, payments — comes back off unless the caller passes measured evidence for it. An
 * earlier revision exported this function without the probe step, which meant a host could ask for
 * `payments.execute` and simply receive it; the module's claim that forgetting to probe enables
 * nothing was untrue for anyone who called this directly. Folding the probe in is what makes that
 * claim hold by construction rather than by convention.
 *
 * Both stages only ever clear flags, so an override asking for an unsupported combination gets the
 * safe subset rather than the combination it asked for.
 */
export function resolveFlags(
  overrides: Partial<FeatureFlags> = {},
  probe: CapabilityProbe = {},
): ResolvedFlags {
  const requested: FeatureFlags = { ...FLAG_DEFAULTS };
  for (const flag of ALL_FLAGS) {
    const value = overrides[flag];
    if (typeof value === "boolean") requested[flag] = value;
  }
  const closed = closeDependencies(requested);
  const probed = applyCapabilityProbe(closed.flags, probe);
  return { flags: probed.flags, denials: mergeDenials(closed.denials, probed.denials) };
}

/**
 * Convenience for hosts: read `PENGUIN_FLAGS` from an environment and resolve it.
 *
 * Delegates to {@link resolveFlags}, so the probe is applied on this path too and an omitted probe
 * fails closed exactly the same way.
 *
 * `unknown` and `invalid` are passed through for the caller to log. Neither is fatal here — a
 * malformed entry resolves that flag to disabled (`false`), which is not the same as "leaves it at
 * its default", since a default may one day be `true` — but both mean the operator wrote something
 * that did not take effect, and silence would hide that.
 */
export function resolveFlagsFromEnv(
  env: Record<string, string | undefined> = process.env,
  probe: CapabilityProbe = {},
): ResolvedFlags & { unknown: string[]; invalid: InvalidFlagValue[] } {
  const { overrides, unknown, invalid } = parseFlagOverrides(env.PENGUIN_FLAGS);
  const resolved = resolveFlags(overrides, probe);
  return { flags: resolved.flags, denials: resolved.denials, unknown, invalid };
}
