---
name: penguin-browser
description: Control explicitly authorized tabs in the user's local Chrome through the Penguin Browser CLI, a local CDP relay, and persistent Playwright sessions. Use for interactive or authenticated browser tasks that require the rendered DOM, ARIA semantics, navigation, dialogs, downloads, or visual fallback.
short_description: Automate authorized Chrome tabs through the local CLI.
short_description_zh: 通过本地 CLI 自动化已授权的 Chrome 标签页。
version: 5
updated: 2026-08-15T00:00:00Z
---

# Penguin Browser

Penguin Browser drives explicitly authorized tabs in the user's existing Chrome. The extension attaches to a tab with `chrome.debugger`, a local relay listens on port `19989`, and the CLI evaluates Playwright JavaScript in a persistent session.

Use Penguin Browser only through normal command execution. PenguinHarness does not gain special `penguin-browser` tools from this skill. Do not invent tool names such as `penguin_browser_execute` or treat MCP's `execute` operation as a native PenguinHarness function.

## Before you start

Penguin Browser lives **in this travel-agent checkout**, not in a separate `penguin-browser` repository. Do not look for `PENGUIN_BROWSER_REPO`, do not `npm install` a public penguin-browser package, and do not fall back to the official Playwright CLI.

### 1. Resolve the local CLI

Prefer `penguin-browser` on `PATH` (`pnpm build` at the repo root links it). If it is missing, use the built CLI in this repo:

```bash
command -v penguin-browser
# fallback, from the travel-agent repo root:
node packages/browser-cli/dist/cli.js session list
```

If neither the command nor `packages/browser-cli/dist/cli.js` exists, stop and tell the user to run `pnpm build` in the travel-agent checkout (or put `penguin-browser` on `PATH`). Do not invent another checkout path.

In every example below, `penguin-browser` means that resolved command.

### 2. Check prerequisites and status

```bash
command -v penguin-browser || test -f packages/browser-cli/dist/cli.js
test -f packages/browser-extension/dist/manifest.json && echo "extension build present" || echo "extension build missing"
lsof -nP -iTCP:19989 -sTCP:LISTEN 2>/dev/null || true
penguin-browser session list
```

`session list` reports `CONNECTED`, `DISCONNECTED`, or `N/A` (direct/headless). A disconnected
extension session stays visible so its state is not silently discarded, and it recovers automatically
if the same installation reconnects after a brief worker or network interruption. If that installation
will not return, delete the session and create a new one after authorizing a tab in the current
extension. Removing and loading an unpacked extension again creates a new installation identity;
ordinary `session reset` deliberately does not migrate a session across identities. Browser names,
account emails, and profile labels are display metadata, never safe session-rebinding identities.

If nothing is listening on `19989`, start the relay and leave it running:

```bash
penguin-browser serve
```

A listener on `19989` is not enough: that port must belong to this relay, the Chrome extension must be connected, and at least one tab must be authorized. The unpacked extension is `packages/browser-extension/dist` (not `extension/dist`). If the port belongs to an unrelated process, report the conflict; do not kill it without permission.

For logged-in sites (booking, mail, anything with a session cookie) use **extension mode only**. Do not pass `--browser headless` or `--direct` as a shortcut around the extension.

### 3. Require explicit tab authorization

Before controlling an existing tab, tell the user which tab or site is needed and ask them to click the Penguin Browser extension icon on that tab. Continue only after the user confirms or the CLI shows that the tab is available.

Authorization rules:

- Treat extension attachment as consent for that tab only.
- Do not enable another tab, direct CDP, remote debugging, or broad browser flags as a shortcut around consent.
- Never use profile-wide cookie/cache clearing commands.
- Do not automate passwords, payments, permission prompts, or CAPTCHAs without the user's direct participation.
- If several authorized tabs match, inspect their URLs and ask which one to use before a destructive or externally visible action.

## Choosing a backend

Two backends exist, and the choice is made once when the session is created.

**In-app browser (`--iab`).** The Travel Agent desktop app renders a real browser in the right half
of its own window: the user watches the work happen and can click the page themselves. Prefer it
whenever it is available, because a task the user cannot see is worse than one they can.

