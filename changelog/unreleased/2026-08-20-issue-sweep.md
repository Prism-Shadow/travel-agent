# Issue sweep: six of six closed or mitigated, each verified by measurement

Every fix below is tied to reproduced behavior and verified against the same observable; where an
original report did not recur, the record says so. Issues 0001, 0002, 0003, 0004 and 0006 are
closed; 0005 is mitigated.

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

## 0001 — extension blank bootstrap (closed)

The report's persistent blocked/blank Ctrip result did not recur on the reporter's connected
Chrome. The complete Beijing hotel flow reached the normal list (6,121 results) and hotel detail,
and an isolated `window.open()` test proved popup relocation reached its requested page exactly
once. No `about:blank#blocked`, `chrome-error://` page, captcha, or relevant relay error appeared,
so there is no basis for attributing the report to popup relocation or Ctrip anti-automation.

One narrower failure was repeatable and in the reported path. A second `tabs.open(targetUrl)`
surfaced a Page at `about:blank` after 387 ms, then navigated to the requested URL at 1,319 ms: the
extension did exactly what the implementation asked, because the executor called
`context.newPage()` before `page.goto()`. If debugger attachment failed between those operations,
the extension also left the browser-created tab behind.

Extension-backed `tabs.open(url)` now sends that URL in `Target.createTarget`; only a reused
session bootstrap still navigates in place. The executor resolves the Page by target id, waits for
its destination to start, and closes a target Playwright never surfaces. The extension closes both
ordinary and initial tabs when debugger attachment fails. Direct-CDP, headless and IAB creation are
unchanged. After restarting the relay, the same new-tab Ctrip probe no longer emitted
`about:blank`: its Page appeared while the destination was loading and reached the normal Ctrip
homepage. Unit coverage pins direct-at-destination creation, bootstrap reuse, and created-versus-
reused cleanup semantics.

## 0002 — browser output redaction (closed)

Reproduced with one registered passport value on an attached page: absent redaction state, ARIA,
page Markdown and clean HTML each returned the plaintext, and the screenshot retained the source
pixels. Desktop main now publishes one target's fingerprint entries, salt and live element set on
an authenticated, conversation-scoped `iab-redaction-state` request. The executor pulls that state
at each render rather than relying on a notification that a reconnect could miss; malformed or
partial responses refuse the output.

ARIA, page Markdown and clean HTML replace exact matches before snapshots enter diff caches. The
screenshot path refreshes each selector's viewport box in main, refuses before capture if any live
field cannot be located, and otherwise paints every box opaque before resizing, writing or base64
encoding. Regression coverage uses the same page as an unprotected control and then proves the
value is absent from all text structures, the original red screenshot region becomes black, and an
unlocated field produces no image. Cross-conversation target requests are refused by the relay.

`vault.l2l3` and `secret_entry.live` remain fail-closed behind D3. This closes the accidental-output
path; it does not claim that an executor with deliberate raw CDP access is a security boundary.
