# Chrome backend rollout and consistency repair

- [x] Audit backend defaults, per-conversation preference enforcement, relay availability, UI onboarding, Agent skill, and user documentation.
- [x] Make Chrome an officially available alternative while keeping IAB as the default for new desktop conversations.
- [x] Make the chosen backend authoritative in both directions and prevent low-level CLI defaults from bypassing it.
- [x] Replace disabled/dead-end Chrome UX with actionable setup and connection guidance.
- [x] Align skill text, UI copy, flags, tests, and design/operational documentation.
- [x] Run focused unit tests, type checks, and build verification.
- [x] Review the final diff for unrelated or overlapping user changes.

## Review

- Chrome availability and default selection are now separate: both backends ship, new Desktop conversations explicitly persist IAB, and standalone/plain-web CLI use remains extension-based when no Desktop preference exists.
- Backend auto-resolution is symmetric. Explicit IAB/extension conflicts and direct/headless/cloud bypasses are refused and not offered inside Desktop conversations; preference writes must succeed before UI or draft promotion commits.
- Stored Chrome choices remain visible when temporarily unavailable. Selecting Chrome checks the extension endpoint, opens setup when needed, hides misleading IAB content, explains multi-profile selection, and distinguishes task-tab from existing-tab authorization.
- Current README, Skill, extension onboarding/permissions, feature flags, system prompt kernel, manual verification, design notes, and changelog now state the same contract.
- Verification: all workspace type checks and builds pass; focused backend tests pass; full Core, Server, Web, Desktop, Skills, Transaction, and extension suites pass. Browser CLI's full legacy suite has one pre-existing deterministic screen-recording test failure; its 29 backend-selection/help tests pass. A cross-origin iframe E2E failed once in the full run and passed on isolated retry.
- A concurrent user commit (`db64d28`, travel welcome experience) landed during the work. The final diff is based on that new HEAD and does not revert it.

## IAB bootstrap tab reuse

- [x] Capture the exact IAB bootstrap target created by `session new` and bind it to the executor session.
- [x] Consume that target once on the first `tabs.open(url)` instead of creating a second tab.
- [x] Preserve multi-tab semantics, ownership isolation, navigation error handling, and concurrent-open safety.
- [x] Add regression tests for bootstrap reuse, subsequent opens, stale/mismatched targets, and concurrency.
- [x] Run focused tests, type checks, builds, and final diff review.

### Review

- `session new` now retains the shell's exact bootstrap target id and refuses malformed bootstrap
  replies instead of constructing a session whose placeholder cannot be identified.
- The first IAB `tabs.open(url)` revalidates that exact target as live, blank, and owned by the
  current relay session, then navigates it in place. Its one-shot marker is serialized across
  concurrent opens and restored after a failed navigation so a still-blank placeholder can retry.
- Later opens preserve true multi-tab behavior. Stale, navigated, unclaimed, foreign, and merely
  same-owner blank targets are never substituted for the exact bootstrap.
- Verification: 87 Browser CLI ownership/executor/relay tests, 26 Desktop transport tests, and 20
  Skill contract tests pass; Browser CLI and Skill type checks pass; Browser CLI production build
  passes. `git diff --check` reports no whitespace errors.

## Local default-agent kernel update

- [x] Confirm the source kernel generation and the persisted `default_agent` generation.
- [x] Record the pre-update managed config and run the repository's smart kernel merge.
- [x] Verify the new stamp, advanced defaults, preserved customizations, and idempotency.
- [x] Run the kernel hash guard and server kernel-update route tests.
- [x] Review the final persisted result and workspace diff.

### Review

- The built Core generation was confirmed as `2026-08-19`; the persisted `default_agent` moved
  from `2026-08-12` to `2026-08-19` through `applyKernelUpdate` rather than a destructive reset.
- The merge correctly retained the customized `system_prompt`, `max_turns=100`, and
  `compaction.prompt`. Because that retained prompt still carried the obsolete Chrome-only browser
  sentence, only that sentence was reconciled to the current IAB-default/Chrome-alternative
  contract; all other custom prompt text remains unchanged.
- A second update produced the same three kept fields and an identical SHA-256, proving the
  persisted update is idempotent. The installed preloaded Penguin Browser Skill was synchronized
  from v8 to v9 so the runtime instructions include exact IAB bootstrap reuse.
- Verification: Core's 18 kernel history/merge tests and Server's 4 kernel-update route tests pass;
  the rebuilt Skill library reports v9 with the bootstrap contract.

## Local CI and main commit

- [x] Confirm the target branch and inspect the repository CI workflow.
- [x] Run the local CI-equivalent install, security, build, format, typecheck, and test gates.
- [x] Review the final diff and exclude local-only artifacts or sensitive data.
- [x] Commit the verified browser backend and IAB fixes on `main` (`4a25889`).

### Review

- Node 24.17.0 and pnpm 11.18.0 matched the GitHub toolchain for the final build, format,
  typecheck, blocking unit suites, Browser CLI Chromium suite, and Electron IAB end-to-end.
- The blocking suites passed 3,485 tests across Core, Server, Web, Desktop, Skills, Transaction,
  and the extension. Browser CLI passed 572 tests with 6 skipped; Electron IAB passed every
  assertion. The live-model job followed CI behavior and skipped because no DeepSeek key was set.
- A first Node 26 run exposed two host-shell-only Core failures: Bash loaded the user's NVM plus an
  incompatible `.npmrc` prefix, printing a warning into command output and adding latency. Both
  passed under the isolated Node 24 CI environment without any product-code change.
- The local design comparison image under `artifacts/` and the workflow notes under `tasks/` are
  intentionally not part of the product commit. No email address, user path, or credential was
  found in the staged product diff.

## Codex-style website tabs

- [x] Resolve the supplied Codex screenshot as the visual target and inspect the current tab model.
- [x] Carry real page favicons from Electron into the renderer with a safe fallback.
- [x] Replace the heavy underline/glyph tab with the compact rounded Codex-style tab treatment.
- [x] Preserve retain, close, loading, keyboard navigation, overflow, and new-tab behavior.
- [x] Add focused main-process and renderer regression tests.
- [x] Capture the rendered strip, compare it with the reference, and run relevant verification.

### Review

- Electron now publishes the current page favicon, clears it at the start of a new main-frame
  navigation, and rejects executable, malformed, or oversized icon URLs before they cross the
  renderer bridge.
- The active tab is a compact neutral pill with the real site icon, left-aligned truncated title,
  subtle close action, hover-only retain action, and no heavy blue underline. The new-tab control
  follows the last tab instead of being pushed to the pane edge; overflow remains horizontally
  scrollable.
- A 300 × 54 CSS px / 2x-density Electron render was compared to a density-matched crop of the
  supplied Codex reference. The final pill width, 28px height, title scale, close placement, and
  adjacent plus rhythm align without actionable P0/P1/P2 differences.
