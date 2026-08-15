# Phase 2 verification — a real browser shell

What was built, what was verified, and what was deliberately not done. Companion to
`docs/manual-testing/phase-02-browser-shell.md`, which is the human half and is entirely `PENDING`.

The feature flag `iab.enabled` remains **off by default**, and `chrome.fallback` is off with it.
Nothing in this phase is reachable in a default build.

---

## 1. What Phase 2 had to answer first: what is a task?

Design/004 Phase 2 requires tabs to be owned by a task (`ownedByTask`) and shown per conversation.
Neither identifier existed.

A repo-wide search established that **no per-run identifier existed anywhere**: core minted a
Session id and nothing below it; the server tracked an in-flight run as a status flag plus an
`AbortController`, keyed by session id; `ServerEvent` carried no run id; and the only "task"
vocabulary was `taskIndex`, an integer *derived after the fact* by re-scanning a Trace file
(`services/trace-service.ts`), which renumbers when the trace rotates and does not exist at runtime.

Per the phase's own rule — never fake it with a constant or the working directory — the contract was
completed instead:

| Layer | What was added |
| --- | --- |
| `core/src/task-id.ts` | `formatTaskId()` / `isTaskId()`. A Task is one turn of a Session. |
| `core` `RunOptions.taskId` | The host's id for this turn; core mints one when a caller omits it. |
| `core` `Session.runTask` | Brackets the turn: `environment.enterTask()` … `finally exitTask()`. |
| `core` `EnvironmentInterface` | `enterTask` / `exitTask`, optional so an embedder's own Environment need not have a notion of a task. |
| `core` `CommandSessionManager` | Injects `PENGUIN_SESSION_ID` / `PENGUIN_TASK_ID` into every command subprocess, **after** the vault, and strips any inherited value of both. |
| `server` `SessionManager.startTask` | Allocates the id at **acceptance** — queued work included — and returns it. |
| `server` `task_state` | Carries `taskId`, and `taskFailed` on an abnormal ending. |
| `server` `taskStateSnapshot()` | One producer for the subscription's first event and every live transition. |
| `browser-cli` | Reads the pair from the environment and sends it on `session new`, `execute`, `reset` and `delete`. |
| `desktop` | Tags each tab with both, and enforces them. |

Two of those deserve their reasoning recorded, because both were changed after review:

- **Goal mode uses one id for the whole loop.** Core subdivides a goal into per-round Tasks
  internally; nothing outside ever sees those. Giving each round its own id produced ownership no
  host had — tabs opened in round one closed at the end of round one.
- **There is no `--task-id` flag.** The process running the CLI *is* the agent, so a flag would let
  it name any owner it liked, including a task that has ended and whose tabs are now the user's. A
  development harness sets the environment variables, exactly as the harness does.

## 2. Ownership is enforced, not drawn

`ownedByTask` began as a field the tab strip rendered. That is not sufficient: **a retained tab
stays alive on purpose**, so nothing else refuses a write to it — the executor is connected, the CDP
session is valid, the page is there. Three layers now enforce it, each answering a question the
others cannot:

1. **Relay, per browser session** (`iabOwnershipMismatch`): relay session ids are small integers a
   caller passes as `-s 3`, and they outlive the turn that created them. `execute`, `reset` and
   `delete` compare the caller's task against the session's owner and refuse a mismatch with 409.
2. **Shell, per page** (`BrowserPane.mayDrive`): every forwarded CDP command carries the driving
   task, and the pane answers `released` / `foreign` / `gone`. This is the only layer that knows a
   tab outlived its task.
3. **Shell, per task lifetime** (`runningTasks`): a background command the Agent started keeps its
   turn's `PENGUIN_TASK_ID` for as long as it runs, so opening and claiming require the harness to
   have reported that exact `(session, task)` pair *running* — see §3a for why "not recently ended"
   was the wrong test.

`tabRegistry` (concurrency) and `ownedByTask` (task lifetime) remain two layers, as design/002 §6.4
requires, and are kept in step by an **authoritative reconciliation contract** rather than by
notifications: every target announcement carries the shell's statement of who holds the page — task,
relay session and conversation — and the shell restates all of it on every reconnect. A message lost
while the socket was down therefore costs nothing. On reconnect the relay drops what it believed
about the previous connection first, so a tab destroyed while the socket was down cannot leave a
permanent claim.

## 3. Conversation isolation

One desktop shell serves every conversation over a single backend connection. Filtering commands is
not enough: `context.pages()` and target announcements disclose URLs and titles before any ownership
check runs. So the CDP client carries its conversation (`iabSession` on the connection URL, refused
outright if absent for an IAB-bound client), every target carries its scope, and the relay filters:

- initial target lists, `Target.getTargets`, `getTargetInfo`, `attachToTarget`;
- live `Target.*` events;
- **every other backend event**, by the CDP session it was routed through — `Page.*`, `Network.*`,
  `Runtime.*` all leak page data otherwise;
- root storage-cookie routing and download-behaviour targets, which would otherwise pick another
  conversation's page nondeterministically.

