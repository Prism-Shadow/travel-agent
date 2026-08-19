# Phase 2 — manual verification

Template and status machine: [`_template.md`](./_template.md). Evidence and automated results:
[`../verification/phase-02.md`](../verification/phase-02.md).

Everything here needs a real window, a real person and — for several items — a real booking site.
The automated suites cover the rules; what they cannot cover is whether a tab strip *feels* like a
browser, whether a screen reader can use one we drew ourselves, and whether killing a renderer for
real behaves like the crash triage says it should.

The pane is on and opens by default. Both browser choices are offered in a normal run; IAB remains
selected for every new conversation:

```bash
pnpm desktop
PENGUIN_FLAGS=chrome.fallback=false pnpm desktop   # diagnostic rollback: hide Chrome
```

The explicit false override exists for rollback testing; Chrome no longer needs an opt-in flag.

| ID | Title | Severity | Status |
| --- | --- | --- | --- |
| MT-02-001 | Multiple tabs open, switch and close like a browser's | critical | PENDING |
| MT-02-002 | A `target=_blank` result on a real booking site becomes a tab, with its POST intact | critical | PENDING |
| MT-02-003 | `window.open()` then assigning `location` works | major | PENDING |
| MT-02-004 | The address bar navigates, completes and refuses | major | PENDING |
| MT-02-005 | Back, forward, reload and stop do what they say | major | PENDING |
| MT-02-006 | A failed load is visible and retryable | major | PENDING |
| MT-02-007 | Keyboard shortcuts work with focus in the app *and* inside a page | critical | PENDING |
| MT-02-008 | A screen reader can drive the tab strip | critical | PENDING |
| MT-02-009 | Switching conversations swaps the whole strip | critical | PENDING |
| MT-02-010 | A read-only task keeps its final result; a booking's tabs stay | critical | PENDING |
| MT-02-011 | Killing one renderer rebuilds one tab | critical | PENDING |
| MT-02-012 | Killing the app offers the pages back, and does not reopen them itself | critical | PENDING |
| MT-02-013 | Every overlay gets out of the browser's way, and only when it should | critical | PENDING |
| MT-02-014 | The backend choice is per conversation and cannot move mid-task | major | PENDING |
| MT-02-015 | Clearing the browser data is a real sign-out | major | PENDING |
| MT-02-016 | The extension backend still works, unchanged | critical | PENDING |
| MT-02-017 | A narrow window gives the browser the whole area | major | PENDING |
| MT-02-018 | Three panels never crush the conversation | major | PENDING |
| MT-02-019 | A download lands in this conversation's scratchpad | major | PENDING |
| MT-02-020 | Chinese IME still types into the pane, with several tabs open | critical | PENDING |
| MT-02-021 | A task that ends while you are elsewhere still releases its tabs | critical | PENDING |
| MT-02-022 | A local development server opens over http | minor | PENDING |
| MT-02-023 | A task that ends while the window is reloading still releases its tabs | critical | PENDING |
| MT-02-024 | Attaching to a server this shell did not start still gives tabs to a running turn | critical | PENDING |
| MT-02-025 | Switching conversations never shows the previous one's page, even for a frame | critical | PENDING |
| MT-02-026 | A download in an attached shell still lands in the conversation's scratchpad | major | PENDING |

---

## MT-02-001 — Multiple tabs open, switch and close like a browser's

Ask the agent for two different searches in one turn. Then, by hand: press ⊕, click between tabs,
close one with its ✕, mark one with ★.

**Pass:** each `tabs.open()` produced its own tab; the strip shows titles that change as pages load;
clicking a tab shows that page and nothing flickers through from the previous one; closing a tab
selects a neighbour; ★ stays lit across a reload of the app window.

## MT-02-002 — A `target=_blank` result becomes a tab, with its POST intact

