# Phase 1 verification record

> Historical checkpoint (2026-08-15). Current product defaults changed on 2026-08-19: IAB remains
> the selected Desktop default and Chrome is now a user-visible alternative. Commands and flag
> statements below preserve the evidence as it was collected.

| | |
| --- | --- |
| Phase | 1 — Vertical slice：左聊右览（design/004 §2 Phase 1） |
| Baseline | `24a21b0` (Phase 0 checkpoint) |
| Date | 2026-08-15 |
| Host | Linux 6.1.0-40-amd64 · Node v24.18.0 · pnpm 11.18.0 · Electron 43.2.0 · headless (Xvfb), datacenter IP |
| Result | **Automated and live exit criteria pass. The manual GUI items could not run on this host and are PENDING**, so the phase is `code_complete_manual_pending` rather than `completed` — see §6. |
| Revision | Five passes after full-diff review, 25 blocking findings in total. What each was and how it is covered is in §9. |

---

## 1. What was built

The agent drives a real `WebContentsView` inside the application window. Not a screenshot, not an
iframe, not a second Chrome: Chromium renders the page a few hundred pixels from the conversation,
the user can click it, and the agent drives the same pixels over CDP.

```
Agent  ──exec_command──▶  penguin-browser --iab
                              │  POST /cli/session/new {iab:true}
                              ▼
                         relay :19989 ── mode 'iab' ──▶ PlaywrightExecutor
                              │                              │
                              │  ws /iab (loopback,          │ Playwright over CDP
                              │  per-run key, no Origin)     │
                              ▼                              ▼
                    Electron main · IabTransport ──▶ webContents.debugger
                              │                              │
                              │ iab-open-tab                 ▼
                              ▼                    WebContentsView (persist:travel-iab)
                         BrowserPane  ◀── bounds ── preload ── renderer placeholder div
```

Two decisions carry the design:

**The shell speaks the protocol the relay already knows.** A Chrome extension bridges
`chrome.debugger`; this bridges `webContents.debugger`. Both present the relay with the same thing —
independent per-target debugger sessions exchanging `forwardCDPCommand` / `forwardCDPEvent` — so the
relay's target synthesis, Playwright bridging, tab ownership and the executor work unchanged. The
`/extension` socket handler is now shared verbatim with `/iab`; only the authentication differs.

**Layout crosses one narrow bridge.** A `WebContentsView` is placed by the main process, so the
renderer measures a placeholder and reports the rectangle. That is the whole reason `main.ts`'s
"no preload, no IPC" rule is broken, and it is broken as narrowly as the capability allows: named
channels only, every argument validated in main, sender checked, and no preload at all on the pane's
own views.

---

## 2. Exit criteria

### 2.1 `session new --iab` → snapshot returns the IAB page's ARIA tree

```
E2E {"step":"session-new","status":200,
     "session":{"id":"1","mode":"iab","extensionId":"install:e2e-install",
                "browser":"Travel Agent (in-app browser)","profile":null}}

E2E {"step":"goto","status":200,"body":"[return value] https://hotels.ctrip.com/"}

E2E {"step":"snapshot","status":200,"body":"[return value]
       - role=link[name=\"Go to main content\"]
       - navigation:
           - role=button[name=\"酒店 按回车键打开菜单\"]
           - role=button[name=\"机票 按回车键打开菜单\"]
           - role=button[name=\"火车票 按回车键打开菜单\"] …"}

E2E {"step":"title","status":200,
     "body":"[return value] 海外酒店预订,国际酒店价格查询,国外宾馆住宿推荐,网上订酒店-[携程酒店]"}
```

**PASS.** A real page, a real accessibility tree with the site's own Chinese labels.

### 2.2 The interaction primitives on the live Ctrip hotel form

All three ran against `https://hotels.ctrip.com/` in the in-app browser.

