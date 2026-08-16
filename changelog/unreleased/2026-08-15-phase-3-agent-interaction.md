# Phase 3: the assistant stops asking you to drive

Phase 2 built a browser. Phase 3 answers the question that makes one worth having: **when the agent
needs you, what happens?** The old answer was "here, you take the wheel" — one primitive, an overlay
drawn on the page, used for everything from "how many passengers?" to confirming a payment. It works
for a captcha and it is wrong for everything else, and everything else is most of it.

So there are six kinds now, and the distinction is not what the agent wants to know. It is where you
have to act, and what happens to its hands while you do:

| | You act | The agent |
| --- | --- | --- |
| a question, a choice, a purchase to confirm | in the conversation | keeps working |
| a one-time code | in the site's own field | pauses |
| a captcha, a bank's own click | in the page | hands it over, briefly |
| anything else | in the page | hands it over — and has to say why |

Four of the six leave it working. That is the change; the rest is what makes it trustworthy.

## Payment stops, and not because we asked it nicely

Before any payment the agent shows a card with the whole purchase: the merchant **and its domain**,
what is being bought, the amount with its currency, the site's own cancellation terms, which payment
method (an alias, a brand, four digits — never a number, never a token), when the confirmation
expires, and which turn it belongs to. Miss one and the card is refused: a purchase shown without
its cancellation terms is one you were not really shown.

Then it stops. This build does not press "立即支付" — the browser layer refuses that click by name,
and the harness refuses the payment behind it. You finish the payment yourself, on the page the
agent left ready. That is the phase's terminal state rather than a limitation to be worked around,
and there are two independent mechanisms holding it because one would have been a promise.

Consent is exact. The amount on the card is a hard ceiling unless you tick the box that says how
much of a rise you would absorb — nothing infers slack from the conversation, and nothing carries it
over from last time. If the price, the dates, the terms or a fee move between the card and the
click, it goes back to you. If the *domain* changes, it is refused outright, with no "confirm the
new one?" — that dialog is the trap, not the fix.

And it is exact in the small way too: your answer is read against the card it answers. A purchase is
confirmed by pressing confirm and nothing else — there is no shape of answer that means "probably
yes" — slack you never chose cannot be recorded, an option that was not on the card cannot be
picked, and the card for a one-time code sends back the fact that you did it and nothing else. An
answer that does not fit is refused and the card stays where it is, so you can simply answer it
again.

And "yes" in a sentence is read by code, not by the model. "可以", "好", "就它吧", "付吧" all fall
back to the card. To confirm in words you have to name the amount and the merchant of the summary
you were shown; with nothing shown, the whole purchase. It errs towards asking again, because the
other error spends your money on something you did not read.

## What was closed while we were in there

The executor let a snippet call `await import('child_process')`, which walked straight past the
module allowlist that `require` enforces. And `process` was passed through with three methods
intercepted, so `process.env` handed the whole environment — including the credential this turn
mints for the agent — to code assembled out of a web page. Both are fixed. Neither makes that
sandbox a security boundary; Node's own documentation says it is not one, and the agent has a shell
elsewhere. What they buy is that the sanctioned path is no longer the hole.

Writes are now gated on who holds the page, across the whole enumerated surface rather than a
sample: the page, the locators it produces, the four interaction helpers, and opening a tab. During
a handover your writes are refused with a code the agent can read; during a secret step even reads
are, because reading is the risk.

Each conversation also gets a write-ahead journal and a task checkpoint in its own scratchpad. A
payment that was authorised and never reported back is never retried — the next attempt says "check
the order with the merchant" — and a card nobody answered leaves the task resumable from "we were at
the payment page" instead of re-running the search.

Off, and not turnable on here: filling a real one-time code, and pressing pay. Both need a vault and
an isolated agent runtime, which are Phase 4 and 5, and there are tests pinning them shut.

Full record: `docs/verification/phase-03.md`. The human half is
`docs/manual-testing/phase-03-agent-interaction.md`, entirely PENDING.
