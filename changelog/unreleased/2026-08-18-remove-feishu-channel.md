# The Feishu escalation channel is removed; the escalation core stays

`transaction/src/channel/` held the one concrete `EscalationChannel` implementation — a
Feishu interactive card (`card.ts` render + `feishu.ts` webhook transport, 252 lines plus a
198-line test). It had **no caller since it landed with M2** (2026-08-12), and its own header
admitted it was never verified against a live tenant.

Removed by the same criterion that removed `@travel-agent/domain`: code with no caller
through every phase since it landed is a bet, not an asset. This bet's scenario had also
been engineered away twice over — 001 §2.2 reordered the task timeline so the
absent-user-must-tap-in-60s situation does not arise (the away phase is read-only; the
present phase has the user at the desktop app), and 003's Agent-first direction made
in-conversation cards the primary interaction. Even the "generic" render half was
Feishu-shaped (its envelope is Feishu's schema), so its salvage value for a future,
vendor-undecided channel was near zero; the durable insight — why a card (options ×
attributes, one tap = choose + authorize + prove presence, the size limit constraining the
upstream option count) — lives in design/001 and git history.

What stays is what the product actually uses: `escalation.ts`'s typed core and the
`EscalationChannel` interface, which the server's interaction layer imports
(`transaction-imports.ts`). If an absent-user channel is ever needed, a ~100-line transport
gets written against whichever vendor is actually chosen.
