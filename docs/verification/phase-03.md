# Phase 3 verification — the agent asks, and payment stops

What was built, what was verified, and what was deliberately not done. Companion to
`docs/manual-testing/phase-03-agent-interaction.md`, which is the human half and is entirely
`PENDING`.

Nothing in this phase turns a capability on. `secret_entry.live` and `payments.agent_click_pay` are
off, and — this is the part worth checking rather than assuming — they **cannot be turned on in this
phase at all**: their dependency chains run through a vault and an isolated agent runtime, neither
of which exists yet (design/004 §5). There are tests pinning both.

---

## 1. The question this phase answers: who does what, and where

Design/003 §0.2 supersedes a default. Before it, "the agent needs something" meant "hand the user
the browser": `requestHelp` drew an overlay on the page and the person did the next step there. That
is the right answer for a slider captcha and the wrong one for everything else, and everything else
is most of it.

The replacement is six kinds, and the distinction that matters is not what the agent wants to know
— it is **where the person has to act, and what happens to the agent's control of the browser while
they do**:

| kind | Person acts | Agent's browser control |
| --- | --- | --- |
| `info_request` | a card in the conversation | unchanged |
| `selection` | a card | unchanged |
| `commitment_confirmation` | a card | unchanged |
| `secret_entry` | the site's own field, or their bank's app | paused |
| `human_challenge` | the page | handed over, briefly |
| `browser_takeover` | the page | handed over — **last resort**, with a stated reason |

Four of the six leave the agent working. That is the whole product change.

`browser_takeover` refuses to be built without a non-empty `reason`, at three layers: the CLI, the
harness route, and the transaction layer's own builder. Not bureaucracy — an unexplained takeover
cannot be reviewed, and 003 §13-8 asks for the rate of them precisely because a high one means the
other five kinds are not covering enough.

## 2. Where a card comes from, and how the answer gets back

The agent runs as a subprocess. It has no cookie, no browser, and no way to reach the conversation —
so the card travels the same way task identity does (Phase 2), over one narrow surface:

```
agent command
  └─ POST /api/agent/interactions        Bearer: this turn's token
      └─ InteractionService.request()    builds, validates, publishes
          ├─ SSE  interaction_request  → the chat page draws a card
          └─ CheckpointStore.write()     the task's stage, for a lapse or a crash
                                     …
person answers in the chat
  └─ POST /api/sessions/:id/interactions/:id     cookie, ordinary project check
      └─ registry.resolve() → SSE interaction_resolved
          └─ the agent's long poll returns
```

Three properties, each of which had to be built rather than assumed:

- **The token is per turn.** Minted when a turn starts, revoked when it ends, checked against the
  session it names. A command that outlives its turn keeps a real session id and loses the ability
  to put words in front of a person — the same rule Phase 2 applied to browser tabs, for the same
  reason. It is stripped from any inherited environment, so an outer harness's token cannot stand in
  for this one.
- **The waiter is not the question.** The agent's connection can drop — a proxy timeout, a restarted
  CLI — while the card is still on screen and the person is mid-answer. Pending cards are not tied
  to their waiter, and a settled outcome is remembered, so a command that re-attaches learns what
  was said instead of asking again.
- **A card never outlives its turn.** When the run ends, every pending card is settled and published
  as resolved, and the turn's confirmation is forgotten. A card with nothing behind it would be
  answered into a void; consent that outlived its turn would be consent to something else.

The token is not a defence against the agent — 003 §0.3 is explicit that pre-isolation the agent
runtime and the app share a user, so anything that can read the agent's environment can read it. The
agent is the intended holder. What the token buys is that *other* local processes and anything that
reaches the port cannot raise a card in somebody's conversation, and that the ability ends with the
turn.

## 3. Payment: three things had to be true at once

