---
name: penguin-browser
description: Control the browser backend selected for a Travel Agent conversation through the Penguin Browser CLI and persistent Playwright sessions. Desktop conversations default to the visible in-app browser; the user's own Chrome is an explicit alternative for reusing that profile or an existing authorized tab. Use for interactive or authenticated browser tasks that require rendered DOM, ARIA semantics, navigation, dialogs, downloads, or visual fallback.
short_description: Automate the conversation's selected browser backend.
short_description_zh: 通过本地 CLI 自动化对话中由用户选择的浏览器后端。
version: 9
updated: 2026-08-19T00:00:00Z
---

# Penguin Browser

Penguin Browser drives the backend selected for the current conversation. In the Travel Agent desktop app, the default is the visible in-app browser (IAB). The user may instead select **My own Chrome (extension)** in the Browser menu to reuse their Chrome profile. The local relay and CLI evaluate Playwright JavaScript in a persistent task session for either backend.

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

### 2. Follow the conversation's backend choice

Create a session in automatic mode. The Desktop records its per-conversation selection before the
task starts, so do not guess from the requested website and do not add `--iab`, `--backend`,
`--browser`, or `--direct` to override it:

```bash
penguin-browser session new
```

Resolution is deliberately asymmetric only when no Desktop preference exists:

- A Desktop conversation with no prior user change is explicitly recorded as **IAB**.
- A Desktop conversation where the user selected Chrome resolves to **extension**.
- A standalone CLI or plain-web run has no IAB host and no Desktop preference, so auto preserves
  its historical **extension** behaviour.

The choice is saved per conversation, applies to the next task, and is locked while a task runs.
A refusal is not permission to retry the other backend. Ask the user to change the Browser menu
between tasks if they want a different browser; never change or rewrite the preference yourself.

IAB has its own persistent profile and can sign into sites. It does not inherit Chrome cookies, but
it can keep sign-ins created in IAB across restarts and can receive data through **Import into
in-app browser**. Chrome is useful when the task specifically needs the user's existing Chrome
login, SSO, certificate, profile, or an already-open tab.

### 3. Check the selected backend's prerequisites

```bash
command -v penguin-browser || test -f packages/browser-cli/dist/cli.js
lsof -nP -iTCP:19989 -sTCP:LISTEN 2>/dev/null || true
penguin-browser session list
```

`session list` reports `CONNECTED`, `DISCONNECTED`, or `N/A` (direct/headless). A disconnected
extension session stays visible so its state is not silently discarded, and it recovers automatically
if the same installation reconnects after a brief worker or network interruption. Browser names,
account emails, and profile labels are display metadata, never safe session-rebinding identities.

For a standalone Chrome run, if nothing is listening on `19989`, start the relay and leave it
running. Do not start a second relay for IAB; the Desktop owns and authenticates that relay:

```bash
penguin-browser serve
```

For an IAB selection, the Desktop app must be running and showing the current conversation. Auto
mode can refuse with actionable errors:

- **`IAB_NOT_CONNECTED`** — the desktop app is not running, or its browser pane is off. Extension
  mode is not an automatic fallback. Ask the user to open Desktop or explicitly select Chrome
  between tasks.
- **`IAB_IDENTITY_REQUIRED`** — the command was not started by a task. It carries no conversation
  and no task, so its tabs would belong to nobody; there is no flag for this on purpose.
- **`IAB_SESSION_NOT_VISIBLE`** — the conversation you are working in is not the one on screen. Ask
  the user to open it rather than working in a browser they cannot see.

For a Chrome selection, `packages/browser-extension/dist/manifest.json` must exist and the extension
must connect to the same relay. The Desktop opens setup when the user selects Chrome and no extension
is connected. If setup is incomplete, stop with that actionable state; never silently move the task
into IAB. Removing and reloading an unpacked extension creates a new installation identity, so delete
an old disconnected session and create a new one after the current installation connects.

If several Chrome installations or profiles are connected, `session new` lists their browser keys.
Show the user the labels and ask which profile to use before retrying with `--browser <key>`; never
infer identity from an email or silently select the first profile.

### 4. Understand Chrome authorization

Two explicit user actions grant different scopes:

- Selecting **My own Chrome (extension)** in the Browser menu authorizes this conversation to use
  the Chrome backend. Once its extension is connected, the task may create and control its own new
  tabs. It does not adopt arbitrary tabs the user already has open.
- Clicking the Penguin Browser extension icon on an existing Chrome tab explicitly adds that tab to
  the available automation pool. Attachment is consent for that existing tab only.