| Primitive | Result | Evidence |
| --- | --- | --- |
| `fillWithSuggestion` | **PASS** | `{"committed":"keyboard","value":"东京"}` — the autocomplete panel was opened and the suggestion committed, which is the behaviour 001 §7.5 identified as the difference between a search that works and one bounced to a login page |
| `clickThrough` | **PASS** | `clicked` on `page.getByRole('button').first()` |
| `pickDate` | **PASS** | `{"matchedLabel":"2026年8月22日"}`, and the field's value moved from `8月16日(周日)` to `8月22日(周六)` |

`pickDate` needed the site inspected rather than guessed. Two earlier attempts failed on **probe**
errors, not product ones, and the corrections came from reading the live DOM and ARIA tree through
the pane:

- The check-in control's accessible name is **`选择日期`** (from its `placeholder`), not `入住`.
  It is `<input id="checkInInput" readonly placeholder="选择日期">`.
- Calendar cells are `<div role="checkbox" aria-label="2026年8月16日(星期日), Select the start date you want">`,
  which the primitive's existing `[aria-label^="…"]` prefix match handles as-is.

So `pickDate` required **no change**: the primitive was already right, and the first two runs were
calling it with a field name that does not exist on this page. The assertion above is on observed
state (`8月16日(周日)` → `8月22日(周六)`), not only on the return value, because a return value alone
would not prove the calendar actually committed the choice.

A deterministic fixture over the same path also passes (`{"matchedLabel":"2026年8月22日"}` against
markup built in a `data:` URL), so the primitive's route through `/iab` is covered independently of
the site's current markup.

### 2.3 `tabs.open()` goes through the main process

```
E2E {"step":"tabs.open","status":200,"body":"[return value] https://example.com/"}
```

**PASS**, and by the required route. Phase 0 established that `Target.createTarget` answers "Not
supported" on Electron, so `openOwnedTab` takes an `iab` branch that issues `iab-open-tab` over the
existing tunnel; the shell builds the view and returns its CDP target id, which the executor then
resolves to a Playwright page. `context.newPage()` is never called in this mode.

Two corrections found while getting here, both recorded because they are the kind of thing that
looks like a transport failure and is not:

- **The relay learns which targets exist only from `Target.attachedToTarget`.** The transport
  attached its debugger before the socket was open, so the announcement was sent to a closed socket
  and dropped; the later re-attach was a no-op because the view was already registered. The relay
  was connected with `activeTargets: 0` and every command failed as though the backend were gone.
  Fixed by announcing every attached target on socket open.
- **`cdpConfig` overrides replaced the manager's host/port/token wholesale.** An `iab` session still
  reaches the browser through *this* relay, so it must keep them; a `direct` or `headless` session
  legitimately replaces them because it connects elsewhere. Now merged for `iab` only.

---

## 2.4 The cold start, end to end, as a committed test

`pnpm --filter @prismshadow/penguin-desktop test:e2e` runs a real Electron main process against a
real relay and a local fixture page, and asserts on what it observes. It is not the live-site
evidence above — that stays in §2.1–2.3 — it is the guard that stops this path rotting.

Two conditions in it are deliberate:

- **It starts with the pane closed and zero targets**, which is the shape a cold start actually has.
  That configuration once deadlocked: the executor asked the shell for a tab by sending
  `iab-open-tab` through an existing page's CDP session, and on a fresh app there was no page to
  send it through, so the agent could never be the one to create the first view. Pre-opening the
  pane in the harness would have hidden it. It is fixed by bootstrapping a view in the relay's
  `session new --iab` branch, at the one place that already holds the backend connection.
- **The port is dynamic.** A fixed port collides with a developer's own relay and with a parallel run.

```
  ✓ the preload exposes the bridge when main passes the switch
  ✓ the pane starts closed with no view, which is the shape a cold start actually has
  ✓ the shell registers as a backend on /iab
  ✓ and does so with no targets, so the bootstrap below is genuinely from zero
  ✓ session new --iab succeeds from a cold start
  ✓ tabs.open navigates the view
  ✓ opening a tab opens the pane, so the user sees what the agent is doing
  ✓ snapshot returns the page's ARIA tree
  ✓ clickThrough actuates the real page
  ✓ the view steps aside while the splitter is dragged, so the native surface cannot swallow the pointer
  ✓ and comes back at the new width once the drag ends
  ✓ a window created without the switch gets no bridge, so the renderer offers nothing it cannot use
  ✓ the harness completed
```

