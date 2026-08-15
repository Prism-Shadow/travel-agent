/**
 * The one string main and the preload have to agree on.
 *
 * A sandboxed preload has no Node and cannot resolve a feature flag, so main passes its decision
 * down through `additionalArguments` and the preload reads it back out of `process.argv`. Keeping
 * the literal here rather than typing it twice is the whole point: the two halves disagreeing is a
 * silent failure — the preload offers channels main never installed, and every call rejects.
 */
export const IAB_ENABLED_SWITCH = "--travel-agent-iab-enabled";

/**
 * Whether the in-app browser is actually usable this run.
 *
 * Both halves are required, and conflating them produced a real defect: the window advertised the
 * bridge from the flag alone while the pane, the IPC handlers and the transport were installed only
 * once a relay existed. With the flag on and the relay unavailable the renderer showed a browser
 * button whose every call rejected — a capability that looked present and was not.
 *
 * So the decision is made once, before the window is created, and the same boolean gates the
 * preload switch and the wiring. Exported as a pure function so the rule can be tested rather than
 * re-derived at each call site.
 */
export function isIabAvailable(input: { flagEnabled: boolean; relayPort: number | null }): boolean {
  return input.flagEnabled && input.relayPort !== null;
}
