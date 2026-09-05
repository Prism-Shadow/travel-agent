# Agent Note: A stated budget carries its currency

Status: implemented — `budgetAmount` + `budgetCurrency` replaced the yuan-only amount; the account menu's currency became the home currency

## Problem

A trip budget was stored as a bare number whose unit lived in its name: `budgetAmountCny` in
the API, `budget_amount_cny` in SQLite, "in yuan" in the skill that tells the model how to use
it, and a `¥` glyph written into both language catalogs. At the same time the account menu
offered a setting called just "Currency", which converted the model-cost display between USD
and CNY and touched nothing else. A person who switched that setting to USD and then planned a
trip saw the budget stay in yuan and read it as a bug. It was not one: the two systems were
each correct and had never been connected, and the setting's name promised a scope it did not
have. Underneath, the product's own requirement was unmet — the agent reduces options against
a budget, and a number without a unit is not a budget it can compare to a price.

## Decision

A stated budget is a pair: `budgetAmount`, a whole number, and `budgetCurrency`, one of a
closed list (`TRIP_CURRENCIES` in `packages/server/src/api/types.ts`: CNY, USD, EUR, GBP, JPY,
HKD, SGD, AUD, KRW, THB). The server stores the pair or nothing — `TripService.settleBudget`
refuses an amount without a unit and clears the unit when the amount is cleared — and mirrors
both into `trip.json`, now `version: 2`. A database formed under the old shape gets the two
columns added on open and its `budget_amount_cny` rows carried over once as CNY; the retired
column stays in place, unread, because this repository's migrations are additive.

The Language & region setting is the **home currency**: the one the person thinks in. It defaults
the unit of a new budget and selects the model-cost display currency, and when unset it follows
the UI language (zh → CNY, otherwise USD). It stays in `localStorage` beside theme and font,
because the trip itself now carries its unit and there is no product state left to split.

Money renders through `Intl.NumberFormat` in the reader's language, with the locale's symbol:
a zh interface shows a CNY budget as ¥20,000 and a USD one as US$20,000; an en interface shows
$20,000 and CN¥20,000. A tier's glyphs (¥¥, $$) count in the budget's currency. The composed
budget line the model receives names the ISO code — ¥ alone does not settle yuan against yen —
and the `trip-workspace` skill tells the model to convert against the prices it sees with a
rate it states, never to present a converted figure as the site's own.

## Alternatives considered

- **Rename the setting to "model cost currency" and leave budgets in yuan.** Rejected: it makes
  the wrong model honest without making the budget able to say what it means. The product's
  market may price in yuan today; its requirement is a budget the agent can compare, anywhere.
- **Default a missing unit to CNY on the server.** Rejected: an implied unit is exactly the
  defect. A client that omits the currency is sending half a fact, and a 400 says so.
- **Any ISO 4217 code.** Rejected in favour of a closed list so the dialog's picker and the
  validator cannot disagree — enumerate, do not sample.
- **An exchange-rate table for the UI or the prompt.** Rejected: it is a rule table reproducing
  a judgement the model makes better with the page in front of it, and a stale rate presented
  as fact is worse than a stated estimate. The model-cost display keeps its fixed 7:1 note as
  before; it is a rough view of API spend, not money the person is deciding with.
- **Move the home currency to server `ui_prefs`.** Not done: theme, font and accent are
  `localStorage` preferences on this surface, and the budget carries its own unit, so a
  preference read on another device changes only a default, never a stored fact.

## Consequences

The Budget dialog gains a currency picker where the `¥` sign stood; the common case is still
"type a number". The chip, the trip's meta line and the composed prompt agree on one rendering,
and both language catalogs lost every hard-coded currency glyph. `trip.json` files written before
this change remain readable by the skill, which documents `version: 1`. Server tests pin the
pair invariant and the one-time carry-over; web tests pin the rendering per locale, the glyphs,
the composed line and the home-currency default; the constraint-chips e2e drives the picker.
