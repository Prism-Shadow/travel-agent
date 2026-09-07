# Development TODO

Status: active working plan. Base commit: `9f9e3e4`; T04 and the selected D01 scope are implemented in the working tree.
The order below is proposed; decision items remain decisions until settled with the owner.
This file owns the execution queue. Contracts remain in the [root spec graph](../SPEC.md), and the
[Trips presentation plan](trips-overview-and-sidebar-covers.md) owns the detailed steps for T04/T05.

## Current code and verification baseline

| Area | Implementation and evidence | What remains open |
| --- | --- | --- |
| Agent engine | `packages/core`: pinned PenguinHarness runtime, tools, state and traces. [Live tests](../packages/core/test/llm.e2e.test.ts) cover streaming and an optional Gemini tool-call regression. | No basis found for a complete travel-task acceptance result from these tests. Engine changes require a deliberate decision. |
| Trips and cards | [Server spec](../packages/server/SPEC.md), [TripService](../packages/server/src/services/trip-service.ts) and [interaction routes](../packages/server/src/http/routes/interaction.ts): Trip directories, mutable conversation membership, identity, itinerary access and six interaction kinds. | Card route tests use a controlled runtime; they do not prove a real model completes a booking task. |
| Browser execution | [Desktop spec](../packages/desktop/SPEC.md), [browser-cli spec](../packages/browser-cli/SPEC.md): IAB and explicit Chrome selection, relay/executor, handover and payment guardrails. The [CLI](../packages/browser-cli/src/cli.ts) exposes interaction requests. | Qualify the complete task and its actual stopping point. The payment wrapper is not an OS security boundary. |
| Consumer UI | [Web spec](../packages/web/SPEC.md): Trip overview and first-visit background, Trip details, loose chats, identity chips, budget currency, Models, Saved, the three-trip rail, 192 covers and unified brand. | Sidebar trip thumbnails remain T05. Date grouping has shared production callers and tests. |
| Private Profile | [Page](../packages/web/src/features/private-profile/private-profile-page.tsx), [vault store](../packages/desktop/src/vault/store.ts) and [field tiers](../packages/desktop/src/vault/tiers.ts) exist. | Write controls are disabled; desktop IPC/preload CRUD is absent. [Defaults](../packages/core/src/state/feature-flags.ts) keep vault/audit off; D3-dependent capabilities stay closed. |
| Verification and delivery | [Local gate](../AGENTS.md#the-gate-before-a-push), [CI](../.github/workflows/ci.yml), [pre-release](../.github/workflows/pre-release.yml) and [packaging](../.github/workflows/desktop-build.yml). | CI is manually disabled. Load-sensitive tests remain open in GitHub #8. Release-platform evidence is separate work. |

The verification record is [commit 9f9e3e4](https://github.com/Prism-Shadow/travel-agent/commit/9f9e3e4):
build, format, typecheck and the debug-switch guard passed; package tests reported 3,879 passed and
6 skipped; Web E2E reported 40 passed; Desktop E2E passed; DeepSeek live E2E passed and Gemini was
skipped. This macOS run does not establish Linux/Windows readiness or close an intermittent failure
report. Logs under `artifacts/sync-20260905/` are local evidence, not tracked documentation.

## Proposed order

| ID | Work | State | Dependency |
| --- | --- | --- | --- |
| T01 | Establish complete travel-task acceptance | Recommended next: investigation | Select a bounded pilot scenario |
| T02 | Reproduce and fix load-sensitive tests | Open issue; latest gate passed | GitHub #8 baseline |
| T03 | Make L1 Private Profile editable | Confirmed implementation gap | Desktop IPC plan; independent of D3 |
| T04 | Build the Trips overview | Implemented and verified in working tree | Selected second design + first-visit background |
| T05 | Add sidebar trip covers | Planned; overview entry is implemented | Settle simultaneous cover allocation |
| T06 | Align verification guidance with code | Confirmed documentation drift | Existing test and flag evidence |
| T07 | Verify release platforms and restore CI before shipping | Release work | Select platforms and capability tier |
| T08 | Remove the Trip directory collision ceiling | Complete; collision and concurrency regressions pass | [Issue 0011](../docs/issues/0011-trip-directory-collision-ceiling.md) |
| D01 | Implement the approved single New trip entry and explicit promotion | Implemented and verified in working tree | [Implementation plan](unified-trip-entry.md); model-proposed creation remains deferred |
| D02 | Select and prototype runtime isolation | Architecture decision | GitHub #3; required for L2/live secret fill |

## T01 — Establish complete travel-task acceptance

- [ ] Record one bounded scenario, run it through the production path, and turn its observable
      boundaries into a repeatable acceptance test.

**Evidence:** the product is judged on one sentence, options with reasons, a choice authorizing the
next action, a filled form and a stop at payment. Existing suites test parts of that chain. The
[server card tests](../packages/server/test/interaction-routes.test.ts) use a controlled runtime;
the [CLI interaction tests](../packages/browser-cli/test/user-interaction.test.ts) fake the server.

**First step:** agree on one scenario, such as a hotel search with dates, party size and a stated
currency. Map the real message, skill, CLI, relay, card, answer and form paths, then write the
cross-package test plan before implementation. Start with a controlled merchant fixture and
synthetic data; identify real-site qualification as a separate run.

**Done when:** a real agent run reaches the fixture through the selected browser; presents choices
with source-backed reasons; waits for the person's choice before acting on it; fills authorized
ordinary fields; records a useful Trip artifact; and leaves payment unexecuted. Capture the trace
and terminal page state. Include refusal/cancellation and unavailable-backend cases. Assess
recommendation quality from evidence rather than encoding a preferred offer in a rule table.

**Limits to verify:** the [payment gate](../packages/browser-cli/src/executor/payment-gate.ts)
also refuses labels such as `Proceed to payment` and `Submit order`, and permits an unrecognized
label. A run that stops before the payment page is partial, not completed acceptance. Do not weaken
a gate to make the scenario pass. Keep L2/L3 data and live fills closed; where a site requires them,
record the supported human handover and its effect on completion. Create follow-up defects only for
failures actually observed.

## T02 — Stabilize the reported load-sensitive tests

- [x] Reproduce [GitHub #8](https://github.com/Prism-Shadow/travel-agent/issues/8), identify each
      failing wait condition, and verify repairs under the same conditions. Closed 2026-09-06 at
      d1f3147; the per-case record is on the issue and in the plan below.

**Evidence:** the issue reports failures in browser-cli's `relay-core`, `extension-connection` and
`popup-relocation` suites, plus Web's `compact-abort`, under load while isolated runs pass. The latest
gate passed; no basis found to declare the intermittent problem fixed from that run.
One more data point, 2026-09-05, from the first `pre-release.yml` runs on Windows: desktop's
`browser-import-stores` > "does not let an old import move a page's last-visited time backwards" — a
synchronous SQLite case that takes 1 ms locally — hit the 5 s timeout once and passed on rerun of
the same commit. Nothing in the test waits; the worker itself stalled.
And 2026-09-06 on ubuntu-latest (run 34007871171): browser-cli's `snapshot-tools` > "should show
aria ref labels on real pages" spent 61.9 s inside `ensureA11yClient` — two `page.evaluate` calls —
on news.ycombinator.com while `aria-snapshot.test.ts` was launching its own Chromium in parallel;
the same tree had passed hours earlier. The case also depends on two live external sites, which is
a second reason it does not belong in a gate as written.

**First step:** record commands, host/load conditions, assertions and repeat count. Follow the
[testing lessons](lessons.md#testing-and-verification); do not assume all failures share a cause
because they are timing-sensitive.

**Done when:** reproduced failures have explained causes and meaningful regression checks; affected
tests pass repeated runs under the reproducing conditions; the full gate passes; and issue evidence
distinguishes repaired cases from cases still unconfirmed. Raising timeouts or hiding a suite does
not establish this result.

**Plan (2026-09-06).** Each named case read; each is a timer standing in for a state, the pattern
of postmortem 0001. Two structural pressures sit underneath: browser-cli runs its twelve
browser-launching files in parallel, one Chromium each, and the root `pnpm test` runs browser-cli
concurrently with every other package.

- [x] Baseline, 2026-09-06 on a 14-core macOS host with 8, then 12, `yes` burners: five full
      browser-cli runs, all green (≈60–80 s each). The named cases did not reproduce here; the
      environments that do are the issue's 8-core Linux box and the 4-vCPU ubuntu runner (1 red
      run in 6 since Actions were re-enabled). Fixes are therefore argued by construction — a
      state wait in place of a timer — and measured on CI over subsequent runs.
- [x] `extension-connection` "keeps an active browser connected": waits (≤30 s) until relay status
      shows a second distinct extension key before the four stability samples.
- [x] `popup-relocation`, both cases: poll (≤8 s, under the executor's 10 s code limit) for a page
      at /target that was not in `context.pages()` before the click, and make each cleanup wait
      until the fixture pages have left the context. Two findings on the way: which Playwright
      event announces the relocated page (`page.on('popup')` vs `context.on('page')`) depends on the
      relocation path, so neither is the state; and a close in extension mode lands after the call
      returns, so the second case was sometimes reading the first case's leftover /target page.
- [x] `relay-core` download test: 30 s bound on the download event; the CDP log is polled (≤15 s)
      until all six expected entries are present instead of sleeping one flush interval.
- [x] Web `compact-abort` "compacting twice": gone with the manual `/compact` command
      (`docs/decisions/implemented/2026-09-06-automatic-compaction-only.md`); the cause was a banner
      that appears when compaction *starts* being read as "finished", so the second `/compact`
      met `assertIdle`'s `compacting` 409 under load. No product path reaches it now.
- [x] browser-cli parallelism: `maxWorkers: CI ? 2 : 4`. Local full suite ≈90–115 s under load
      (was ≈60–80 s with no cap and no burners); CI timing to be read from the next runs.
- [x] Root gate: `pnpm test` runs browser-cli after the other packages; AGENTS.md says so. The CI
      step is renamed "Browser integration tests" — it was never a unit suite.
- [x] `snapshot-tools` "aria ref labels on real pages": `it.skipIf(process.env.CI)`.
- [x] After: five full browser-cli runs under 12 burners. One red in the first three — not a named
      case but `relay-navigation` "temporarily removes and restores restricted extension iframes",
      the third failure of postmortem 0001, now through a *different* 5 s bound: `connectOverCDP`
      wrapped in a `withTimeout(5000)` whose message reads "extension likely crashed". Attaching a
      page with five restricted iframes takes the relay longer than that under load. That bound
      and the toggle's are 30 s now; the file still holds ten other `withTimeout(5000)` calls of
      the same shape that have not been seen failing and are left as they are. Two further full
      runs green. Remaining open: the Windows SQLite stall (nothing in that test waits).

## T03 — Connect L1 Private Profile writes

- [ ] Complete the desktop-owned L1 read/write path from
      [GitHub #2](https://github.com/Prism-Shadow/travel-agent/issues/2).

**First step:** write the main/preload/UI plan and map page labels to canonical fields in
[tiers.ts](../packages/desktop/src/vault/tiers.ts). Names need explicit family/given-name mapping;
`contact_email` has a masked projection by default. A display label is not a storage field name.

**Scope:** add authorized-renderer IPC for status/list/put/delete, typed preload methods, inputs and
errors; enable the vault only with required runtime probes. Keep raw profile values out of server
APIs. Distinguish desktop-required, storage-unavailable and isolation-required states. Review audit
behavior explicitly. Changes to pinned feature defaults need their decision and tests together.

**Done when:** L1 values can be saved, edited, read after restart and deleted in Electron; the grant
path respects masking; unsupported callers and unavailable storage are refused; the standalone web
state is honest; L2 stays closed and L3 is never persisted. Exercise the UI and real preload/main
boundary. D3 is not a prerequisite for L1 editing.

## T04 — Build the Trips overview

- [x] Implement the selected second design and first-visit background in the working tree.
- [x] Verify behavior and review desktop/mobile, both locales and dark-theme previews.

Changes remain local. Production web build, workspace typecheck and 3,890 package tests passed;
all 47 Web browser checks passed in the repository harness with fresh isolated data. Local visual
comparisons and detailed results are under `artifacts/design-qa/`.

The page groups dated, unscheduled and past trips, handles in-progress/partial dates, preserves
new-trip draft semantics, and exposes a retryable error separately from loading and no records.
The sidebar heading opens `/trips`. Contracts live in [the web spec](../packages/web/SPEC.md).
The remaining presentation work is T05; no booking ledger or server package change is included.

## T05 — Add sidebar thumbnails

- [ ] Implement phase 2 of the [Trips presentation plan](trips-overview-and-sidebar-covers.md).

**Done when:** group headers have decorative lazy-loaded covers,
and expanded/active state, keyboard navigation, long names, many trips and narrow layouts retain
their behavior. Keep the single New trip entry, My Trips, Saved and Models navigation. Verify allocation wherever sidebar covers and another cover surface coexist.

## T06 — Remove stale verification guidance

- [ ] Align living instructions with observed code and coverage.

**Confirmed drift:** [.pi/agents/review-ci.md](../.pi/agents/review-ci.md) still says to skip Web E2E
because of closed local issue 0010. The root guide and reviewer describe live E2E as one test, while
[the file](../packages/core/test/llm.e2e.test.ts) also has an optional Gemini case. The
[D3 note](../docs/decisions/proposed/2026-08-16-agent-runtime-isolation.md) says L1 vault/audit are on,
while [defaults](../packages/core/src/state/feature-flags.ts) keep both off.

**Done when:** remove the expired Web E2E exception and hard-coded report row; describe live-test
scope/skips accurately; and distinguish capabilities permitted before isolation from capabilities
enabled in this build. Preserve the isolation decision and dated research/postmortem records.
No runtime flag changes belong in this documentation task.

## T07 — Establish release evidence

- [ ] Select platforms and capability tier, run release checks, and restore CI before shipping.

**First step:** distinguish source-run development from installer results. Use
[pre-release.yml](../.github/workflows/pre-release.yml) and
[desktop-build.yml](../.github/workflows/desktop-build.yml) to identify missing checks; record
signing/packaging requirements for selected platforms.

**Done when:** selected installers pass startup, model setup, browser startup and the agreed pilot;
platform limitations and gated capabilities are visible; Linux/Windows evidence exists where those
platforms ship; and CI is enabled with intended required checks. A release without L2/live fill does
not depend on D02, but must state that scope.

## T08 — Remove the Trip directory collision ceiling

- [x] Resolve [issue 0011](../docs/issues/0011-trip-directory-collision-ceiling.md) with atomic
      random suffix allocation, collision and concurrency tests, preserving existing directories.

## Decisions kept separate from implementation

- [x] **D01 — Unified entry and explicit promotion.** The owner selected one global New trip
      entry, independent conversations, explicit Add to trip and separate topics inside a Trip.
      Implementation and verification are tracked in [the plan](unified-trip-entry.md).
      Model-proposed creation and automatic artifact migration from GitHub #10 remain deferred.
- [ ] **D02 — Runtime isolation.**
      [GitHub #3](https://github.com/Prism-Shadow/travel-agent/issues/3) and the
      [D3 note](../docs/decisions/proposed/2026-08-16-agent-runtime-isolation.md) own the options and
      A1–A7 attacks. Choose a candidate/platform prototype, measure attacks and packaging/workspace
      costs before selecting the boundary. L2/live fill needs evidence on every shipped platform;
      a Linux prototype does not establish macOS support.

## Outside the active queue

Explore/community feeds and collaboration are declined by [root scope](../SPEC.md#scope), not a
missing requirement alongside bugs. The previous Explore request remains a scope question only if
the owner deliberately revisits that spec. Booking/receipt ledgers, price watching, auto-rebooking
and ticket-sniping remain out for the same table's reasons. Brand replacement and the consumer
fixes belong to the implemented baseline. Calendar presentation stays deferred in the Trips plan.

## Working through the queue

Work on one selected item at a time. Start with evidence and acceptance criteria; write a plan before
crossing packages or touching a gate. Keep artifacts in gitignored `artifacts/` and use development
or test data roots. Record a new defect's reproduction and scope before expanding a task. A code
search hit alone is not a confirmed defect.

For implementation, run the owning package's tests and typecheck, build when paths/bundling change,
and use browser tests for changed user behavior. Before any push, run the complete
[repository gate](../AGENTS.md#the-gate-before-a-push). Update owning specs/decisions with the change,
record verification in its commit, and remove completed work from this queue; git history keeps
the completion record. Do not close GitHub issues merely because a TODO was written.