It is available only inside the desktop app, and only when the pane is enabled. Check before
choosing, and fall back rather than failing:

```bash
penguin-browser session new --iab || penguin-browser session new
```

The in-app browser has **its own profile**, separate from the user's Chrome. It keeps whatever it
is signed into across restarts, but it does not inherit an existing Chrome login — the first visit
to a site the user is signed into elsewhere will be signed out. When a task needs a login the user
already has in their own Chrome, use extension mode instead and say why.

**Extension mode (default).** Drives an explicitly authorized tab in the user's real Chrome, with
their real logins. Requires the steps in the previous sections.

## Persistent session workflow

Create one CLI session per task and preserve its ID for every call:

```bash
penguin-browser session new --iab || penguin-browser session new
# Keep the returned ID, for example: 1
export PENGUIN_BROWSER_SESSION=1
```

Always pass `-s "$PENGUIN_BROWSER_SESSION"`. The `state` object persists between calls in that session; tabs in `context.pages()` are shared browser resources. Store the selected page in `state.page` and use it consistently:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'console.log(context.pages().map((p, i) => ({ i, url: p.url() })))'
```

**Tabs are shared between sessions; `state` is not.** Every session drives the same browser, so
`context.pages()` lists tabs other agents may be working in right now. Go through `tabs` instead —
it knows who holds what:

```bash
# A tab of your own. Use this instead of adopting an idle page.
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'state.page = await tabs.open("https://example.com"); console.log({ url: state.page.url(), title: await state.page.title() })'
```

`tabs.open()` claims the tab before handing it back, which is what removes the race: a tab you
just opened cannot have been adopted in between. It also reuses an unclaimed `about:blank` tab
when one is already there — `session new` and a later execute after the last authorized tab
closes both auto-create one, and opening a URL on top of that leftover would otherwise leave
an empty tab in the penguin-browser group. The older idiom —
`context.pages().find((p) => p.url() === "about:blank") ?? (await context.newPage())` — is a race
whenever a second session runs it, and two agents typing into one page is the *expected* outcome,
not a rare interleaving.

To work in an existing tab, take it from `tabs.available()` (free tabs plus your own) and claim it:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'const matches = (await tabs.available()).filter((p) => p.url().includes("example.com")); if (matches.length !== 1) throw new Error(`Expected one available example.com tab, found ${matches.length}`); const claim = await tabs.claim(matches[0]); if (!claim.ok) throw new Error("tab held by session " + claim.heldBy); state.page = matches[0]; console.log({ url: state.page.url(), title: await state.page.title() })'
```

The rest of the surface: `tabs.owned()` (yours), `tabs.ownerOf(page)`, `tabs.release(page)`,
`tabs.snapshot()` (every claim, for diagnostics). A claim never steals — a refusal names the
holder so you find out *before* typing into someone else's checkout page. Claims are dropped
automatically when the session is deleted, so a crashed run strands nothing.

Release a tab you no longer need. Do not call `browser.close()` or `context.close()`. Do not call
`bringToFront()` unless the user explicitly requests a visible focus change.

## Execute Playwright code

Use short, observable JavaScript snippets:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e '<Playwright JavaScript>'
```

Use single quotes around one-line JavaScript in POSIX shells and double quotes inside the JavaScript. For longer work, write a temporary `.js` file and execute it with `-f`; do not compress a complex workflow into one opaque command.

Variables expected in scope:

- `context` — the connected Playwright browser context.
- `page` — a default page; prefer `state.page` after explicit selection.
- `state` — session-persistent values, pages, and listener references.
- `require` and Node.js globals — available in the executor sandbox, subject to its filesystem restrictions.

Use an observe → act → verify loop. Each mutating action should be followed by a separate command that prints the URL and relevant page state.

## DOM and ARIA first

Inspect semantic page state before taking a screenshot. Prefer the built-in accessibility snapshot helper when available:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'console.log("URL:", state.page.url()); console.log(await snapshot({ page: state.page, showDiffSinceLastCall: false }))'
```

Choose locators in this order:

