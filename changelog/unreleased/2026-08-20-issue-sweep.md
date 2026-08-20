# Issue sweep: four of six closed or mitigated, each verified by measurement

Every open issue was reproduced before being touched, and the fixes are verified the same way.
Issues 0003, 0004 and 0006 are closed; 0005 is mitigated; 0001 and 0002 stay open with today's
evidence recorded.

## 0003 — flaky browser tests (closed, with a postmortem)

Reproduced: `screen-recording` failed 2 of 3 runs, `relay-navigation` 1 of 5. Both were the same
mistake twice — **a timer standing in for a state**:

- `screen-recording` expressed "a terminal operation is in flight" as an 80ms server delay, then
  spent a poll plus a round trip before asserting. The option is replaced by `stopGate?:
  Promise<void>`, the gate pattern already used elsewhere in the same file, so "in flight" holds by
  construction. `stopDelayMs` no longer exists.
- `relay-navigation` accepted an intermediate frame URL while the page under test scripted a second
  navigation 150ms later, so the button count could run against a document being replaced. It now
  waits for the terminal URL; coverage is unchanged because that document is only reachable through
  the whole empty-src → cross-origin sequence.

After: 4 of 4 and 6 of 6 runs green. Story in `docs/postmortem/0001-flaky-browser-tests.md`; the
lesson ("a timer is not a way to express a state") is in `tasks/lessons.md`.

## 0004 — browser-cli scripts unchecked (closed)

`scripts/` is back in `tsconfig.test.json`. Three scripts imported `playwright-core`, a package
this workspace does not have (it is `@xmorse/playwright-core`), and the soak-test script was
written for Bun. It is ported to Node (`execFile` with an argument vector — never a shell string,
since `-e` carries arbitrary Playwright source) rather than deleted: issue 0003 is exactly the kind
of question a long-running stability run answers. `tsc` over `src`, `test` and `scripts` is clean.

## 0006 — core exec-session env pollution (closed)

The emitter is pinned: **nvm**, not npm. The session runs a login shell, the profile loads nvm, and
nvm warns when `~/.npmrc` sets `prefix`/`globalconfig` — printing before the command's own output.
The test asserted on the *first* chunk; it now drains until its marker appears, which leaves the
generator suspended at a yield exactly as the wake-race assertion needs. 25 tests pass.

## 0005 — injected-deps deadlock (mitigated, still open)

`build-extension-bundle.ts` now preflights: it scans `browser-extension/src` for
`penguin-browser/src/…` specifiers and checks them against the injected copy before the bundler
runs, aborting with the missing paths, the cause, and the escape command. A positive filesystem
check, not error-text matching. Verified both ways — renaming a file inside the injected copy
triggers it; an up-to-date copy builds silently. The structural deadlock is unchanged.

## Found while verifying: one more timer measuring the host

The full `core` run surfaced a third instance of the same family, unrelated to any of the six
issues: `returns promptly when a command backgrounds a long-lived child` asserted `elapsed < 2000`
and failed at 2023ms while the machine was loaded (it passes 3 of 3 in isolation). The budget is
now derived from the failure mode it exists to catch — waiting for pipe EOF would take the
background child's full 5s — instead of from a hope about machine speed.

## Follow-up verification: source-mode relay startup

Running `pnpm --dir packages/browser-cli cli browser list` from a stopped relay exposed a path
regression left by the source regrouping: `relay-client.ts` looked for the entry beside itself in
`src/relay/`, while the entry lives at `src/start-relay-server.ts`. Relay startup now resolves both
the source and compiled entry from the package root and fails immediately if the resolved entry is
missing; a regression test pins both layouts. Stale source citations to the removed 0003 and 0004
issue files now point to the postmortem or stand on their own, and the live LLM tests use Vitest's
supported options-before-handler argument order.

The same full run reproduced the third historical `relay-navigation` failure that the postmortem
had explicitly left unclaimed. Its parent page waited only for `domcontentloaded`, which says
nothing about whether the cross-extension iframe target exists yet. The test now waits for that
iframe's `load` event before asking Chrome to exercise the three failed attach attempts; six
targeted runs and the following full browser-cli run pass (578 passed, 6 skipped).

## 0001, 0002 — open, re-verified

- **0001**: every mechanism it names is still in the code; its stale `browser-cli` paths are
  corrected (`src/executor/…`). What is missing is on-screen evidence only a run on the reporter's
  Chrome can produce.
- **0002**: all five redaction exports still have zero call sites. Recorded that wiring it is not a
  bug fix but the cross-process feature that must land with secret entry — the relay has no way to
  learn which values are sensitive yet.