Child targets (out-of-process iframes, workers) inherit their root's scope; a scoped client fails
**closed** on a target whose scope is unknown. Extension and direct clients carry no conversation
and are unaffected.

Three holes in that filtering were found and closed after review, and they share a shape: a command
that **names** what it acts on rather than being *sent* to it never reaches the shell's per-tab
ownership gate, so only the relay can refuse it.

- **One validator, not a list of special cases.** `Target.closeTarget` was special-cased and
  `activateTarget`, `attachToTarget`, `detachFromTarget`, `exposeDevToolsProtocol` and
  `sendMessageToTarget` were not. Any target id or CDP session named in a command's parameters is
  now checked against the caller's conversation before the switch, so whatever the protocol grows
  next is covered by default.
- **`getTargetInfo` no longer falls back.** Asked about a target it may not see, it used to fall
  through to "the first target this client can see" — answering a question nobody asked with
  another page's URL and title, which Playwright then treated as the page it had addressed.
- **The two shell commands take their identity from the socket.** `iab-open-tab` and `iab-claim-tab`
  are ours rather than CDP's, and they are the two that *confer* authority. They were forwarding the
  caller's own parameters, so client A could open tabs as B's live task — and the shell's "is that
  task running?" check passed, because the task named genuinely was running. The shell cannot catch
  this: it is being told a true fact by the wrong party. Conversation, task and relay session are
  now rebuilt from the URL the socket was opened with (`iabRelaySession` joins the other two there),
  and a payload naming anything different is refused rather than quietly overwritten. These two are
  deliberately **excluded** from the generic validator above, because their `sessionId` is a
  conversation rather than a CDP session — reading it as one refused every legitimate claim.

`Browser.setDownloadBehavior` is keyed by **owner** — conversation *and* task — rather than by
conversation, applied only to the pages that task actually owns, replayed onto a new page as its own
owner (a released tab inherits nothing), and its refusals are returned to the caller instead of
being logged and swallowed.

## 3a. A task's authority, decided in the main process

One root cause behind two failures: **the renderer is not a witness to a task's life**, and every
design that treated it as one leaked authority in one direction or lost an ending in the other.

The renderer-side watcher this phase started with is gone. It was a module singleton, so a reload
took it with it; it marked a task reported before the bridge had accepted the message, so a rejected
delivery was simply lost despite a comment promising a retry; and a task's ending depended on
something in the renderer still being alive to notice it.

What replaced it is a **main-process reconcile loop** (`desktop/src/task-supervisor.ts`) against a
new cookie-authenticated endpoint, `GET /api/sessions/browser-tasks`, which answers with the running
turn and the most recent finished turn for each conversation the pane holds anything for. Main
applies the answer; the renderer's only channel is an argument-free hint that brings the next poll
forward.

Reconciliation rather than delivery is what makes it durable, and the properties follow from the
shape rather than from care:

- a route change, a renderer reload, an SSE reconnect and a transient IPC failure all converge the
  same way — by asking again;
- there is no queue to lose, no acknowledgement to miss and no retry to schedule;
- a tick that **fails changes nothing**, because treating an unreachable server as "nothing is
  running" would release the tabs of every turn in progress;
- an answer that is not fully understood is refused rather than read as an empty one, for the same
  reason: an empty list is a positive statement that every turn has ended;
- the answer must cover **exactly** the conversations asked about — a missing entry would strand a
  conversation's tabs forever, a duplicate would confirm and revoke the same turn in one tick — and
  the shell asks in batches of 100 because the server refuses a larger query rather than truncating
  it;
- a request still in flight when the window closes applies nothing.

Two further races were fixed after review. A caller needing the truth *now* — a turn's first
`tabs.open()` — no longer joins whatever tick is already running: that tick snapshotted its
conversations before the caller existed, so joining it produced a confident `IAB_TASK_NOT_LIVE` for
a turn the server had running all along. It chains a fresh tick instead, one for however many
callers arrive. And a hint that lands inside the rate-limiting window is **deferred, not dropped** —
the hint just after a tick is the one that matters most.

**Authority is positive, and it comes only from here.** `openTabForAgent` and `claimTab` require the
server to have reported that exact `(conversation, task)` pair running. The earlier rule — refuse
ids seen to end — was weaker than it read: the record is bounded, so an id fell out of it after a
few hundred turns and became acceptable again, and a pane rebuilt with its window started with an
empty record. A turn this pane has seen end is never re-accepted, even if a poll that raced the
ending still names it as running: task ids are minted once and never reused, so "running" about an
id we have seen end is always the older fact.

A tab whose CDP handshake fails now rolls back **the tab only**. It used to release the task as
well, so the retry its own error message asked for was refused as not-live, and the turn could never
open another tab.

## 3b. What the renderer may show

`sessionScope` was published for the renderer to detect a stale frame, and the renderer never
compared it. React paints conversation B immediately; main hears about the switch over IPC some
milliseconds later and goes on publishing A's tabs until it does.

The strip is now gated on three-way agreement — the route, main's confirmation *of that request*,
and what main is publishing (`browser-pane-scope.ts`). Answers are matched to requests by counter,
because two route changes can settle out of order and the earlier answer names the conversation the
user has already left. Every failure mode lands on "show nothing".

