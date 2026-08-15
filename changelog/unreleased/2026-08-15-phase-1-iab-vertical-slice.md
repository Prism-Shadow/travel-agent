# Phase 1: the agent searches Ctrip inside the app window

The right half of the Travel Agent window is now a real browser. Not a screenshot, not an iframe,
not a second Chrome: a `WebContentsView` renders the page a few hundred pixels from the
conversation, the user can click and scroll it, and the agent drives those same pixels over CDP.

Switched off by default. `PENGUIN_FLAGS=iab.enabled pnpm desktop` turns it on; with the flag off no
view, no IPC handlers and no relay transport are constructed, and the web app hides the column
exactly as it does in a browser tab.

**The shell speaks the protocol the relay already knows.** A Chrome extension bridges
`chrome.debugger`; the desktop shell now bridges `webContents.debugger`. Both hand the relay the
same thing — independent per-target debugger sessions exchanging `forwardCDPCommand` /
`forwardCDPEvent` — so target synthesis, Playwright bridging, tab ownership and the executor all
work unchanged. The `/extension` socket implementation is shared verbatim with the new `/iab`
endpoint; only the authentication differs, and only the authentication is written twice.

That endpoint closes three doors. It is loopback-only; it requires a 32-byte per-run key handed to
the relay through its environment rather than argv, which every process on the machine can read; and
it refuses any request carrying an `Origin` header at all, because a Node client never sends one and
a page always does. A relay started without a key — a standalone `penguin-browser serve` — refuses
every connection, so nothing is exposed where there is nothing to drive.

**One command is ours.** Phase 0 established that `Target.createTarget` answers "Not supported" on
Electron, so `tabs.open()` in this mode asks the shell to build a view and resolves the Playwright
page by the target id it returns. `context.newPage()` is never called.

**A narrow break in a standing rule.** `main.ts` has never had a preload or an IPC channel; a
`WebContentsView` is positioned by the main process, so the renderer has to be able to say where it
goes. The break is four named channels, every argument validated in main, the sender checked against
the app window — and no preload at all on the pane's own views, where a booking site's code runs
behind a separate session, sandboxed, with permissions denied by default and `http`/`https`
navigation only.

Verified against the live site: navigation, an accessibility tree carrying Ctrip's own Chinese
labels, and all three interaction primitives on the real hotel form — `fillWithSuggestion` committing
「东京」 through the autocomplete, `clickThrough`, and `pickDate` moving the check-in field from
`8月16日(周日)` to `8月22日(周六)`. Full record, including two bugs that looked like transport
failures and were not: `docs/verification/phase-01.md`.

The Chinese IME smoke named in the phase's exit criteria needs a real window and could not run on
the headless build host, so the phase is `code_complete_manual_pending` and the flag stays off.
Pending items: `docs/manual-testing/phase-01-vertical-slice.md`.

A second pass after full-diff review fixed thirteen findings, several of which read as working. The
flag bridge was never actually wired — the preload looked for a switch main did not pass. Permissions
denied a list rather than allowing one, so anything Chromium adds later would have been granted.
The pane had no splitter and, on a narrow window, a toggle that opened something a breakpoint kept
hidden. An agent could open a tab and drive a browser the user never saw. And two ordering bugs bit
at cold start: with no targets there was no page for the executor to ask for a tab *through*, so the
agent could never create the first view — the relay now bootstraps one when the session is created —
and the shell would borrow whatever relay held 19989 despite that relay never having received this
run's key, which meant a silent 401 loop for anyone who had run `penguin-browser serve` first. The
shell now takes 19989 when it is free, reuses an existing relay only when the pane is off (so the
Chrome extension keeps working for everyone who never enables it), and starts its own on a dynamic
port when the pane is on and the port is taken. It never kills a process it does not own.

`pnpm --filter @prismshadow/penguin-desktop test:e2e` is the guard: a real Electron main process, a
real preload, a real WebContentsView and a real relay against a local fixture on a dynamic port,
starting from a closed pane with zero targets — the shape the cold-start bug needed.