**The card names the whole purchase.** All seven fields of 003 §8.1 or it is not built — merchant
(name *and* eTLD+1 domain), item, amount with an ISO 4217 currency, the site's own cancellation
terms, the payment method as alias/brand/last4, an expiry, and the turn. The domain is the judging
field: a display name is what a phishing page controls. The payment method never carries a token,
because a merchant token may itself be able to charge the card (003 §9.2), and the builder refuses
one. All seven are also *rendered*, which is a separate claim and a separately tested one: the
expiry as a wall clock in the reader's own timezone, and the task beside it, so a lapsed
confirmation looks lapsed and a consent can be read back to the turn it belonged to. The window
itself is the server's to set — the agent may ask for a shorter one, never a longer one, and a
malformed or already-past expiry is refused rather than shown.

**An answer is checked against the question.** The card goes out over SSE and the answer comes back
as a small JSON body; nothing in that round trip makes the two agree. Since the confirmation is
what becomes a `Commitment`, an unchecked body is consent assembled from whatever was posted. So
before the guard is told anything and before the resolution is published, the outcome must match
the pending kind: an option that is on the card, an approval that is explicit (a refusal has its own
status), slack that was offered and not exceeded, and — for `secret_entry` — nothing at all. A
mismatch is a 400 and the card stays pending.

**Consent has no slack unless somebody chose it.** The exact amount is the hard ceiling (003 §8.5).
A tolerance exists only when the card offered it in words and the person ticked it; nothing infers
one from the conversation, and nothing carries one over from a previous task. A price that moves by
one yuan goes back to them — deliberately.

**"Yes" in a sentence is judged by code, not by the model.** `judgeConfirmationReply` is a pure
function over the reply and the summary. "可以", "好", "就它吧", "付吧", "确认", "嗯", "OK" are a
list, not a sample: a reply that is only agreement falls back to the card. With a summary shown, the
reply must refer to it *and* name the amount and the merchant; with nothing shown, it must carry the
whole purchase — merchant, item, amount with currency, method, and an acknowledgement of the
cancellation terms. It errs towards the card, because a false negative costs one more card and a
false positive spends somebody's money on something they did not read.

### What actually happens at the payment page

The shipped answer is: **the agent stops**. Two independent mechanisms, either of which is enough:

- **The browser refuses the click.** A control whose words read as "this takes the money" —
  立即支付, 确认支付, 提交订单, Pay now, Place order, Checkout … — comes back as
  `IAB_PAYMENT_CLICK_BLOCKED`, with a message telling the agent to stop and let the person finish.
  It leans towards refusing: a wrongly refused click costs one card, a missed one costs money.
- **The harness refuses the payment.** `SessionPaymentGuard.authorize()` runs five checks in a fixed
  order — is there a confirmation for this turn, has it expired, is it the same merchant, does the
  plan still match (authority → drift → journal, via `travel-domain/booking.ts` unchanged), and only
  then, may this build press the button at all. The last answer is always no in this phase.

The ordering is deliberate: a drifted price is reported as `plan_drifted` even in a build that would
never have paid, because "payments are off" would hide something the person needs to know.

### The journal brackets the authorization, not the click

`submitBooking`'s `submit` callback resolves only when the agent reports back what happened. So the
write-ahead intent is fsynced **before** the go-ahead leaves the process, and the result is written
when the outcome is known. A crash in between leaves a dangling intent, and the next attempt at the
same purchase is refused with "check the order with the merchant; do not pay again" rather than
retried. That is the one behaviour that makes a double charge impossible, and it is tested by
killing the guard between the two halves (`payment-guard.test.ts`).

## 4. The control-handover machine

Design/002 §6.5 as revised by 003 §0.2, implemented as a pure reducer in
`transaction/src/handover.ts` and held per session in the relay (`browser-cli/src/handover-state.ts`).

```
agent_control ──request_handover──> handing_over ──drained──> user_control
      ▲                                                            │
      └────────── resumed ◀── resuming ◀── user_returned ──────────┘

agent_control ──enter_secret_phase──> secret_phase ──cleared──────> agent_control
                                            ├──unproven──────────> user_control (kept)
                                            └──target_destroyed──> agent_control
```

Three parts are load-bearing:

- **`handing_over` is not a formality.** At the moment the person takes the page, the executor may
  have an `await page.click()` in flight. In-flight writes are counted, and the handover waits for
  them (bounded at three seconds) before the person is told the page is theirs.