Before controlling an existing tab, tell the user which tab or site is needed and ask them to click
the extension icon on that tab. Continue only after the user confirms or the CLI shows it as
available. Do not enable another tab, direct CDP, remote debugging, or broad browser flags as a
shortcut around consent. If several authorized tabs match, inspect their URLs and ask which one to
use before a destructive or externally visible action.

Never use profile-wide cookie/cache clearing commands. Do not automate passwords, payments,
permission prompts, or CAPTCHAs. Payments have their own protocol — a card, then a stop — see
"Payment: stop, ask, and do not press the button".

## Persistent session workflow

Create one CLI session per task in auto mode and preserve its ID for every call:

```bash
penguin-browser session new
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
just opened cannot have been adopted in between. In IAB, the first call navigates the exact
`about:blank` placeholder created for that session; in Chrome it may reuse an unclaimed blank left
by extension auto-enable. Opening a second page still creates a second tab. The older idiom —
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

## Asking the person for something

Six kinds, and the choice between them is not about politeness — it decides **whether you keep
working**. Four of them are cards in the conversation and leave you driving the browser; two hand
the page over and are the ones to avoid.

| kind | Use it for | While it is open |
| --- | --- | --- |
| `info_request` | a fact only they have: how many passengers, which airport | you keep working |
| `selection` | two to four real options, each with a reason to be on the list | you keep working |
| `commitment_confirmation` | **any payment or final order** — see below | you keep working |
| `secret_entry` | a CVV, an SMS code, a 3DS prompt | you pause; they type it into the site's own field |
| `human_challenge` | a slider, a captcha, a bank page that needs a real click | they hold the page briefly |
| `browser_takeover` | nothing the other five cover — **last resort**, needs a `--reason` | they hold the page |

```bash
penguin-browser interaction request --kind info_request --ask "这趟一共几位乘客？"

penguin-browser interaction request --kind selection --ask "选一个航班，我接着订" \
  --options-json '[{"id":"mu5137","label":"MU5137 14:20 ¥1280","rationale":"唯一直飞"},
                   {"id":"ca1234","label":"CA1234 09:05 ¥880","rationale":"便宜 400，中转 1 次"}]'

penguin-browser interaction request --kind human_challenge -s "$PENGUIN_BROWSER_SESSION" \
  --ask "请完成这个滑块验证，完成后点「我处理好了，交还」" --target ".slider" --timeout 120000
```

Each prints one JSON line:

```json
{ "resolved": true, "status": "answered", "value": "两位成人", "waitedMs": 18402 }
```

Read `status`, not just `resolved`:

- **`answered`** — they answered. `value` / `optionId` / `approved` carry what they said, and
  `message` is free text to fold into the task you are already doing (never a new one).
- **`declined`** — they said no. Do not do it, and do not ask the same thing again in another form.
- **`timeout`** — nobody answered. The page may have moved on: re-read it before deciding whether to
  ask again, resume, or stop and report.
- **`unavailable`** — this command is not running inside a Travel Agent turn, so there is no
  conversation to raise a card in. Ask in your reply instead; never draw a payment summary on the
  booking page.

`browser_takeover` is refused without `--reason`, and the reason is shown to the person. Needing one
often means an earlier step could have been a card: check before reaching for it.

**Never work around a card.** Do not type a password on somebody's behalf, do not attempt a captcha,
and do not click a final payment button because a question timed out.

## Payment: stop, ask, and do not press the button

**Before any payment or final order, raise a `commitment_confirmation` card and wait.** This is not
a style rule; the browser refuses the click, and the harness refuses the payment.

The card carries seven fields, all required. A card missing any of them is refused, because a
purchase shown without (say) its cancellation terms is one the person was not really shown:

```bash
penguin-browser interaction request --kind commitment_confirmation \
  --ask "确认这笔付款" \
  --payment-json '{
    "merchant": { "name": "携程", "domain": "ctrip.com" },
    "item": "MU5137 2026-09-02 经济舱 1 成人",
    "amount": { "value": 1280, "currency": "CNY" },
    "cancellation": { "summary": "起飞前 24 小时可退，收 200 元手续费", "url": "https://…" },
    "paymentMethod": { "alias": "常用信用卡", "brand": "Visa", "last4": "4242" }
  }'