The process's own exit status is checked before any of those lines is parsed, so a run that prints
every step and then dies is a failure rather than a pass (§9 #24).

It runs in CI. `.github/workflows/ci.yml`'s Ubuntu job installs Xvfb and calls
`pnpm --filter @prismshadow/penguin-desktop test:e2e` after the unit tests; Windows does not, since
that runner has no display server and nothing under test here is platform-specific. The runner
**refuses to skip when `CI` is set** — a gate that goes green because it decided it could not run is
worse than no gate — while still skipping on a developer machine with no display, where a missing
environment is not a broken product.

---

## 3. Automated tests

| Suite | Result |
| --- | --- |
| `packages/desktop` | **190 passed** (was 92): pane layout, pane behaviour, transport, IPC validation, relay plan, session policy, the availability switch, the end-to-end runner's exit-status reading (12), and the existing 56 |
| `packages/browser-cli` | **402 passed**, 1 skipped, **6 failed and 0 unhandled errors** — the six are the pre-existing Chromium-revision baseline described in §5, name for name; the additions are the `/iab` auth, relay discovery and loopback tests |
| `packages/core` | 852 passed, 5 skipped (unchanged) |
| `packages/server` | 594 passed |
| `packages/web` | **669 passed** (was 650): the splitter's arithmetic |
| `packages/cli` | 235 passed |
| transaction / travel-domain / skills / browser-extension | 51 / 44 / 21 / 9 passed |

`pnpm typecheck` passes for all 10 packages. `pnpm build` succeeds.

What the new tests cover, and why those cases:

- **`browser-pane-layout.test.ts`** — the arithmetic, including the measurements that are *wrong*:
  negative origins, rectangles running off an edge, a window resized until the pane is a sliver.
  Electron will happily place a view off-screen, so clipping is the only thing between a stale
  measurement and a view painted where it does not belong.
- **`iab-transport.test.ts`** — the message loop against a fake socket and a fake debugger: command
  forwarding, event forwarding, a debugger rejection returned as an error rather than a dropped
  request, a non-JSON frame, an unroutable command, and the reconnect ladder including its reset.
- **`ipc-validation.test.ts`** — every malformed payload is *rejected*, not coerced. A renderer bug
  that quietly becomes a view in the wrong place is exactly what this prevents.
- **`iab-endpoint.test.ts`** (relay) — the refusals: no key, wrong key, a key that is a prefix of the
  real one, any request carrying an `Origin` header (including a `chrome-extension://` one), and a
  relay started without a key refusing everything.

- **`loopback.test.ts`** (relay) — the `isLoopbackAddress` predicate that endpoint calls, enumerated:
  IPv4, IPv6, the bracketed form, IPv4-mapped IPv6, the whole 127/8 block, and the refusals —
  non-loopback addresses, a hostname that merely starts with `127.0.0.1`, an out-of-range octet, and
  a missing address. The endpoint test itself cannot exercise this (the relay binds 127.0.0.1, so
  there is no non-loopback address to connect from), which is why the predicate was extracted.

---

## 4. Security posture

| Property | How |
| --- | --- |
| No debugging port | The rejected Phase 0 alternative. The shell bridges `webContents.debugger` instead; nothing in this change opens a port, and the CI guard for it remains Phase 5's. |
| `/iab` is not reachable from a page | Any request carrying an `Origin` header is refused outright. A Node client never sends one; a page always does. Stronger than an allowlist. |
| `/iab` is not reachable by port knowledge | A 32-byte per-run key, generated at launch, passed to the relay through its environment (never argv, which is world-readable via `ps`), compared in constant time. |
| The endpoint is closed when there is nothing to drive | A relay started without a key refuses every `/iab` connection, so a standalone `penguin-browser serve` does not expose it at all. |
| Pane pages cannot reach the app | Separate `persist:travel-iab` session, `sandbox`, `contextIsolation`, no `nodeIntegration`, **no preload**, permissions denied by default, `http`/`https` navigation only. |
| The bridge is not a general IPC channel | Four named channels, arguments validated in main, sender checked against the app window. |
| The capability is off by default | `iab.enabled` defaults false. With it off, no view, no IPC handlers and no transport are constructed, and the preload reports the bridge as unavailable so the web app hides the column exactly as it does in a browser tab. |

---

## 5. Baseline conditions this change does not fix

Both were recorded in Phase 0 and are unchanged.

**`pnpm format:check` was failing on `packages/desktop/src/main.ts`; it now passes.** The file is
edited by this change anyway (the preload and the pane wiring), and the single offending line —
`]).then(() => undefined).finally(() => app.quit())` in the quit path — sits inside a block this
change already touches to stop the transport. Reformatting it there is one line inside an existing
hunk, not an unrelated whitespace sweep, so Phase 0's reason for leaving it alone no longer applies.
The workspace format check is green as of this commit.

**`packages/browser-cli` needs a Chromium revision nothing installs, and its output is now
ignored.** Running that suite writes into `src/aria-snapshots/`, `src/snapshots/` and `tmp/`. Those
are generated from whatever Chromium is installed — locally a substituted build, not the pinned
revision — so committing them would bake a wrong baseline into the repository. Phase 0 deleted them
by hand and noted that nothing ignored them; a later `git add -A` after a full run duly swept nine
of them into this commit, and they have been removed again. The root `.gitignore` now names the
three directories explicitly, so the same sequence cannot repeat.

The six failures were compared name by name against the Phase 0 list and are identical — same five in `relay-core`, same
one image snapshot in `snapshot-tools`. No new failure, and nothing was skipped to get there. The suite pins chromium 1209;
`@xmorse/playwright-core` is not in `pnpm-workspace.yaml`'s `allowBuilds` so its postinstall never
runs, and `ci.yml` has no browser step. Locally a cached 1228 was symlinked as 1209 — **not
committed**, an environment-only workaround — which leaves 6 failures, the same 6 as Phase 0, all
explained by the substituted build and the headless container (three 500 ms actionability-message
timeouts, one dialog case, one dark-mode expectation, one image snapshot). No product code was
changed to make anything pass, and no snapshot artifacts were committed.

Those six are the *only* result the suite reports: **0 unhandled errors**. It briefly reported
seven, and they came from this phase's own `/iab` tests rather than from the baseline — see §9 #25.

---

## 6. Manual items — PENDING, not run

`docs/manual-testing/phase-01-vertical-slice.md`. This host is headless with no input method and no
display, so the items that need a human at a real window could not be executed. None of them blocks
Phase 2 (design/004 §4.1), but one of them is named in Phase 1's own exit criteria — the Chinese IME
smoke — which is why this phase is `code_complete_manual_pending` and **not** `completed`, and why
`iab.enabled` stays off by default.

---

## 7. Files

**New** — source:
`packages/desktop/src/{browser-pane,browser-pane-layout,iab-switch,iab-transport,ipc,preload-browser,session-partition}.ts`,
`packages/desktop/e2e/{iab-e2e.cjs,run-iab-e2e.mjs,exit-status.mjs}`,
`packages/browser-cli/src/relay-discovery.ts`,
`packages/web/src/lib/desktop-bridge.ts`,
`packages/web/src/features/chat/{browser-pane.tsx,browser-pane-split.ts,use-browser-pane.ts}`.

**New** — tests:
`packages/desktop/test/{browser-pane-layout,browser-pane-behaviour,iab-transport,ipc-validation,relay-plan,session-partition,iab-switch,e2e-exit-status}.test.ts`,
`packages/browser-cli/src/{iab-endpoint,relay-discovery,loopback}.test.ts`,
`packages/web/test/browser-pane-split.test.ts`. Complete as of this commit; `git diff --name-status
origin/main HEAD` is the authority if it drifts.

**Changed** — `.github/workflows/ci.yml` (the Ubuntu job gains the Electron gate), `.gitignore`
(the browser-cli suite's generated output), `packages/skills/skills/penguin-browser/SKILL.md` (v5),
`packages/browser-cli/src/{cdp-relay,executor,cli,start-relay-server,utils}.ts`,
`packages/desktop/src/{main,browser-relay}.ts`, `packages/desktop/tsup.config.ts`,
`packages/web/src/features/chat/chat-page.tsx`, `packages/web/src/lib/strings{,-en}.ts`.

Scratch probes stay in the session scratchpad and are **not committed**: they build modules to a
throwaway directory and, in one earlier revision, opened a dev debugging port. Neither belongs in the
repository.

---

## 9. Review findings and how each is covered

Five rounds of full-diff review produced 25 blocking findings in total, counting the ones that
surfaced while fixing others. Each is listed with what was actually wrong, because several read as
working. Numbering is chronological: 1–10 from the first review, 11–13 while fixing it, 14–18 from
the second, 19–23 from the third, 24 from the fourth, and 25 from the fifth.

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | The flag bridge was **not wired**. `preload-browser.ts` looked for `--travel-agent-iab-enabled`, but `main.ts` never passed it — so the preload would have reported the bridge unavailable regardless of the flag, and the previous record's claim that it was connected was wrong. | `additionalArguments` now carries the switch, and both sides read one exported constant (`iab-switch.ts`) rather than repeating the literal. The committed E2E asserts the bridge is exposed when main passes it. |
| 2 | Permissions were **fail-open**: the handler denied a list, so anything absent — including every permission a future Chromium adds — was granted. Downloads were given a save path in a directory nothing created. | Default-deny against an explicitly empty allowlist, one predicate shared by the request and check paths. Downloads are cancelled outright; Phase 1 has no consumer for a file, and a half-working download is worse than a visible refusal. Tested, including a permission nobody has heard of yet. |
| 3 | The Electron E2E existed only as a scratch harness. | Committed as `packages/desktop/e2e/`, wired to `pnpm --filter @prismshadow/penguin-desktop test:e2e`, on a dynamic port against a local fixture. See §2.4. |
| 4 | The `/iab` loopback check was asserted "by inspection". | Extracted as `isLoopbackAddress` and tested exhaustively — IPv4, IPv6, IPv4-mapped IPv6, the whole 127/8 block, non-loopback, and a missing address. The endpoint's key and origin tests moved off fixed ports. |
| 5 | The pane was a fixed 46% with no splitter, and on a narrow window the toggle was clickable while the pane was hidden by a `lg:` breakpoint. | A real `role="separator"`: pointer drag, arrow/Page/Home/End keys, `aria-valuenow`, clamped against both a fraction range and pixel floors. The toggle and the pane now share one `splittable` condition, so they cannot disagree. Arithmetic tested separately from the DOM. |
| 6 | An agent could open a tab and drive a browser **the user never saw**, because nothing opened the pane. | `openTabForAgent` opens it. Main owns `requested` and the renderer follows it, so there is one source and no loop. Asserted in unit tests and in the E2E. |
| 7 | `openTabForAgent` silently ignored a non-http URL; `lastLayout` survived a rebuilt view, so an identical rectangle was skipped as "unchanged" and the new view was never positioned. | A supplied URL that cannot be navigated now throws; only `undefined` means blank. `lastLayout` resets on create and destroy. Both tested, the second by destroying a view and rebuilding it at the same bounds. |
| 8 | On a failed announcement the transport dropped the view from its table but left the debugger listeners attached, so the next attach added a second set and every event was forwarded twice. | Attach registers listeners once and stores their teardown; `release` is the only removal path; announcements are idempotent and reset on reconnect; `stop()` detaches everything. |
| 9 | The trigger chain was only documented for the CLI. | `SKILL.md` v5 tells the agent to prefer `--iab` and fall back, and states the profile difference. Boundary written up in §10. |
| 10 | `iab.enabled` stays off until manual acceptance. | Unchanged, and now genuinely enforced end to end — see #1. |
| 11 | **Cold-start deadlock.** With zero targets there was no page for the executor to send `iab-open-tab` through, so the agent could never create the first view. | The relay bootstraps a view in its `session new --iab` branch, before the executor connects. Covered by the E2E, which starts from a closed pane and zero targets. |
| 12 | **Relay ownership.** The shell reused whatever held 19989, but the `/iab` key is minted per launch, so a borrowed relay would 401 forever — silently, for anyone who had run `penguin-browser serve` first. | The shell takes 19989 when free. When another *relay* holds it: reused with the pane off (preserving extension mode for the default user), and this app starts its own dynamic relay with the pane on. Something that is not a relay fails with an actionable message. Never killed. Discovery lives in `~/.penguin-browser`, holds only port/pid/instance, is written atomically at 0600, and is removed only by the instance that wrote it. |
| 13 | Importing the discovery helper from the package root would have pulled `cdp-relay` into Electron main, mutating `Buffer.prototype`'s inspect hook and loading the whole relay graph. | Deep, side-effect-free subpath. A test asserts the hook is untouched by the import and that the module's own imports are node builtins only. |
| 14 | **The measurement could not be cleared.** `BrowserPane` accepted `null`, but the IPC contract did not, so a closed pane, a window narrowed past the split threshold, or an unmounted component left main holding the last rectangle — and the native view sitting on top of the conversation. A reopen also flashed at the stale bounds. | `setBounds` takes `BridgeRect \| null`; main validates `null` as a real message and `undefined` as still a bug. The hook sends it on `measureRef(null)`, on close, and when the window stops being splittable. Tested for hiding on close, on a narrow window, and for staying hidden after reopening until fresh bounds arrive. |
| 15 | The window `closed` handler tore down the pane and the IPC but **left the transport running**, so on macOS — where the app outlives its window — it reconnected forever on behalf of views that no longer existed. | Stopped and nulled with the window. |
| 16 | Splitter pointer listeners survived unmount, a lost pointer capture, and a second `pointerdown`, each leaking a set that still moved the divider. `localStorage` was guarded on write but not on read, where a restricted-storage browser also throws. | One drag at a time with an explicit cleanup, `lostpointercapture` ends it, unmount ends it, and the read is inside the `try` too. The E2E exercises occlude → move → restore, because a native view above the DOM swallows pointer events that cross it. |
| 17 | The CLI resolved discovery *before* looking at `--host`, and ignored `PENGUIN_BROWSER_HOST` entirely — so pointing at a remote relay still read, and deleted, a local record describing a different machine. | `resolveRelayEndpoint` with a stated order: `--host` › `PENGUIN_BROWSER_HOST` › `PENGUIN_BROWSER_PORT` › healthy discovery › default. A named host never consults or clears local discovery. Ten tests, including that the stale record survives. |
| 18 | A single transient announce failure was permanent on a socket that stayed open: nothing retried but a reconnect, so the backend sat connected with zero targets. | Bounded retry ladder, idempotent — announcements cannot double, listeners register once, and a release cancels a pending retry. |
| 19 | **A ghost capability.** The window advertised the bridge from `iab.enabled` alone, while the pane, the IPC handlers and the transport were installed only once a relay existed. Flag on with the relay unavailable meant a browser button whose every call rejected. | One boolean, `isIabAvailable({flagEnabled, relayPort})`, resolved before the window is created and used for both the preload switch and the wiring. Tested across all four input combinations, including an assertion that the two consumers cannot disagree because they read the same call. The E2E now creates a second window without the switch and asserts the bridge is unavailable. |
| 20 | **`clipToWindow` was not an intersection.** It clamped a negative origin to 0 but kept the original width, so `{-50,-20,400,300}` came back `{0,0,400,300}` instead of `{0,0,350,280}` — and the native view covered 50×20 more of the conversation than it should have. | Rewritten as a true intersection over rounded edges. New cases: shrinking on the left and top, collapsing when entirely off an edge, a rectangle larger than the window, both axes at once, a negative content size, and a property check that the result never extends past the window. |
| 21 | **The end-to-end gate was not wired to CI**, so nothing would have caught a regression in it. | Added to the Ubuntu job after the unit tests, with Xvfb installed there. The runner refuses to skip when `CI` is set, verified by running it with no display and no `xvfb-run`: exit 1 with a message saying the gate must run rather than pass by default. |
| 22 | **This record had drifted from the code**: it still claimed the loopback check was "by inspection", that occlusion was wired but unused, and that the E2E harness "should become" committed. | Corrected in §3, §2.4 and §8. The loopback entry now describes `loopback.test.ts`; occlusion is described as used by the splitter with the portal work named as Phase 2; the E2E section covers CI. |
| 23 | `bridge.getState()` had no `catch`, so a window closing between the call and its answer produced an unhandled rejection during ordinary shutdown. | Caught, with the cancellation guard kept so a late answer cannot write into an unmounted component. |
| 24 | **The end-to-end runner could report a pass on a process that failed.** It checked `result.error` but never `status` or `signal`, so Electron printing every step and *then* dying — a crash on teardown, a rejection after the last assertion, the harness timeout — read as success. In CI that is a gate going green on a failure. | `checkExitStatus` runs before any step is parsed and separates the three cases: never launched, killed by a signal, non-zero exit. Failures carry the status, the signal and the tail of stderr, passed through `redactSecrets` first — the harness mints a per-run `/iab` key and puts it in a WebSocket URL, which a stack trace can otherwise carry into a public CI log. 12 tests, including that a non-zero exit fails even when every step printed and that a key in stderr does not survive into the message. |
| 25 | **The new `/iab` endpoint tests leaked seven unhandled errors.** The helper called `removeAllListeners()` and then `close()` on a socket still in CONNECTING — which is what a rejected handshake leaves it as — and ws reports that as "WebSocket was closed before the connection was established". With every listener just removed, an `error` with nobody listening is an unhandled exception. The timeout was never cleared either, so `done` could run twice. | The helper now keeps an `error` listener for the socket's whole life, guards settling, clears the timeout, and disposes by state: `terminate()` while CONNECTING, `close()` only when OPEN. A test pins it directly — a refused handshake must end in a terminal `readyState` with the swallow listener still attached. No product auth logic changed. |

---

## 10. What actually triggers the in-app browser today

Worth stating plainly, because it is easy to overclaim.

The entry point is **`penguin-browser session new --iab`**, which the agent reaches through
`exec_command` like every other browser call. `SKILL.md` v5 tells it to prefer that form and fall
back to extension mode when the flag returns an error, so a task that needs a browser inside the
desktop app will land in the pane — and the pane opens itself when it does.

What does **not** exist yet is a chat-level backend choice: no UI control, no per-conversation
setting, and no automatic switch based on whether the site needs the user's real Chrome login. The
model picks by following the skill. Design/004 puts that in Phase 2 (matrix M7), and the honest
description of Phase 1 is "the CLI entry point works and is visible", not "the chat flow selects a
backend".

---

## 8. Phase 2 inputs

1. **The pane has no chrome.** Tab strip, address bar and navigation controls are Phase 2, as is
   multi-tab. `contentsForSession` already routes by session id, so adding views is additive.
2. **`tabs.open()` returns the single view.** Phase 1 semantics. Phase 2's `ownedByTask` needs the
   ownership retry loop back, with the shell minting a genuinely new view each call.
3. **Occlusion is used by the splitter, not yet by the DOM overlays.** `setOccluded` hides the view
   for the duration of a drag, because a native surface above the DOM swallows pointer events that
   cross it. Phase 2 has to extend the same call to every portal component (`Modal`, `Dropdown`,
   `Toaster`) — enumerated, not sampled, since a missed one is invisible until a user hits it.
4. **The end-to-end gate covers one view.** It is committed and runs in CI, but Phase 2 adds tabs,
   restore, shortcuts and the control state machine; each needs its own assertions, and the harness's
   single-view assumptions (one `liveTargets` entry, one measurement) will have to generalise.
5. **`did-fail-load` is published but not surfaced.** The renderer shows status only. A page that
   fails to load currently looks idle.