The hide that precedes the switch is the one place in the bridge where that is not enough, and it is
worth being precise about why. The switch runs in a `useLayoutEffect`, inside the commit that
changed the route — but a layout effect returns immediately, so an asynchronous `invoke` there is
only *started* before the browser paints the new conversation, and whether main hid the view first
is a race with the IPC. The view is a surface composited above that frame, so losing the race puts
the previous conversation's page over the new chat.

So `iab:hide-now` is a **synchronous** channel — the only one in this bridge — and the renderer
blocks on it before the frame can paint. It is as narrow as the guarantee allows: no arguments, no
way to *show* anything, refused for any sender but the app window, and answering `false` rather than
throwing when the pane cannot be hidden. Showing again goes back through the ordinary asynchronous
path once the new conversation has measured its own hole. A `false` stops the switch and confirms no
scope, which keeps everything hidden.

## 4. The tab lifecycle (design/002 §6.4)

All four policies are implemented in `desktop/src/tab-lifecycle.ts`, which is pure.

**End of task.** `read_only` closes; `committed`, `failed` and `unknown` retain; the user's own
"keep" mark outranks all of them. The outcome is **declared by the agent** when it closes its
browser session and **applied at the harness's own end-of-task boundary** — the agent declares
before the turn is actually over, so an abort or a converged terminal failure afterwards overrides a
declared `read_only`. Declarations merge conservatively: one task can search in one browser session
and book in another, and the search's `read_only` must not erase the booking's `committed`.

The server's notion of "abnormal" covers all three ways a turn ends badly: a thrown run, a user
abort, and — the one that needed finding — a **converged terminal failure**, which does not throw at
all. Core turns LLM and tool failures into messages, and the run's ending is marked by an `abort`
message on the main session. A `catch`-only flag would have read a 401 as a clean read-only run.

**Session recovery.** The checkpoint records URLs, conversation scope, retain marks and the active
tab. It records **no owner at all** — the field is absent from the format, so a restore cannot
resurrect one; restored tabs come back unowned and must be claimed the ordinary way.

**Crash recovery.** A single renderer death rebuilds that tab only, at its last URL. `killed` is
*not* treated as intentional: the Linux OOM killer, a container memory limit and `kill -9` all
report it, and those are exactly the cases where the page must come back. Only the pane's own
teardown marker, and `clean-exit`, suppress a rebuild. `main.ts:205` registers the window-level
`render-process-gone` handler on `win.webContents`, so an IAB view cannot reach the app reload.

**The crash prompt.** Kept in a **second file**. The live checkpoint is rewritten on every
navigation and cleared on a clean shutdown; using one file for both meant the first tab opened after
launch erased the pages being offered, and closing the window discarded an unanswered prompt. Two
crashes in a row merge, de-duplicated by URL within a conversation.

Promotion into that second file is **conditional on the write landing**. `write()` reports whether
it did; if it did not, the crashed run's own file is left exactly where it is and live checkpointing
is suspended for the run so nothing overwrites it — the prompt is answered from an in-memory copy
meanwhile. Clearing the original on an unverified copy was the same "old or new, never neither"
failure as unlinking before renaming, one level up.

## 5. Everything else in the phase

- **Chrome**: self-drawn tab strip (`role="tablist"`, roving tabindex, auxiliary controls off the tab
  order with keyboard equivalents on the tab), address bar as a real form with URL normalisation,
  back/forward/reload/stop, a visible and retryable `did-fail-load`. Focus follows selection for
  *keyboard* navigation only — arrow keys, Home/End, and Delete, which hands the caret to whatever
  becomes active rather than letting it fall out of the tablist — and the request is cleared if main
  refuses or the tab disappears, so a later agent-opened tab cannot inherit it. A pointer close
  deliberately does not move focus.
- **URL completion**: https for a public host, **http for loopback**. "It will redirect" is false for
  a local development server: an http-only server cannot answer a TLS handshake at all, so
  `localhost:3000` would simply have failed to connect.
- **Failures are surfaced**: switching backend, opening in the default browser and clearing the
  profile report their errors through the existing toasts rather than being swallowed, and the
  clear-profile dialog stays open when it fails. Clearing is transactional in the safe order — the
  profile is cleared first and the tabs are closed only once it succeeded, so a failure leaves the
  user with their tabs *and* their session rather than neither.
- **Shortcuts**: one routing table (`browser-shortcuts.ts`), applied by main on *both* focus paths
  through `before-input-event` — the app window and every view — because focus can be inside a page
  where the renderer sees nothing. `preventDefault()` there also suppresses the menu accelerators,
  so Cmd+R reloads the tab without rebuilding `menu.ts`. `[` and `]` are history, not tab order.
- **Occlusion**: one reference-counted registry, because overlays nest. All eight portal/overlay
  components are wired — Modal (and ConfirmModal through it), Drawer, Sheet, ImageZoom, Dropdown,
  Select, OptionMenu, Toaster — enumerated from `createPortal` and `fixed inset-0` rather than
  sampled. Full-screen overlays always occlude; floating panels report a rectangle and occlude only
  while it intersects the pane. Re-evaluated on scroll, resize, and when an open overlay changes
  shape.