1. `getByRole()` with an accessible name.
2. `getByLabel()`, `getByPlaceholder()`, or stable visible text.
3. A project-provided `data-testid` when source access makes it authoritative.
4. Semantic attributes such as `name`, `type`, or a stable URL.
5. CSS structure or coordinates only as a last resort.

Use locators from the current DOM/ARIA observation; do not reuse references from an old snapshot after navigation or a major rerender. Avoid `{ force: true }`, DOM `element.click()`, and synthetic events as ways to bypass a blocking overlay. Inspect and interact with the actual dialog, consent panel, or enabled control instead.

Example action and verification:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'await state.page.getByRole("button", { name: /submit/i }).click()'
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'console.log("URL:", state.page.url()); console.log(await snapshot({ page: state.page }))'
```

## Screenshot fallback

Use screenshots only when DOM/ARIA output cannot answer a spatial or visual question—for example canvas content, a map, a chart, drag geometry, clipping, or CSS layout.

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'await state.page.screenshot({ path: "/tmp/penguin-browser-view.png", scale: "css" }); console.log("/tmp/penguin-browser-view.png")'
```

Use an absolute path and `scale: "css"`. If the local executor provides `screenshotWithAccessibilityLabels`, it may be used to pair visual labels with semantic references:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'await screenshotWithAccessibilityLabels({ page: state.page })'
```

After visual inspection, return to a Playwright locator whenever possible. Use coordinates only for genuinely non-semantic surfaces, and verify the result with a fresh snapshot or screenshot.

## Navigation and new pages

Navigate with a bounded wait and print the resulting URL:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'await state.page.goto("https://example.com", { waitUntil: "domcontentloaded" }); console.log(state.page.url())'
```

For an action that may navigate, begin waiting before clicking:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'await Promise.all([state.page.waitForURL(/\/next(?:[/?#]|$)/), state.page.getByRole("link", { name: /next/i }).click()]); console.log(state.page.url())'
```

For popups or OAuth tabs, wait for the new page and store it:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'const [popup] = await Promise.all([context.waitForEvent("page"), state.page.getByRole("button", { name: /sign in/i }).click()]); await popup.waitForLoadState("domcontentloaded"); state.popup = popup; console.log(popup.url())'
```

If the relay presents an opened popup as another regular page rather than satisfying `waitForEvent("page")`, compare `context.pages()` before and after the action, then select the newly added page. Never assume the last page is correct without checking its URL.

## Dialogs

Register the dialog handler before the action that opens it. Accept, dismiss, or provide prompt text only when the user's requested outcome makes that choice clear:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'state.dialogHandler = async (dialog) => { console.log({ type: dialog.type(), message: dialog.message() }); await dialog.dismiss() }; state.page.once("dialog", state.dialogHandler); await state.page.getByRole("button", { name: /delete/i }).click()'
```

For an irreversible confirmation, stop after printing the message and ask the user before rerunning with an accepting handler. Do not confuse JavaScript dialogs with browser or OS permission prompts; leave native permission UI to the user.

## Handing control to the human

Verification codes, slider captchas, SMS one-time passwords and payment confirmations are not
yours to solve. Hand the step to the person instead, and wait:

```bash
penguin-browser request-help -s "$PENGUIN_BROWSER_SESSION" \
  --prompt "请在页面上输入收到的短信验证码，完成后点「我处理好了」" \
  --target "#captcha-input" \
  --timeout 120000
```

This draws a small non-modal card on the tab the human is already looking at, highlights
`--target` if given, and blocks until they answer. It prints one JSON line:

```json
{ "resolved": true, "message": "验证码输好了，顺便看看更早的班次", "reason": "done", "waitedMs": 18402 }
```

Read all three fields:

- **`resolved`** — `true` only when the human confirmed. `false` covers cancel, timeout, an
  aborted run and a closed tab; `reason` says which.
- **`message`** — free text the human left. Treat it as steering: fold it into the task you are
  already doing, do not start a new one. It routinely changes the plan ("code entered, and also
  check for an earlier flight"), so read it before continuing.
- **`reason`** — `done` · `cancelled` · `timeout` · `aborted` · `page_closed`.

A `timeout` is not a failure to retry blindly. The human walked away; the page state may have
moved on. Re-read the page before deciding whether to ask again, resume, or stop and report.

Inside a longer script, the same primitive is in scope as `requestHelp` — use it when the handoff
sits in the middle of a flow rather than between two CLI calls:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" --timeout 180000 -e 'const r = await requestHelp({ prompt: "请完成滑块验证", targetSelector: ".slider", timeoutMs: 120000 }); if (!r.resolved) throw new Error("handoff " + r.reason); console.log(r.message ?? "")'
```

