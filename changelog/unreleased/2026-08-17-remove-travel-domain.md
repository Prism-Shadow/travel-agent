# `@travel-agent/domain` is removed; `submitBooking` moves into `@travel-agent/transaction`

The package held three things, and they turned out to be two different kinds of thing.

**Deleted — `representatives.ts` and `alignment.ts` (436 lines, plus 397 of tests).** Choosing which
three of fifty results a person should see, and deciding whether two listings are the same hotel,
are *judgements*. A model makes them better than a hand-maintained rule table does, and the table
was the real cost: `representatives.ts` needed a per-vertical list of objectives (which axis, which
direction, which superlative, what counts as noise) written and maintained by hand for hotels, then
flights, then trains. Both modules had sat with **no caller at all** through six phases.

`alignment.ts` had already learned half of this lesson on its own. Its header records that an
earlier version hand-wrote a grammar of Chinese hotel names — noise-word lists, branch-suffix rules
— which held for one language and one category, broke on `Hilton` versus `Hilton Garden Inn`, and
would have broken on the next pair; the judgement was moved to an injected adjudicator. What
remained was scaffolding around a model call.

**Kept, and moved — `booking.ts`.** It is not a judgement. `submitBooking` is the five gates in
fixed order (capability → authority → drift → journal → submit) that stand between an agent and an
irreversible action, and two of them are things no model can do however capable it is:

- the **journal** answers "did a previous life of this process already submit this?", which needs
  durable state on disk, not intelligence — after a crash mid-payment the agent's context is empty;
- the **capability** compares the live page against a fingerprint of the summary the person actually
  approved, which the agent's own context has long since overwritten and which a hostile page can
  lie about.

More fundamentally: the agent is *inside the threat model*. Asking it whether it may spend the money
is not a check, because the answer and the behaviour being constrained come from the same place.

It now lives in `@travel-agent/transaction`, whose other four pieces exist for exactly the same
reason. The move is dependency-correct — transaction never depended on domain — and it removes a
package rather than adding one. Two call sites changed import path; nothing else.

## The rule this establishes

> **The model judges; code enforces. Write code only where the model is itself what is being
> guarded against.**

Applied to the three files, it sorts them cleanly, and it is the test to run before adding any
future "domain logic".

## What this reverses

`design/001-architecture.md` §未决问题-1 decided on 2026-08-12 that representative selection would be
**rule-derived, never model-generated**, on the grounds that a rationale is the basis of a purchase
decision and must therefore be true — a plausible false rationale being worse than none, because it
is exactly the one a person trusts and stops checking.

That concern is still right, and it is not abandoned. What changed is the cheaper way to satisfy it:
let the model select and phrase, then verify its claim against the data before it reaches the card.
The truth requirement survives; the hand-maintained objective table does not. The strict corollary —
**an option whose reason cannot be established does not go on the card** — is retained as a product
rule and belongs in the skill, not in a package with no callers.

The design and verification documents are left as written. They are dated records of what was
decided and what was checked at the time, and this entry is the trace of the reversal.
