# Relay text redaction is built, tested, and never called

- **Status:** open, deliberate for now — must be closed *before* secret entry goes live
- **Area:** `packages/browser-cli/src/shared/redaction.ts`, and the three render paths in `src/page/`
- **Found:** 2026-08-19, while mapping `src/` for the layout refactor

## Summary

`redaction.ts` implements the relay half of the private-profile redaction contract: the values the main process types into
a page must not come back out through what the agent reads. It exports `redactText`,
`judgeScreenshot`, `fingerprintOf`, `shapeOf`, `redactionLabel` — all unit-tested.

**Nothing calls any of it.** Re-verified 2026-08-20: each of the five exports (`redactText`,
`judgeScreenshot`, `fingerprintOf`, `shapeOf`, `redactionLabel`) still has **zero** call sites
outside `redaction.ts`, and the three render paths named below still exist unchanged. Wiring it is
not a bug fix but the cross-process feature that must land with secret entry: the relay would have
to learn which values are sensitive, and that transport does not exist yet.

Original verification:

- `redactText` / `judgeScreenshot`: zero call sites in the repo outside `redaction.unit.test.ts`.
- `RedactionEntry` never appears in `src/relay/cdp-relay.ts`, `src/executor/executor.ts` or
  `src/relay/relay-state.ts` — the relay has no channel to *receive* entries in the first place.
- The three outputs the agent actually reads — `src/page/aria-snapshot.ts`,
  `src/page/page-markdown.ts`, `src/page/clean-html.ts` — contain no `redact` call at all.

The producing half is wired: `packages/desktop/src/vault/sensitive-elements.ts` publishes
fingerprints and has its own `fingerprintOf`, and `packages/desktop/test/vault-redaction-agreement.test.ts`
pins the two implementations to the same golden values. So the contract is agreed and tested at both
ends, with no wire between them.

## Why this is not currently a leak

`secret_entry.live` and `vault.l2l3` are fail-closed, gated behind the
unresolved isolation decision D3 (`../decisions/proposed/2026-08-16-agent-runtime-isolation.md`). Nothing is typed into a page,
so there is nothing to redact. The code is ahead of the gate, not broken behind it.

## Why it still needs recording

The moment that gate opens, **leaking is the default behaviour** — the render path has no redaction
step to fail, it has no redaction step at all. The failure mode is silent and looks like success.

This must be an explicit item on the checklist for enabling L2/L3 secret entry:

1. Give the relay a channel to receive `RedactionEntry` values plus the salt (003 §6.5 says the
   salt travels over the relay's own control channel; that channel does not exist yet).
2. Call `redactText` in `aria-snapshot`, `page-markdown` and `clean-html` — *enumerate, do not
   sample*, the same rule `write-gate.ts` states for writes.
3. Call `judgeScreenshot` on the screenshot path.
4. Add a test that asserts a vault-filled value cannot appear in any of the four outputs.

## Alternative

If secret entry is never enabled, delete `redaction.ts` and its test rather than leaving a
mechanism that reads as protection. The repo already applied exactly this rule when it removed
`@travel-agent/domain`: code with no caller through six phases was deleted, not kept.