Note the outer `--timeout`: it has to outlast the handoff, or the command dies while the human is
still typing.

Solving a captcha usually navigates. That is handled — the overlay is re-created on the new page
under the same request, and the wait continues. You do not need to re-issue `request-help` after
a navigation.

Ask for a handoff, never around it: do not type a password on the user's behalf, do not attempt a
captcha, and do not click a final payment button because a handoff timed out.

## Downloads

Start waiting for the download before triggering it, then save to an allowed absolute path:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'const [download] = await Promise.all([state.page.waitForEvent("download"), state.page.getByRole("link", { name: /download/i }).click()]); state.downloadPath = `/tmp/${download.suggestedFilename()}`; await download.saveAs(state.downloadPath); console.log(state.downloadPath)'
```

Afterward, use normal shell commands to inspect file existence, size, or type. Do not print downloaded secrets or binary data into the conversation. Ask before moving artifacts outside the working directory or temporary directory.

## Error recovery

Classify the failure before retrying:

1. **Selector, strictness, timeout, or overlay error:** take a fresh snapshot, confirm the URL, identify the real blocker, and retry with a semantic locator. Do not reset the session.
2. **Page closed:** list `context.pages()`. If the page was user-owned, ask the user to reopen and authorize it. If the agent-owned page was closed, create a replacement and update `state.page`.
3. **No authorized pages / extension disconnected:** ask the user to open Chrome and click the extension icon on the intended tab. Do not bypass authorization.
4. **Relay unavailable:** run `penguin-browser logfile`, inspect `~/.penguin-browser/relay-server.log`, and verify that `19989` belongs to the relay. Do not kill an unknown listener.
5. **Stale Playwright/CDP connection:** reset only after connection-level evidence:

```bash
penguin-browser session reset "$PENGUIN_BROWSER_SESSION"
```

A reset clears persistent executor state. Re-select the page and recreate only the state needed for the task.

If all pages repeatedly appear as unusable `about:blank` targets, report the known browser-side failure and ask the user to restart Chrome before retrying.

For transient page loading, prefer `waitForURL`, `waitForLoadState("domcontentloaded")`, `waitForSelector`, or an application-specific condition. Avoid long blind sleeps.

## Teardown

At the end of the task:

1. Remove listeners created by this session.
2. Close only pages the agent created, and only when closing them will not discard user work.
3. Delete the CLI session to release its persistent state.
4. Tell the user which files were downloaded or created.
5. Ask the user to click the extension icon again if they want the tab detached; do not broaden or revoke browser authorization through an unverified shortcut.

Example cleanup:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'if (state.page) state.page.removeAllListeners(); if (state.popup) state.popup.removeAllListeners(); if (state.ownsPage && state.page && !state.page.isClosed()) await state.page.close(); console.log("browser task cleanup complete")'
penguin-browser session delete "$PENGUIN_BROWSER_SESSION"
unset PENGUIN_BROWSER_SESSION
```

Never close the browser context or the user's Chrome. If cleanup fails because the connection is already gone, report what may remain rather than resetting solely to perform teardown.

## Completion checklist

- [ ] The intended tab was explicitly authorized.
- [ ] One session ID was used consistently.
- [ ] The selected page was stored in `state.page` and verified by URL.
- [ ] DOM/ARIA inspection preceded visual fallback.
- [ ] Every consequential action was verified.
- [ ] Dialogs, downloads, and new pages were handled with waits registered before triggers.
- [ ] No profile-wide destructive operation, secret disclosure, or invented PenguinHarness tool was used.
- [ ] Agent-created listeners/pages and the CLI session were cleaned up.