- **Three-panel coordination**: opening Files or Subagents retracts the browser (the user chose the
  panel); the browser opening on its own suppresses their *rendering* while preserving their state,
  so whatever was open returns when it closes. A window too narrow to split gives the browser the
  whole area rather than leaving it open with nowhere to draw.
- **Profile**: "clear browser data" clears storage **and** the HTTP cache **and** cached
  credentials — any one of the three left behind makes it not a sign-out. Refused while any task is
  running, because the profile is shared by every conversation.
- **Downloads**: implemented per design/002 §5.2 rather than left cancelled. Files go to the
  **Session's own scratchpad** — `<agentDir>/scratchpad/<sessionId>/downloads` — which is the
  directory the agent and the server already read and which is deleted with the Session. Four things
  make that safe rather than merely convenient, and each was a defect first:
  - **The mapping is the server's.** Which project and Agent a conversation belongs to comes back
    with the task state, from the sessions index, checked against the caller's access. The renderer
    supplies neither a path nor a triple; a conversation/project/agent triple from the renderer is a
    relationship nobody has verified.
  - **Containment follows links.** `path.relative` compares text, and a symlink anywhere along the
    way makes that text a lie. Every component that exists is resolved with `realpath`, and only
    components that do not exist yet — the ones about to be created — are taken on trust.
  - **Checked again at the moment of use.** The directory is resolved when the shell learns who owns
    a conversation; the file is written minutes later, and in between anything running as the user
    (the agent's own shell commands included) can replace `downloads`, or a directory above it, with
    a link pointing anywhere. So `will-download` re-resolves after creating the directory and joins
    the filename onto the **resolved** path, and a download it cannot place is cancelled.
  - **The name is reserved, not merely checked.** Two downloads starting together both saw an empty
    directory and were handed the same name. Names are reserved in memory until the download is done
    with them, and the collision check uses `lstat`, because a *dangling* symlink is invisible to
    `existsSync` and would have been written straight through.

  The path assignment cannot throw: an exception escaping a `will-download` listener is an uncaught
  exception in the main process, so every failure — a destroyed item, a broken logger, a name that
  cannot be read — is a refusal and a cancelled download instead.
- **Backend selection**: per conversation, not global. Held shut while that conversation has a task
  running. Unavailable — with a reason the user can act on — when the `chrome.fallback` flag is off
  or when this run's relay is not the one an extension can reach.

## 6. The relay-port split, resolved

The desktop shell prefers port 19989 but binds an ephemeral one when something else owns it. Phase 1
recorded the consequence as unresolved. Two halves, both now closed:

- **Every command resolves the same relay.** `session new --iab` consulted the shell's published
  endpoint while `execute` used the conventional port, so a session created on one relay was
  executed against another that had never heard of it — surfacing as "session 3 not found".
  `getServerUrl` now uses the same resolution as `--iab`.
- **The extension backend is refused rather than routed around.** When this app's relay is not the
  one an extension connects to, the extension backend is unreachable *from this app*; the pane says
  so and refuses the choice. Splitting a conversation across two relays was the alternative.

The reserved IAB backend is also excluded from every public Chrome-extension discovery path —
`/extension/status`, `/extensions/status`, `/json/list`, and the single-backend fallback — so
"in-app browser only" looks exactly like "no Chrome extension". An explicit lookup by its reserved
id still works, which is how the IAB path finds its own backend.

## 7. Popups

Adopted rather than re-navigated. Electron 43's window-open handler supports `createWindow`, which
lets the shell return a `WebContents` of its own and have Chromium use it as the real child — so a
popup keeps its opener, its `window.name`, its referrer and any POST body, and the common
`window.open()`-then-assign flow works. It becomes a tab of ours, inheriting the opener's
conversation, task and relay session, and never reaches the system browser.

## 8. Test coverage

Run per package from the repository root. `TMPDIR` is set here only because this sandbox cannot
write to `/tmp`; CI does not need it.

```
pnpm --filter @prismshadow/penguin-core    exec vitest run
pnpm --filter @prismshadow/penguin-server  exec vitest run
pnpm --filter @prismshadow/penguin-web     exec vitest run
pnpm --filter @prismshadow/penguin-desktop exec vitest run
pnpm --filter @prismshadow/penguin-desktop run test:e2e     # Electron + Xvfb
pnpm --filter penguin-browser              run test        # the package's own serial gate
pnpm -r exec tsc --noEmit -p tsconfig.json
pnpm -r run build
pnpm format:check
```

| Suite | Covers |
| --- | --- |
| `desktop/test/tab-lifecycle.test.ts` | Four end-of-task policies, crash triage (`killed` rebuilds), checkpoint parsing as untrusted input, merge across two crashes, atomic replacement keeping the old file when the rename fails |
| `desktop/test/browser-pane-behaviour.test.ts` | Multi-tab, scoping, visibility refusal, ownership (`released` / `foreign` / `gone`), claim, **positive task liveness** (unreported id, id aged out of the ended record, rebuilt pane, wrong conversation, a stale answer naming a finished turn), a turn ending while the user is elsewhere, the **last** published state unlocking the backend, handshake-failure rollback keeping the turn's authority, outcome merging, popups, crash rebuild, restore **all-or-preserve** including a view that will not build, a crash rebuild whose view construction fails (no throw out of the event, no view left attached, the page kept and retryable, and a successful retry), a tab left with **no** view (not decided by `isDestroyed`, no stale target id, closed by the end-of-task rules, its page kept when a retry fails again, and its URL read back **from the checkpoint file** after the debounce), a view that fails *after* being attached (child view removed, `WebContents` closed, tab out of the model — on both the create and the crash-rebuild paths), a throwing logger and a throwing state push, download routing per conversation, profile lock |
| `desktop/test/task-supervisor.test.ts` | The reconcile rules; a failed tick applying nothing; a mid-flight caller getting an answer about *its* conversation; one follow-up for many callers; a deferred hint; nothing applied after `stop`; the strict response contract (missing, duplicate, extra, malformed, half-owner); batching past the server's per-query cap and discarding a tick when one batch fails |
| `desktop/test/browser-shortcuts.test.ts` | The routing table and exhaustive modifier matrices |
| `desktop/test/iab-transport.test.ts` | Wire protocol, identity requirements, ownership refusals with their codes |
| `desktop/test/session-partition.test.ts` | Permission default-deny, the exact scratchpad shape, containment through **real** paths, nothing created outside the root when a parent is a link, re-validation at download time after a directory is swapped for a link, a dangling-link filename, concurrent same-name reservations, and the failure paths that must never throw out of `will-download` |
| `desktop/test/ipc-validation.test.ts` | Channel argument validation, including ids, outcomes and backends |
| `desktop/test/boot-plan.test.ts` | Both ways up carry the data root, and an attached shell can still resolve a conversation's download directory |
| `desktop/test/ipc-hide-now.test.ts` | The synchronous hide: registered as `on` rather than `handle`, hides before returning, refuses a foreign sender, answers `false` instead of throwing, removed on dispose |
| `web/test/browser-pane-scope.test.ts` | The three-way scope gate, out-of-order answer matching, and the switch sequence — hidden before returning, nothing announced when the hide fails, no scope confirmed on any failure |
| `web/test/tab-focus.test.ts` | Roving focus: a keyboard selection takes the caret, a refusal disarms, an emptied strip disarms, a later agent-opened tab inherits nothing, a tab with no node yet keeps the arming, pointer changes take nothing |
| `web/test/pane-occlusion.test.ts` | Reference counting, nesting, rectangle intersection, notification |
| `web/test/browser-url.test.ts` | Completion (https public, **http loopback**), scheme refusal, `host:port` |
| `core/test/task-identity.test.ts` | Id shape; the child environment's stripping, injection order and all-or-nothing rule |
| `server/test/task-identity.test.ts` | Id at acceptance, queued work, snapshot while running, after ending, after an abnormal ending, after idle eviction |
| `server/test/browser-tasks-route.test.ts` | The authority the shell polls: the Agent mapping from the index, running and finished turns, a failed turn, unknown and unauthorised answering identically, one state per requested id, the per-query cap, and no access without a cookie |
| `browser-cli/src/iab-scope.test.ts` | Two conversations on one backend: target lists, `getTargetInfo` refusing rather than falling back, six root commands that name a target, event isolation, socket-bound identity for `iab-open-tab` / `iab-claim-tab` including cross-task forgery, and owner-scoped download behaviour with replay and surfaced refusals |
| `browser-cli/src/agent-identity.test.ts` | Environment reading and refusals; no command-line override |
| `browser-cli/src/backend-preference.test.ts` | Per-conversation isolation, bounding, hostile files |
| `desktop/e2e/` (Electron + Xvfb) | Cold start, identity refusal, stale-task refusal, multi-tab, tab switching, cross-task refusal, end-of-task retain, refusal after release |

**Counts at this commit**, from the commands above:

| Gate | Result |
| --- | --- |
| core | 866 passed, 5 skipped (871) |
| server | 613 passed (613) |
| web | 742 passed (742) |
| desktop | 465 passed (465) |
| desktop e2e (Electron + Xvfb) | 19 assertions, all passed (exit 0) |
| browser-cli (`pnpm test`, serial) | **462 passed, 1 skipped, 6 failed** (469) — the six are the pinned-Chromium baseline below |
| typecheck (`tsc --noEmit`, all packages) | clean, all 9 packages |
| build (`pnpm -r run build`) | clean, all packages |
| `pnpm format:check` | clean |

**The `browser-cli` baseline, stated exactly.** The gate is that package's own script,
`pnpm --filter penguin-browser run test`, which is `vitest run --no-file-parallelism` — run alone,
with no other browser or Electron gate in flight, because these suites launch Chromium and contend
for CPU and ports. It exits **1**, and the wrapper's exit code is not the thing to read: the run is
`Test Files 2 failed | 39 passed (41)`, `Tests 6 failed | 462 passed | 1 skipped (469)` in 249s,
with **zero failed suites, zero failed hooks, zero unhandled errors and no `EEXIST`**.

The six failures are the pinned-Chromium baseline recorded in `phase-00.md` §3 and `phase-01.md`,
name for name — five in `relay-core`, one image snapshot in `snapshot-tools`:

1. `Relay Core Tests > should ignore duplicate dialog dismissals from multiple CDP clients`
2. `Relay Core Tests > should preserve system color scheme instead of forcing light mode`
3. `Relay Core Tests > should show descriptive error when clicking a hidden element`
4. `Relay Core Tests > should show descriptive error when clicking an element covered by another`
5. `Relay Core Tests > should show descriptive error when clicking a display:none element`
6. `Snapshot & Screenshot Tests > should capture screenshot correctly`

The suite pins Chromium 1209; `@xmorse/playwright-core` is not in `allowBuilds`, so nothing installs
it, and locally a cached 1228 is symlinked as 1209 — an environment-only workaround, not committed.
All six are explained by that substituted build and the headless container (three actionability
messages, one dialog case that reads a relay log the harness no longer writes to that path, one
dark-mode expectation, one image snapshot). The single skip is
`relay-navigation.test.ts > should record screen with navigation using chrome.tabCapture`, an
`it.skip` that predates this phase. Phase 1 recorded 402 passed / 1 skipped / 6 failed; the passing
count is higher here because this phase added tests, and the skip and failure sets are unchanged.

**An earlier run of this phase was not that**, and saying what it was matters more than the number.
Running with file parallelism gave `344 passed, 96 skipped, 10 failed suites` — and those 96 skips
were not a missing browser. Three suites failed in `beforeAll` because their `pnpm build` of the
extension ran concurrently under load, one more timed out waiting once that build was serialized,
and a relay started by this phase's own new test truncated the *shared* CDP log file that
`relay-core` measures. A suite that dies in setup reports its tests as *skipped*, which reads
exactly like the pinned-Chromium baseline and is not it. All three causes are fixed (findings 64 and
65); the numbers above are what the repository's own gate now produces.

## 9. Explicit non-goals

Not omissions — each is assigned elsewhere:

1. `requestUserInteraction`, payment confirmation, the Vault and `secret_entry` — Phases 3 and 4.
2. The control-handover state machine (design/002 §6.5), which is why `PaneState` carries `backend`
   but no `control`: adding the field now with a constant value would be a promise the code does not
   keep.
3. Handoff of the candidate set, Intent and Commitment (design/002 §7.2). `BackendHandoff` carries
   the deep link and the conversation only; the other three have no producer, so they are absent
   from the type rather than present and always undefined.
4. "Open in my default browser" is labelled as what it is — the OS URL handler, which may not be the
   browser the extension is connected to, and which carries none of the in-app session. The real
   backend handoff is choosing the extension backend for the conversation.
5. A popup's *opener handle* survives adoption, but a page that assigns `location` on a window it
   opened is exercised only by the unit tests; the manual pass covers it on a real site.
6. **Attach mode has no separate path, deliberately.** The shell can attach to a server it did not
   spawn, in which case it holds no desktop token — so the task-state endpoint is authenticated by
   the window's own session cookie and both modes take the same route. There is no fallback that
   grants authority without the server: before the window has signed in, the request throws, the
   supervisor applies nothing, and a tab open is refused with `IAB_TASK_NOT_LIVE` rather than
   allowed on the strength of a renderer's claim.
7. The relay's `owned` refusal on `iab-claim-tab` is now unreachable through the authoritative path,
   because a conversation runs one turn at a time and learning about the new turn is the same event
   as learning the old one ended. It is kept as defence for the instant in between; the reachable
   behaviour — the next turn claiming the tab its predecessor left — is what the test asserts.

## 10. Findings fixed during the phase

Ordered as they were found. Each was a defect in the working tree, not a hypothetical.

1. `killed` treated as a deliberate close — an OOM-killed tab was silently dropped.
2. Checkpoint restored `ownedByTask` from a dead run; the field was removed from the format.
3. Checkpoint replacement unlinked the destination before renaming, and spun the main thread
   retrying — the "old or new, never neither" guarantee, and a frozen window.
4. `[` / `]` mapped to tab order rather than history.
5. `tabIdForAction` clamped a missing active tab to index 0, so "next" landed on the second tab.
6. `sessionScope` and `ownedByTask` conflated; a Session has many Tasks.
7. Renderer-facing tab operations accepted any guessable tab id.
8. `createTab` recorded the selection under the *viewed* conversation, not the tab's own.
9. `destroy()` cleared the checkpoint timer, then re-armed it by closing tabs.
10. The user-close notice held a soon-dead `WebContents`.
11. Transport routing fell back to the active view for an unknown session id — a stale command could
    execute on another tab, and the closed-tab tombstone was unreachable.
12. Relay session reuse across tasks; `execute`, `reset` and `delete` now check the caller's task.
13. `tabs.claim()` updated only the local registry, so the shell refused every subsequent write.
14. Task end released nothing in the relay, leaving retained tabs permanently unclaimable.
15. Fire-and-forget ownership notifications could not converge; replaced by reconciliation.
16. Reconciliation ran for the Chrome extension backend too, clearing its claims on every attach.
17. `taskId` was stamped only on the default forwarding branch — Playwright's own bootstrap
    (`setAutoAttach`, `Runtime.enable`), page close and cookies were refused as foreign.
18. Root cookie and download routing enumerated every conversation's targets.
19. Cross-conversation target and event disclosure.
20. `Browser.downloadWillBegin` compat events carry no target or session, so scoped clients refused
    their own downloads; routed by a fan-out-only scope hint.
21. `/cdp` accepted an IAB-bound client with no identity, which was then unscoped.
22. The IAB backend appeared in public extension discovery, so "my own Chrome" could select it.
23. The executor's extension-status pre-flight failed IAB sessions once that filtering landed.
24. `iab-claim-tab` was forwarded to Chromium as a CDP command instead of to the shell.
25. Observed destruction (`window.close()`) skipped cleanup, leaking the native child view and
    leaving a stale claim, selection and checkpoint.
26. `openTabForAgent` left an unusable tab and a running-task lock behind when the debugger never
    attached.
27. A stale background process could open or claim tabs under a finished task's id.
28. Declared outcomes overwrote each other; the last close could erase a `committed`.
29. `task_state` idle carried no task id, so a client reconnecting after a turn ended stranded its
    tabs; the record now outlives entry eviction and carries `taskFailed` with it.
30. Converged terminal failures (auth, malformed, timeout) read as normal endings.
31. Backend preference was global; changing one conversation changed all of them.
32. `clearProfile` ran mid-task; `intersects` counted a zero-area rectangle as an overlap; the
    Toaster measured a full-width layer so any toast hid the browser.
33. The three-panel layout rendered the browser alongside a docked panel, and a narrow window left
    the pane requested with nowhere to draw it.
34. The tab strip nested interactive controls inside `role="tab"`, never moved focus, and made every
    tab three tab stops.
35. A test's teardown deleted the OS temp directory rather than its own directory.
36. A task that finished after the user opened another conversation reported nothing, because the
    only stream watching it had been disposed with the route.
37. Downloads went to `userData/iab-downloads/<conversation>` — not the Session scratchpad the design
    names, not readable by the agent, and not deleted with the Session. Same-named downloads also
    overwrote each other.
38. `clearProfile` closed every tab *before* clearing, so a failed clear cost the user their tabs and
    left them signed in; the menu swallowed the rejection and closed the dialog as if it had worked.
39. Task authority was "not recently ended", which a bounded record and a rebuilt pane both defeat.
40. The renderer never compared `sessionScope`, so a conversation switch showed the previous
    conversation's tabs — and its native view — until the IPC round trip landed.
41. Crash-snapshot promotion cleared the crashed file whether or not the copy had been written.
42. Keyboard close dropped focus out of the tab strip; a rejected selection left the focus request
    armed for whatever changed next.
43. `normalizeUrlInput` sent `localhost:3000` to https, which an http-only development server cannot
    answer at all — the "it will redirect" argument is false for loopback.
44. `Target.getTargetInfo` resolved a CDP session straight from the unscoped map; `Target.closeTarget`
    forwarded any target id; `Browser.setDownloadBehavior` kept one behaviour for the whole shared
    backend and applied it to every conversation's pages, unstamped.
45. `IabTransportOptions.openTab` omitted `relaySessionId`, which the runtime passed.

Found in a second round of review, after the first commit. Each was a real defect in the working
tree; several were only reachable because the first fix was in the wrong place.

46. The task watcher was a renderer module singleton: a reload took it with it, so a turn running
    when the window reloaded was never watched again. It also marked a task *reported* before the
    bridge accepted the message, so a rejected delivery was lost despite a comment promising a
    retry. Replaced wholesale by the main-process supervisor (§3a).
47. Task authority still came from a renderer message, so any id not in the bounded ended-set could
    be re-authorised by a stale frame. Authority now comes only from the server, and the renderer's
    channel carries no arguments at all.
48. A stale server answer naming a finished turn as running re-granted its authority. A turn this
    pane has seen end is never re-accepted.
49. `openTabForAgent`'s handshake failure called `releaseTaskIfIdle`, deleting a still-running
    turn's authority — so the retry its own error message suggested was refused as not-live.
50. `endTask` published its state *before* deleting the running task and never published again, so
    the renderer's last word left `backendLocked` and `profileResetLocked` true forever.
51. Download containment was lexical only (`path.relative`), so a symlink anywhere along the path
    escaped it; the project and agent came from the renderer rather than from the server; and
    `uniqueDownloadPath` checked with `existsSync`, which is neither a reservation nor able to see a
    dangling link.
52. The download directory was validated once, when it was resolved, and never again at the moment
    of writing — a window in which anything running as the user can replace a component with a link.
53. The conversation switch cleared the bounds fire-and-forget from an ordinary effect, which runs
    after React has painted the new conversation. Now a layout effect and a **synchronous** hide
    channel, because an asynchronous message cannot make the ordering guarantee (§3b).
54. `Target.getTargetInfo` fell back to the first visible target when asked about one it could not
    see; five other root commands that name a target were never checked at all.
55. `iab-open-tab` and `iab-claim-tab` took their conversation, task and relay session from the
    caller's own parameters, so one client could act as another's live task.
56. Running the generic CDP parameter validator over those two commands then refused every
    legitimate claim, because their `sessionId` is a conversation rather than a CDP session.
57. `Browser.setDownloadBehavior` was cached per conversation without the task, applied to released
    and other turns' tabs, replayed without its owner, and its refusals were swallowed.
58. Crash restore cleared the pending snapshot before creating any tab, so a `createTab` that threw
    lost the crashed run's pages permanently. Now all-or-preserve, with the offer surviving for a
    retry, and `createTab` no longer leaves a registered tab behind when its view will not build.
59. `TaskSupervisor.reconcile` joined whatever tick was in flight, whose conversation list predated
    the caller — producing a confident `IAB_TASK_NOT_LIVE` for a turn the server had running. A
    rate-limited hint was also dropped rather than deferred.
60. The supervisor's response reader coalesced anything malformed into "nothing running", which
    *ends* turns; and a shell holding more conversations than one query allows would have failed
    every reconcile once that was tightened, so the query is batched.
61. An answer that still applied after `stop()` reached into a destroyed pane.
62. Pointer tab actions had no `catch`, so an ordinary stale-tab race became an unhandled rejection.
63. A `setSavePath` that throws inside `will-download` is an uncaught exception in the main process.
    The whole path assignment is now non-throwing, the reservation is released on every failure, and
    the filename is read once so reporting a failure cannot itself throw.
64. Three browser-cli suites failed at setup because their `pnpm build` of the extension ran
    concurrently under load; their tests were then reported as *skipped*, which reads exactly like
    the pinned-Chromium baseline. The build is now serialized across worker processes, and a build
    failure reports stdout as well as stderr.
65. A relay started by a test truncated the *shared* CDP log file, which another suite was in the
    middle of measuring — turning a passing download-events assertion into a mystery. Test relays
    now log to their own temp files.
66. `boot()` returned from its attach branch without setting the data root, so a shell attached to
    an already-running server resolved no download directory for any conversation and **cancelled
    every download** — the opposite of the both-modes contract this phase documents. The decision is
    now a pure function (`boot-plan.ts`) producing the root for both modes, so the two cannot drift.
67. The download directory was created before containment was checked, so a parent replaced by a
    link out of the data root had its child directory created *outside* the root before the
    post-check refused the bytes. Containment is now a fail-closed preflight, with the realpath
    post-check kept for the race the preflight cannot see.
68. `recoverFromCrash` called `buildView` directly inside Chromium's `render-process-gone` listener,
    so a view that could not be constructed threw out of an event handler — an uncaught exception in
    the main process, taking the app down because one tab could not be rebuilt. It is now
    non-throwing: the tab stays in the strip with its URL and a retryable failure, `reload` on a
    dead view *is* the rebuild, and the address bar is a retry with a destination.
69. `buildView` assigned the new view to the tab before it was whole, so a failure after
    construction left a `WebContentsView` attached to the window that nothing would ever position,
    hide or destroy. It is transactional now: committed only when complete, and the discarded view
    is detached and closed on every failure path.

Found in a self-audit of those four fixes, before the amend.

70. "This tab has no view" was being inferred from `isDestroyed()`, which Electron does not promise
    for a `WebContents` that has been closed and detached. After a failed rebuild the tab could
    therefore still look driveable, and the retry would reload a page nobody could see instead of
    building one. `Tab.view` is nullable now — the compiler enumerated the fifteen call sites, and
    they all ask one predicate, `contentsOf`.
71. A failed rebuild left the tab holding the CDP target id of the page it lost, so a command
    addressed to that id still resolved to this tab — after the relay had already been told the
    target closed. Cleared when the dead view goes.
72. The retry that carries a destination (a URL typed into the address bar) overwrote the tab's
    remembered URL *before* attempting the build, so a retry that failed again lost the page the
    tab was showing — from the strip and from the checkpoint. The URL is now recorded only on
    success.
73. The popup handler built its tab inside `createWindow`, which Chromium calls while deciding what
    to do with `window.open` — the same "exception out of an Electron callback" as the crash path,
    one call site away. It refuses the popup instead.
74. `onNotifyRelay` was called bare from two Chromium event listeners, so a throw from the transport
    would have escaped them. It goes through a guarded helper: a missed announcement is restated on
    the next reconnect by design, which is why losing one costs nothing.
75. `log` and `publishState` could each throw from inside those same listeners — the log sink is
    injected, and `webContents.send` throws once the window is destroyed, which is exactly when a
    crashing view's event is most likely to arrive. Both are guarded now; a "never throws" path is
    only as good as what it calls to say what it did. The catch-up loop in `setViewCreatedHandler`
    is guarded per tab too, so one view the transport cannot attach to no longer stops the rest.
