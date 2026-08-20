# Bug: extension backend opens a blocked/blank window when searching Ctrip

- **Status:** open, needs reproduction detail — re-verified 2026-08-20: every mechanism named below
  is still present in the code; what is missing is the on-screen evidence, which only a run on the
  reporter's Chrome can produce
- **Area:** `packages/browser-extension` (Chrome extension backend) — pre-existing, not the Phase 3 payment gate
- **Reported:** 2026-08-16

## Summary

Using the browser through the **penguin-browser Chrome extension** backend, when the agent opens a
window/tab to start a task (e.g. "open Ctrip and search hotel prices for a check-in in Beijing
today"), the user is shown what appears to be a **blocked / blank window** instead of the expected
page.

## Steps to reproduce

1. Use the Chrome extension (penguin-browser) backend.
2. Ask the agent to open Ctrip and search hotel prices (check-in Beijing, today).
3. Observe the window that opens.

**Expected:** a normal Ctrip page (or hotel search/list) the agent can drive.
**Actual:** a "blocked"-looking / blank window.

## Investigation so far (ruled out)

- **Handover gate** (`packages/browser-cli/src/executor/handover-state.ts`): a fresh session defaults to
  `agent_control`, which permits read+write — does not block opening a tab.
- **Payment-click gate** (`packages/browser-cli/src/executor/payment-gate.ts`): only affects
  *clicks* whose label matches pay-patterns, not `goto`/opening a page. Not the cause.
- **Extension URL restriction** (`packages/browser-extension/src/background.ts` `isRestrictedUrl`,
  ~L2050): only blocks `chrome://`, `devtools://`, the Chrome Web Store, and other extensions'
  pages. `ctrip.com` is not restricted.
- **Toolbar overlay** (`packages/browser-extension/src/toolbar/toolbar.ts`): injected highlight is
  `pointer-events:none`, cannot block interaction.

## Leading candidates (to confirm)

1. **Blank automation tab** — `Target.createTarget` (`background.ts`, the `about:blank` creations
   at ~L490 and ~L1256) opens `about:blank`
   first, then Playwright navigates. If the debugger attach or the navigation fails, the tab stays
   on `about:blank` (blank/blocked appearance).
2. **Popup relocation** (`background.ts` ~L2490 `chrome.windows.onCreated`, plus the
   `webNavigation.onCreatedNavigationTarget` path at ~L2452 for popups that never fire it) — when a connected tab
   triggers a `window.open`/popup (Ctrip opens hotel/room detail popups), the extension relocates
   the popup window into the main window and re-attaches. Most likely pre-existing culprit for
   "opening a window while searching Ctrip".
3. **Chrome's own debugger banner** ("Penguin Browser started debugging this browser") — not a bug,
   but sometimes read as a block.
4. **Ctrip anti-automation block/captcha** — the site detects the CDP/debugger session and serves
   its own block page. Environmental — Ctrip anti-bot was flagged early as the top product risk.

## Information needed to pin it down

- The **exact URL in the address bar** of the blocked window (`about:blank`, `about:blank#blocked`,
  `chrome-error://…`, or a `ctrip.com/...` page?).
- The **on-page text** of the block screen (Chrome error page? Ctrip captcha? blank?).
- The **CLI/terminal output** from the `penguin-browser` run when it opens the window (any
  `Failed to create tab`, debugger attach error, or navigation error).

Routing:
- URL is `about:blank` / `about:blank#blocked` → candidates 1–2 (our bug, fixable here).
- URL is `chrome-error://` or a Ctrip captcha → candidate 4 (site/Chrome; different fix, e.g.
  backend switch / anti-bot handling).

## Environment

- Backend: Chrome extension (penguin-browser)
- Extension version: 0.0.107 (manifest)
- Site: ctrip.com (hotel search)