On a real site (Ctrip's hotel search is the reference), submit a search whose results open in a new
window.

**Pass:** the result opens as a tab of ours, never in the system browser; it shows the *results*,
not a re-issued GET landing on an empty search form. A site that gates on the referrer serves the
same page it would in Chrome.

## MT-02-003 — `window.open()` then assigning `location` works

Find or construct a page that opens a blank window and then sets `location` on the handle it got
back. (`window.open('about:blank').location = '…'` in the page's own console counts.)

**Pass:** the new tab navigates. This is the case adoption exists for — a re-navigated copy would
leave the opener holding a handle to nothing.

## MT-02-004 — The address bar navigates, completes and refuses

Type `ctrip.com` and press Enter. Then `localhost:3000`. Then `file:///etc/passwd`. Then a sentence
with spaces.

**Pass:** the first two navigate — `ctrip.com` over https, `localhost:3000` over **http**, since a
local development server is not TLS and an https guess there fails to connect rather than
redirecting. The last two are refused visibly, with the field marked invalid and the page unchanged.
Typing does not fight a page that is still loading.

## MT-02-005 — Back, forward, reload and stop do what they say

Navigate a few pages deep, then use each control.

**Pass:** back and forward are disabled when there is nowhere to go; reload becomes stop while a page
is loading and actually stops it.

## MT-02-006 — A failed load is visible and retryable

Navigate to a hostname that does not resolve. Then reconnect and press Retry.

**Pass:** a strip names the failure and its code; Retry loads the page; the strip goes away when it
does. A failed tab does not look idle.

## MT-02-007 — Keyboard shortcuts work with focus in the app *and* inside a page

With focus in the composer, then again after clicking *into* a web page: Cmd/Ctrl+T, W, L, R, `[`,
`]`, 1, 9, and Ctrl+Tab.

**Pass:** identical behaviour from both places. `[` and `]` are history, not tab order. Cmd+L focuses
the address bar. With the pane closed, Cmd+R and Cmd+W are the window's again.

## MT-02-008 — A screen reader can drive the tab strip

VoiceOver (macOS) or NVDA (Windows). Tab into the strip and use the arrow keys, Home, End, Delete
and `k`.

**Pass:** the strip is announced as a tab list with a position; the arrow keys move the reading
cursor as well as the selection; the whole strip is one Tab stop; the keep and close buttons have
names that identify their tab; Delete closes and `k` keeps.

## MT-02-009 — Switching conversations swaps the whole strip

Open two conversations, each with its own browsing.

**Pass:** each shows only its own tabs, with its own selection remembered. A tab retained in one
never appears in the other. With no conversation open, the strip is empty rather than showing
everything.

## MT-02-010 — A read-only task keeps its final result; a booking's tabs stay

Run a search-only task through to the end. Then a task that reaches a payment page. Mark one of the
search tabs ★ first.

**Pass:** the search's selected final result stays and loses its owner; unrelated unmarked
intermediate tabs close, and the marked tab stays too. The payment page stays. Ask the agent to act
on a kept page afterwards: it is refused and says why, and does not reopen anything.

## MT-02-011 — Killing one renderer rebuilds one tab

With three tabs open, find one tab's renderer process and `kill -9` it.

**Pass:** that tab comes back at its last URL; the other two are untouched; the app window does not
reload. Repeat with the app's *own* renderer to confirm the window-level path is unaffected.

## MT-02-012 — Killing the app offers the pages back

With several pages open, `kill -9` the whole app. Relaunch.

**Pass:** the pane says how many pages the last run left and waits. Nothing is reopened until you
choose. Choose Restore: the pages come back in their own conversations, unowned. Repeat and choose
Discard: they are gone and are not offered again. Repeat once more and *close the window without
answering*: relaunching still offers them.

## MT-02-013 — Every overlay gets out of the browser's way, and only when it should

With the pane open, exercise: a modal, a confirm dialog, a drawer, a mobile sheet, an image
lightbox, a dropdown in the left column, a select inside a modal, and a toast.

**Pass:** every full-screen overlay is fully clickable — none is swallowed by the browser. A dropdown
in the left column does **not** blink the browser. The Browser Backend menu shows a frozen preview at
the native view's exact integer bounds: the page does not blank, shift even one pixel, or responsively
reflow, and closing the menu restores the live page at the same scroll position. A select inside a
modal closing does not reveal the browser over the still-open modal. A toast that does not overlap
the pane does not hide it.

Open **Import into in-app browser** and **Clear browser data and sign out** from that menu.

**Pass:** the same frozen page remains visible and correctly dimmed behind either modal until it
closes; the native page never becomes a blank rectangle. Every import-dialog label follows the
current application locale. On startup, a pending **Reopen pages** decision is centred in the whole
browser pane without an empty tab strip, address bar, or unused native-view hole around it.

## MT-02-014 — The backend choice is per conversation and cannot move mid-task

In the pane's menu, set one conversation to your own Chrome and leave another on the in-app browser.
Then start a task and try to switch while it runs.

**Pass:** each conversation keeps its own choice; plain `session new` automatically follows it in
both directions; direct/headless/cloud flags cannot bypass it; the control is disabled with a
reason while a task is running.

## MT-02-015 — Clearing the browser data is a real sign-out

Sign in to a site in the pane. Clear the browser data. Revisit.

**Pass:** signed out — not merely cookie-less. A cached page does not come back from disk and no
credential is re-offered. The action is refused with a reason while any task is running.

## MT-02-016 — Chrome setup, task tabs, and existing-tab authorization are distinct

With no extension connected, select Chrome and follow the setup prompt. Start a task without first
authorizing an existing tab. Then open a separate page yourself, click the extension icon there,
and start another task that explicitly needs that page. Also run the standalone CLI with no Desktop
preference once.

**Pass:** the first task may create its own Chrome tab after the Browser-menu selection; it cannot
adopt unrelated existing tabs. The icon adds only the clicked existing tab. Standalone auto mode
still resolves to extension, and `extensions/status` never lists the in-app browser.

## MT-02-017 — A narrow window gives the browser the whole area

Shrink the window until the two columns no longer fit.

**Pass:** the browser takes the whole area rather than disappearing; the toolbar toggle is still
there to close it; widening restores the split at its previous width.

## MT-02-018 — Three panels never crush the conversation

With the Files panel open, have the agent start browsing. Then close the browser.

**Pass:** the Files panel gets out of the way rather than sharing the width, and comes back when the
browser closes. Opening Files from the toolbar retracts the browser instead.

## MT-02-019 — A download lands in this conversation's scratchpad

Download a file from a page in the pane, then download a second file with the same name.

**Pass:** both appear under `<agent directory>/scratchpad/<session id>/downloads` — the directory the
agent can already read — with the second named `… (2)` rather than replacing the first. Neither lands
in the user's Downloads folder. Deleting the conversation takes them with it.

## MT-02-020 — Chinese IME still types into the pane, with several tabs open

The Phase 1 check (MT-01-001), repeated with a tab strip: type Chinese into a form, switch tabs
mid-composition, and come back.

**Pass:** candidates appear over the page and commit correctly; switching tabs does not strand a
composition or type into the wrong page.

## MT-02-021 — A task that ends while you are elsewhere still releases its tabs

Start a task that opens the browser in conversation A. While it is still running, switch to
conversation B and stay there until A finishes.

**Pass:** without going back to A, its read-only tabs close and its kept ones lose their owner —
check by returning to A afterwards. The backend choice for A is selectable again, and "clear browser
data" is no longer held shut. This is the case that used to hold everything open indefinitely.

## MT-02-022 — A local development server opens over http

With something serving plain http on `localhost:3000`, type `localhost:3000` into the address bar.

**Pass:** it loads. An https guess does not redirect here — an http-only server cannot answer a TLS
handshake at all — so this is a connection failure if the scheme is wrong.

## MT-02-023 — A task that ends while the window is reloading still releases its tabs

The reload is the point: the shell's answer to "which turn is running" must not live in the renderer
at all. Start a task that opens the browser in conversation A, and while it is still running reload
the window (Cmd/Ctrl+R with focus in the app, or the menu). Stay in a different conversation until
the task finishes.

**Pass:** A's read-only tabs still close and its kept ones still lose their owner, without visiting
A. Repeat with the network to the server briefly interrupted (stop the server for a few seconds and
start it again while the task is running): the release still happens once it is reachable, because a
failed poll changes nothing rather than releasing anything.

## MT-02-024 — Attaching to a server this shell did not start still gives tabs to a running turn

Start the server on its own, then launch the desktop app so it attaches to that server rather than
spawning one. Sign in, start a task that opens the browser.

**Pass:** the tab opens, and the end-of-task rules run when the turn finishes — the shell asks the
server over the window's own signed-in session, so attach mode is not a second code path. Before
signing in, an agent's `tabs.open()` is refused with `IAB_TASK_NOT_LIVE` rather than allowed: there
is no fallback that grants a turn authority without the server.

## MT-02-025 — Switching conversations never shows the previous one's page, even for a frame

With a page open in conversation A, switch to conversation B repeatedly and quickly, watching the
right-hand column. Do it on a slow machine if you have one, and try it while a page is loading.

**Pass:** at no point does A's page appear over B's chat — not even for a single frame — and B's
strip stays empty until it is B's own. The hide is a synchronous call into the main process for
exactly this reason, so what this checks is that the guarantee holds in a real window under real
scheduling.

## MT-02-026 — A download in an attached shell still lands in the conversation's scratchpad

MT-02-019 with the other way up. Start the server on its own, launch the app so it attaches to that
server rather than spawning one (MT-02-024's setup), then download a file from a page in the pane.

**Pass:** the file appears in `<agent>/scratchpad/<sessionId>/downloads`, exactly as it does when the
shell started the server itself. A cancelled download here means the shell does not know its own
data root in this mode — which is what this case exists to catch.