```

`merchant.domain` is the eTLD+1 of the page you are actually on — it is the field the checks judge
by, and a display name is not a substitute. The payment method is an alias, a brand and four digits;
never a card number and never a token.

Then **stop at the payment page**. This build does not press the site's pay button: a click on one
comes back as

```
IAB_PAYMENT_CLICK_BLOCKED: "立即支付" looks like the control that takes the money…
```

That is the intended end of your turn. Tell the person the page is ready and that they can complete
the payment (or the wallet / OTP step) themselves, declare the task `committed` when you delete the
session so the tab is kept, and stop. Do not hunt for another element that does the same thing.

If a build does allow it (`payments.agent_click_pay`, off by default), ask first and report after:

```bash
penguin-browser payment authorize --action ctrip.payFlightOrder \
  --plan-json '{"merchantDomain":"ctrip.com","item":"MU5137 2026-09-02 经济舱 1 成人",
                "amount":1280,"currency":"CNY","cancellation":"起飞前 24 小时可退，收 200 元手续费"}'
# → {"status":"refused","reason":"agent_pay_disabled","detail":[…]}   ← the default
# → {"status":"authorized","authorization":{"authorizationId":"pay-…"}}
penguin-browser payment report --authorization pay-… --outcome-json '{"orderId":"E123456"}'
```

`plan-json` is what the page says **now**. Anything that moved since the card — the price, the
dates, the cancellation terms, a new fee, a different merchant domain — is refused, and a different
domain is refused outright with no way to re-confirm. Report the refusal to the person; do not
retry it, and never ask them to confirm a domain they did not choose.

If an authorised payment is interrupted before you report its outcome, the next attempt is refused
with `dangling_intent`: the payment may already have gone through. Check the order with the merchant
and tell the person what you find. Do not pay again.

## When the person is holding the page

While a `human_challenge` or `browser_takeover` is open, your writes are refused with
`IAB_USER_CONTROL` (reads still work — watching the page is how you know they finished), and during
a secret step everything is refused with `IAB_SECRET_PHASE`. These are states, not errors: wait for
the interaction to return rather than retrying in a loop.

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
3. **Extension disconnected:** ask the user to open Chrome or finish the setup opened from the
   Browser menu. If Chrome is connected and an agent-owned tab was closed, create a new task tab.
   Ask for an extension-icon click only when the task needs a specific existing user tab.
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
2. Delete the CLI session, **declaring how the task went** — see below.
3. Tell the user which files were downloaded or created.
4. If the task adopted an existing Chrome tab, ask the user to click the extension icon again if
   they want it detached; do not broaden or revoke browser authorization through an unverified
   shortcut.

**In-app browser: do not close the tabs yourself.** The desktop app owns their lifetime and applies
one rule per outcome, so closing them here would pre-empt a decision that is not yours — and would
destroy a payment page the user needs before anyone could keep it. Declare the outcome instead:

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'if (state.page) state.page.removeAllListeners(); if (state.popup) state.popup.removeAllListeners(); console.log("browser task cleanup complete")'
penguin-browser session delete "$PENGUIN_BROWSER_SESSION" --outcome read_only
unset PENGUIN_BROWSER_SESSION
```

Exactly one of:

| `--outcome` | Use it when | What happens to the tabs |
| --- | --- | --- |
| `read_only` | You only searched, compared or read. Nothing irreversible happened. | Closed |
| `committed` | An order exists, or you stopped on a payment page. | Kept, and handed to the user |
| `failed` | The task failed or was interrupted. | Kept — the scene is the evidence |
| omitted | You genuinely cannot say. | Kept |

The declaration is recorded, not acted on immediately: the rules run when the *turn* ends, and an
abort or an error after this point overrides a `read_only` you declared. A tab the user marked
"keep" is never closed regardless. Once the turn is over its tabs are the user's — a later write to
one is refused with `IAB_TAB_RELEASED`, and `tabs.claim()` is the way to take one back.

**Extension mode** is unchanged: close only pages the agent created, and only when closing them will
not discard user work.

```bash
penguin-browser -s "$PENGUIN_BROWSER_SESSION" -e 'if (state.ownsPage && state.page && !state.page.isClosed()) await state.page.close()'
penguin-browser session delete "$PENGUIN_BROWSER_SESSION"
```

Never close the browser context or the user's Chrome. If cleanup fails because the connection is already gone, report what may remain rather than resetting solely to perform teardown.

## Completion checklist

- [ ] The intended tab was explicitly authorized.
- [ ] One session ID was used consistently.
- [ ] The selected page was stored in `state.page` and verified by URL.
- [ ] DOM/ARIA inspection preceded visual fallback.
- [ ] Every consequential action was verified.
- [ ] Dialogs, downloads, and new pages were handled with waits registered before triggers.
- [ ] Any payment or final order was preceded by a `commitment_confirmation` card that the person answered.
- [ ] No payment button was pressed, and no workaround for one was attempted.
- [ ] No profile-wide destructive operation, secret disclosure, or invented PenguinHarness tool was used.
- [ ] Agent-created listeners/pages and the CLI session were cleaned up.
