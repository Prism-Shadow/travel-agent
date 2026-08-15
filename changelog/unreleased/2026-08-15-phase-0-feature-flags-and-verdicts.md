# Phase 0: feature flags, manual-testing scaffold, and three verdicts

Groundwork for the browser workspace (design/002) and the privacy/payment work (design/003). No
user-visible capability ships here — every feature flag defaults off, including `iab.enabled`.

**Feature flags.** `packages/core/src/state/feature-flags.ts` declares every gated capability from
design/004 §5 with its default, its prerequisites, and a runtime probe. The defaults table is frozen
and typed read-only, so no importer can move a product default for the rest of the process. Three
further properties matter. The
dependency closure runs to a fixpoint, so asking for `payments.execute` without a vault yields the safe
subset rather than the combination requested. Override values are parsed strictly — `true/1/on/yes` and
`false/0/off/no`, nothing else — because a parser that read "not a false spelling" as true would have
treated `payments.execute=flase` as a request to enable payments; repeats are last-entry-wins and an
unrecognised value resolves to `false` rather than being skipped, so a bad entry cannot leave an earlier
`=true` standing. And the probe can only tighten: a fact it does not report is treated as unmet, so a
host that passes no probe enables none of the gated capabilities. That last part is structural rather
than advisory: `resolveFlags` applies the probe itself and defaults it to `{}`, so there is no public
entry point that resolves flags while skipping it. What none of this defends against is a probe that
reports `true` incorrectly — that guarantee is only as good as the measurement behind it, and the
comments say so instead of claiming more.

**Three verdicts.** Electron 43's `WebContentsView` renders a real page, `webContents.debugger` speaks
the CDP the relay's tunnel needs, and Playwright's `connectOverCDP` can click inside it. But
`Target.createTarget` answers **"Not supported"** on Electron, through both the raw debugger and
Playwright — so `tabs.open()` in IAB mode must construct a view in the main process rather than call
`newPage()`. That closes design/002 §11.3's first open question, and the prediction recorded there was
right.

**safeStorage.** `packages/desktop/scripts/probe-safe-storage.mjs` makes design/003 §4.4's fail-closed
rule executable: it prints a JSON report and exits non-zero when the vault must not start. The
development host is itself the degraded case — no keyring, a `basic_text` backend — which means the
refusal path can be exercised natively instead of mocked. macOS and Windows are recorded as PENDING
rather than assumed.

**Manual testing.** `docs/manual-testing/` gains a template with the status machine from design/004 §4,
plus Phase 0's four PENDING items — the checks this headless, keyring-less host could not run. They do
not block Phase 1.

Full record, including the pre-existing `browser-cli` baseline (its tests need a Chromium revision that
nothing in the repo or CI installs): `docs/verification/phase-00.md`.