- **`secret_phase` refuses reads as well as writes.** During a handover, the agent watching the page
  is useful — it is how it knows they finished. During a secret phase, reading *is* the risk (003
  §1.3): the value is in the DOM and `page.evaluate` would return it.
- **An unproven exit does not give the page back.** 003 §7.3's exit (b): if the field cannot be
  shown to be clear, the page stays with the person, and a second secret phase on that page is
  refused rather than silently re-detaching.

**What Phase 3 delivers of the secret phase**: the contract and every transition, exercised with
synthetic values, plus the refusal path. What it does not deliver is the *detach* itself and any
real fill — `secret_entry.live` is off and unreachable (§6). With it off, a `secret_entry` never
enters the state at all: the card explains what is needed and the person types it into the site's
own field or their bank's app, which is the compliant shape rather than a degraded one.

## 5. The write gate

002 §6.5 asks for an enumeration rather than a sample, and the reason is exactly the failure mode a
partial gate has: the one method nobody wrapped is the one that gets used. So the gate wraps the
object the agent actually holds — the `Page`, the locators it produces, the handles it resolves —
and covers `click / dblclick / fill / type / press / goto / selectOption / check / uncheck /
setChecked / setInputFiles / tap / dragTo / clear / hover / focus / goBack / goForward / reload`,
plus the four helper primitives (`clickThrough`, `fillWithSuggestion`, `pickDate`,
`submitAndClassify`) and `tabs.open`, which reach the page by their own route.

**It is a guardrail, not a boundary**, and the docs say so where the code lives. The executor's vm is
explicitly not a security boundary (003 §1.2), `context` is deliberately left unwrapped, and an
agent that wants to route around a wrapper can. What the gate buys is that the ordinary path stops,
visibly, instead of a payment happening because the fifth method that can click something was never
wired up.

Two P0-B fixes from 003 §12 land here as well:

- **`import()` no longer bypasses the module allowlist.** `import: (s) => import(s)` made
  `ALLOWED_MODULES` decorative — `await import('child_process')` walked straight past it. It now
  throws with an explanation. This does not create a boundary; it stops the sanctioned path from
  being a hole.
- **`process` is an allowlist.** The old proxy intercepted three methods and passed everything else
  through, which meant `process.env` handed the whole environment — this turn's interaction token,
  the user's vault entries — to code assembled from a web page. It is now a small plain object (not
  a Proxy over the real one, which a prototype walk would defeat) with a boring environment subset
  and refusals that read as decisions.

## 6. What is off, and cannot be turned on here

| Flag | State in this phase | Why it cannot simply be enabled |
| --- | --- | --- |
| `secret_entry.contract` | off by default; the contract and cards work with synthetic values | nothing gated on it is dangerous, but nothing needs it on to ship either |
| `secret_entry.live` | **off, unreachable** | requires `vault.l2l3`, which requires a vault *and* a measured-isolated agent runtime (003 §0.3) |
| `payments.agent_click_pay` | **off, unreachable** | requires `payments.execute` → `vault.l2l3` → the same two runtime facts |

Both are pinned by tests in `core/test/feature-flags.test.ts`: asking for them directly still yields
`false`, and only the full Phase 4 chain plus both measured facts turns the last one on.

## 7. Journal and checkpoints, wired into the session

Each Session now has, in its own scratchpad, opened lazily so a conversation that books nothing
opens no files:

- `payments.jsonl` — the write-ahead journal, loaded before use (its replay guarantee depends on
  having read what is already on disk).
- `task-checkpoint.json` — where the task got to. A `selection` card writes `awaiting_choice`; a
  `commitment_confirmation` or a `secret_entry` writes `awaiting_confirmation` with the purchase it
  was showing. An `info_request` writes nothing: it does not move the task, and checkpointing it
  would overwrite a meaningful stage with a meaningless one.

That is what makes a lapsed card resumable: if nobody answers and the turn ends, the next turn reads
"we were at the payment page waiting" instead of re-running the search.

## 8. Test coverage

Run per package from the repository root:

```
pnpm --filter @prismshadow/penguin-core       exec vitest run
pnpm --filter @travel-agent/transaction       exec vitest run
pnpm --filter @travel-agent/domain            exec vitest run
pnpm --filter @prismshadow/penguin-server     exec vitest run
pnpm --filter @prismshadow/penguin-web        exec vitest run
pnpm --filter @prismshadow/penguin-desktop    exec vitest run
pnpm --filter @prismshadow/penguin-desktop    run test:e2e     # Electron + Xvfb
pnpm --filter penguin-browser                 run test         # serial; see the baseline note
pnpm -r exec tsc --noEmit -p tsconfig.json
pnpm -r run build
pnpm format:check
```

| Suite | Covers |
| --- | --- |
| `transaction/test/interaction.test.ts` | The six kinds; every card this layer refuses to build — a takeover with no reason, a purchase missing any of the seven fields, a payment method carrying a token, a selection with one option, a secret request carrying anything shaped like the answer, a live fill for a field that is never filled |
| `transaction/test/handover.test.ts` | Every transition and every illegal one; reads open during a handover and closed in a secret phase; the three secret exits, including the one that does not give the page back and the second phase it refuses |
| `transaction/test/payment.test.ts` | The digest's stability and sensitivity; no tolerance unless chosen; currency change as drift rather than a price move; an added fee; merchant drift as the one with no way back; the natural-language judge — ten vague phrases that fall back, a near-miss amount, a bare number with no currency, symbols and separators, and the five-part blind case |
| `server/test/payment-guard.test.ts` | The five refusals in order; nothing journalled when the build will not pay; the intent fsynced before the go-ahead; the bracket closed on report; replay returning the recorded outcome instead of paying again; **a killed process leaving a dangling intent and the next attempt refused** |
| `server/test/interaction-routes.test.ts` | The round trip end to end; a waiter that reconnects after its socket died; what a confirmed card records (and what a declined one does not); the four refusals the route enforces; a token from another conversation, a made-up token, a token whose turn ended; cards settled when the turn ends; **an answer that does not match its card refused with a 400 while the card stays pending** — an option nobody was shown, a payment with no explicit approval, a secret card carrying a value; a confirmation window clamped to ten minutes and a malformed or already-past one refused |
| `server/test/interaction-service.test.ts` | Which card writes a checkpoint and which deliberately does not; what each escalation kind becomes; cards settled and consent forgotten when the turn ends; **the kind-specific outcome checks** — an unknown option, slack that was never offered or exceeds what was, an approval read from a missing field, a secret answer carrying a value, a note or an approval; the expiry rules (default, shortened, clamped, malformed, past) |
| `browser-cli/src/write-gate.test.ts` | Every enumerated write refused while the person holds the page, through the page *and* through a locator; reads open then and closed in a secret phase; the drain; the payment vocabulary in both languages; the gate closed for every flag spelling that is not unambiguously yes; a submit helper blocked; per-session isolation |
| `browser-cli/src/sandboxed-process.test.ts` | `process.env` no longer handed over, the allowlist pinned, the refusals, and that it is not a proxy over the real process |
| `browser-cli/src/user-interaction.test.ts` | Where each kind goes; a decline read as an answer; a card refusal read as the caller's bug; **no fallback to drawing a payment card on the booking page** when there is no conversation; a takeover refused without a reason before anything is shown; the page given back whatever the outcome |
| `web/test/interaction-model.test.ts` | The seven fields on the card — **counted, not sampled** — with the domain beside the name; the expiry as a wall clock in the reader's own timezone, and a malformed one shown verbatim rather than as a blank; nothing that could charge a card; slack sent only when offered *and* ticked; decline distinct from an unapproved answer; every option's reason on its button; the secret card that does not promise to type anything |
| `core/test/feature-flags.test.ts` | `secret_entry.live` and `payments.agent_click_pay` off and unreachable in this phase |
| `core/test/task-identity.test.ts` | The host's per-turn environment reaching the command, outranking the vault, and absent (not inherited) between turns |

**Counts at this commit**, from the commands above:

| Gate | Result |
| --- | --- |
| core | 871 passed, 5 skipped (876) |
| transaction | 116 passed (116) |
| travel-domain | 44 passed (44) |
| server | 677 passed (677) |
| web | 756 passed (756) |
| desktop | 465 passed (465) |
| desktop e2e (Electron + Xvfb) | 19 assertions, all passed (exit 0) |
| browser-cli (`pnpm test`, serial) | 529 passed, 6 failed (the pinned-Chromium baseline), 1 skipped (536); exit 1 — see below |
| typecheck (`tsc --noEmit`, all packages) | clean, all packages |
| build (`pnpm -r run build`) | clean, all packages |
| `pnpm format:check` | clean |

**The `browser-cli` baseline.** That package's gate is its own script, `pnpm test`
(`vitest run --no-file-parallelism`), run alone: these suites launch Chromium and contend for CPU
and ports. It exits **1**, and the exit code is not the thing to read — the run is
`Test Files 2 failed | 42 passed (44)`, `Tests 6 failed | 529 passed | 1 skipped (536)` in 243.6s,
where the two failed *files* are simply the two that contain those six tests. **No suite- or
hook-level failure, no hook timeout, no unhandled error and no `EEXIST`** — every failure is a
named test, and every name is on the list below.

The six failures are the pinned-Chromium baseline recorded in `phase-00.md` §3 and carried through
`phase-01.md` and `phase-02.md`, name for name:

1. `Relay Core Tests > should ignore duplicate dialog dismissals from multiple CDP clients`
2. `Relay Core Tests > should preserve system color scheme instead of forcing light mode`
3. `Relay Core Tests > should show descriptive error when clicking a hidden element`
4. `Relay Core Tests > should show descriptive error when clicking an element covered by another`
5. `Relay Core Tests > should show descriptive error when clicking a display:none element`
6. `Snapshot & Screenshot Tests > should capture screenshot correctly`

The suite pins Chromium 1209 and nothing installs it; locally a cached 1228 is symlinked as 1209, an
environment-only workaround that is not committed. The single skip is
`relay-navigation.test.ts > should record screen with navigation using chrome.tabCapture`, an
`it.skip` that predates this phase. Phase 2 recorded 462 passed / 1 skipped / 6 failed; the passing
count is higher here because this phase added 67 tests to that package (44 + 12 + 11, in three new
files) — 462 + 67 = 529 — and the skip and failure sets are unchanged.

**A seventh failure appeared once and is recorded as flaky, not as baseline.** An earlier serial run
of this same gate also failed `Relay Navigation Tests > should resolve locators for cross-origin
iframe that starts with empty src` after 733ms. It did **not** recur in the run recorded above, and
run alone (`npx vitest run src/relay-navigation.test.ts --no-file-parallelism`) that suite passed
**three times out of three** — 12 passed, 1 skipped, exit 0. Nothing in this phase touches the relay,
the extension, or auto-attach: the test waits for a frame that is attached with an empty `src` and
then navigated cross-origin, which is a race against auto-attach timing on a loaded machine. It is
written down here rather than folded into the six because a baseline is a list of *reproducible*
failures, and one intermittent failure is a different claim. If it recurs outside a loaded serial
run it should be treated as a defect, not as noise.

**One regression was found by this gate and fixed.** Wrapping the `Page` in the write gate made it a
Proxy, and the executor notices a closed tab by comparing `state.page === page` — an identity check
that a Proxy fails. The first serial run caught it as
`extension-connection.test.ts > should warn and switch page when the active page closes`. The gate
now exposes the real object through a symbol, unwraps every argument it forwards, and the executor
unwraps at each point where a page or locator is handed back to Playwright or compared. That is also
why the gate cannot simply wrap everything: a Proxy where Playwright expects its own object is a bug
waiting for the one API that checks identity.

## 9. Explicit non-goals

Not omissions — each is assigned elsewhere, and none is a stub pretending to be a feature.

1. **The Vault, and any real L2/L3 value.** Phase 4. Nothing in this phase stores or fills personal
   data; the payment card carries an alias, a brand and four digits, which are not from a vault
   because there is not one.
2. **`secret_entry.live`, and the scoped secret phase's detach.** The contract, the state machine
   and the cards are here and tested with synthetic values; the CDP detach and the "prove the field
   is clear" exits are Phase 4, and the flag cannot be turned on before them.
3. **Payment capabilities, `commitmentDigest` as a one-shot authorization, and `execute_payment`.**
   The digest is computed and carried — it is knowable only at the moment the summary is finalized —
   but it is not yet an unforgeable capability, and the browser gate is a policy switch rather than a
   capability check. Phase 4 §8.2.
4. **Broker IPC.** The agent reaches the harness over loopback HTTP with a task-scoped token, not
   over an authenticated capability channel with peer-uid checks (003 §11). Stated plainly because
   the difference matters: this is enough to stop other local processes and anything on the network,
   and it is not a defence against the agent itself — which 003 §0.3 says nothing at this layer can
   be.
5. **A payment clause in core's goal prompt.** The rule lives in the `penguin-browser` skill, which
   is this product's agent-facing contract, rather than in the harness's product-neutral `[goal]`
   block. The enforcement that does not depend on a prompt at all is the write gate and the payment
   guard.
6. **Feishu.** The escalation channel is implemented in-app (SSE → card → resolve). The Feishu card
   channel still exists in the transaction package and is not wired to anything.

## 10. Findings fixed during the phase

Each was a defect in the working tree, not a hypothetical.

1. `import: (specifier) => import(specifier)` in the executor bypassed `ALLOWED_MODULES` entirely
   (003 §12 A8): `await import('child_process')` was an unguarded path to the shell.
2. The `process` proxy passed `process.env` through, handing every environment variable — including
   the credential the harness mints for the turn — to code assembled from a web page.
3. `requestHelp` was the only way to ask a person anything, which made handing over the browser the
   default path rather than the exception (003 §0.2).
4. The overlay's confirm button read "我处理好了" without saying what it did; a takeover arrived with
   no explanation at all, because nothing carried a reason.
5. Nothing gated writes on who held the page: an `await page.click()` dispatched before a handover
   would land in a form the person was filling in.
6. A full-width Chinese comma was treated as a thousands separator in the confirmation judge, so
   "MU5137，1280 元" parsed as one number and the amount the person named became invisible to the
   check (found by the test for the five-part blind case).
7. The interaction registry originally tied a pending card to the connection that raised it, so a
   dropped agent socket would have asked the person the same question twice.

**Found by a second review of the finished checkpoint, and fixed in it:**

8. **The payment card rendered five of the seven fields.** `paymentLines` showed the merchant, the
   item, the amount, the terms and the method, and the file's own comment said seven. The expiry and
   the task were in the object and never on screen — so a person could not see that a confirmation
   had lapsed, and a reader of the conversation could not tell which turn a consent belonged to.
   Both are now lines on the card, the expiry rendered as a wall clock in the reader's own timezone
   (a `Z` timestamp asks somebody deciding whether they still have time to do arithmetic), with a
   test that counts the lines rather than only sampling them.
9. **`expiresAt` was taken from the agent unchecked.** The comment claimed the product's ten minutes
   was a ceiling; nothing enforced it. An agent could put any string on the card — including one
   that does not parse (rendered as a blank line, which reads as "no expiry") or one a day out.
   `InteractionService.confirmationExpiry` now validates ISO-8601-with-a-zone, refuses an instant
   that has already passed, and clamps anything longer than the ceiling. Shortening is still
   allowed: a card raised against a fare hold that lapses in two minutes should say so.
10. **`InteractionService.resolve` accepted any well-formed outcome for any card.** The body arrives
    as JSON on the person's route, and nothing forced it to agree with the question it answered: an
    `optionId` that was not on the card, an approval on a selection, slack larger than the card
    offered, or an approval assembled with `approved` missing. Because `resolve` turns exactly those
    fields into a `Commitment` the payment guard later authorises against, this was consent built
    out of an unchecked body. `assertOutcomeMatches` now runs **before** the guard is told anything
    and before the resolution is published: the answer must match the pending kind, a purchase must
    be approved explicitly (a "no" has its own status), accepted slack must have been offered and
    must not exceed it, and a `secret_entry` answer carries nothing at all — not a value, not a
    note. An invalid answer is a 400 and the card stays pending, so the person can answer it again.
