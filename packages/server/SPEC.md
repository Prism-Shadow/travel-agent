---
id: module-server
type: module-design
status: active
title: server — the engine's web runtime, and the home of travel-agent's product concepts
parent: arch-travel-agent
tags:
  - server
  - pinned-baseline
---

# server — the engine's web runtime, and the home of travel-agent's product concepts

## Responsibility

Two things live here, and keeping them distinguishable is this module's main discipline.

1. **The engine's web runtime**, inherited from the PenguinHarness 0.2.2 snapshot: HTTP + SSE,
   multi-user auth, Project authorization, the session manager, the scheduler, usage accounting.
   This half is a pinned baseline (Hard Rule 3) — changes to it are deliberate decisions, not side
   effects.
2. **travel-agent's own product concepts**, which the root `AGENTS.md` places here by precedent:
   the **Trip** entity and the **interaction-card** contract. This is where the product's server
   state lives, because it is the product's server.

## What it owns

- **The built-in administrator is `traveler`.** Fresh web-mode data roots receive a random
  `travel-<4 digits>` initial password unless `PENGUIN_SEED_ADMIN_PASSWORD` supplies one.
  Opening an existing index applies `admin` -> `traveler` in one transaction to a privileged
  legacy account and its project ownership, memberships, preferences and schedule creators,
  preserving its password hash and initial-password flag. Existing login sessions for that
  account are invalidated. Project, Session and Trip ids and directories stay unchanged. An
  occupied `traveler` refuses startup and rolls back without merging accounts; unrelated users,
  including a non-privileged `admin`, are untouched. The retired name `admin` is reserved against
  new account creation and supplies no login alias. `previousUserId` retains the original login
  id (`admin`) so browsers that have not visited since the upgrade can recover their own cached
  drafts. Desktop token sign-in resolves the same `traveler` identity and uses an unprinted
  random seed password when no override is set. The inherited-baseline decision is recorded
  [here](../../docs/decisions/implemented/2026-09-05-traveler-administrator-identity.md).
- **The Trip.** A row in the server's index that *owns* a directory rather than being one, so a
  conversation's membership is a nullable `sessions.trip_id` and attach / move / detach never touch
  a Session's `workspace`. The reasoning, the four engine invariants that forced it, and the six
  rejected alternatives are in
  [the decision note](../../docs/decisions/implemented/2026-08-26-trip-as-server-entity-owning-a-directory.md);
  they are not restated here.
- **Trip directory allocation.** Readable basenames try the bare name and numeric suffixes
  through `-50`, then use an atomically created random suffix. Occupied names never impose a
  fixed creation ceiling or reuse another Trip's files; real filesystem failures propagate.
- **The split of ownership inside a trip directory.** The server writes what it renders — the row
  and its `trip.json` mirror, including user-maintained shared notes (up to 8,000 characters); the model owns `itinerary.md` and everything else the work produces.
  The server never edits the model's documents. It deletes a trip directory only when nothing but
  its own `trip.json` is in it.
- **The one field the model may write back.** The model may set `destination` in `trip.json` when
  it is empty. The server adopts it on the next read of that trip, and only into a blank: a value
  the person gave is never overwritten, and no other field is ever adopted. Enforced in
  `TripService.adoptAgentIdentity`, not in the skill, so a model that ignores its instructions
  still cannot overwrite anything
  ([decision](../../docs/decisions/implemented/2026-08-28-the-agent-may-fill-a-blank-destination.md)).
- **Destination suggestion gateway.** The authenticated `/api/locations/search` route normalizes
  up to five city/region results from a replaceable Photon endpoint backed by OpenStreetMap. It
  keeps only an in-memory request cache, persists no place catalog, and fails soft so a provider
  outage never turns the Trip's free-text destination into a required lookup. Photon accepts only
  `de`, `en` and `fr` as a result language; every other UI locale, zh included, is sent as
  `default`, which labels each place in its local script.
- **The interaction-card contract** (`src/interaction/`, DTOs in `src/api/types.ts`) — stated in
  full below, because nothing else in the repository states it.
- **The index.** SQLite holds indexes and aggregates only. Agent State, Traces and Workspaces stay
  as files under the data root, shared with the engine.

## The interaction contract

Six kinds, and the axis is not what the agent wants to know — it is **where the person has to act,
and whether the agent keeps working while they do**: `info_request`, `selection` and
`commitment_confirmation` are answered in the conversation and leave the agent working;
`secret_entry` is typed into the site's own field and pauses it; `human_challenge` and
`browser_takeover` hand the page over.

**A purchase summary is seven fields or it is not shown.** `PaymentSummary` carries the merchant
(name and domain), the item, the amount with its currency, the site's own cancellation terms, the
payment method, an expiry, and the task it belongs to. `model.ts` refuses to build the card when one
is missing, and says why in the refusal — a purchase shown without its cancellation terms is one the
person was not really shown. The domain is the eTLD+1 and is described in the code as "the field that
judges". A payment method appears only as an alias, a brand and four digits: never a number, never a
token.

**An answer is read against the card it answers.** The card goes out over SSE and the answer comes
back over the ordinary cookie surface, so nothing in the round trip forces them to agree;
`outcome.ts` makes them. A field the card never offered is refused. A `selection` must name an option
that is on the card. A `secret_entry` answer carries **nothing** back — not a value, not a note —
because an outcome is published over SSE and replayed from a ring buffer. A `commitment_confirmation`
is accepted with an explicit `approved: true`; missing or false is refused rather than read as a
"no", because a refusal has its own status. The checks run before the resolution is published, so an
invalid answer leaves the card pending and answerable rather than consuming it.

**What a confirmed purchase card means, and what it does not.** It records that the person is ready
to complete payment on the merchant page. It grants no authority to spend, and there is nothing for
it to authorize: the agent-payment execution chain was retired with `@travel-agent/transaction`
([decision note](../../docs/decisions/implemented/2026-08-20-retire-transaction-package.md)), and
[[module-browser-cli]] refuses the click unconditionally.

Because the agent cannot pay, **there is no consent-scope machinery, and its absence is deliberate**
— no amount ceiling or price-tolerance field, no click-time re-check of price, terms or domain, no
parsing of consent given in prose. Earlier development notes describe all three as shipped; they were
removed with the execution chain they served. A design that needs them is proposing to let the agent
pay, which is [[goal-travel-agent]] requirement 1.

## Boundary

| May depend on | Must never depend on |
| --- | --- |
| `@prismshadow/penguin-core`, `@prismshadow/penguin-skills` | `penguin-browser` ([[module-browser-cli]]) |

**Hard Rule 5 holds here mechanically, and a reader will find something that looks like a
violation.** Neither this package nor `core` has any dependency on `penguin-browser`. But
`core/src/state/default-config.ts` — the engine's default system prompt — names the
`penguin-browser` Skill and both browser backends in prose, so grepping the engine for
`penguin-browser` returns hits. A prompt string is not a dependency edge: the join is still made
only by [[module-desktop]] (which wires the relay) and the skill library (which teaches the agent
the CLI).

## Internal shape worth knowing

The dependency direction is `db/repos` → `services` → `http/routes`, and it is one-way: a repo runs
SQL and nothing else, a service owns a contract and may touch the filesystem, a route validates and
delegates. `TripsRepo.deleteById` therefore makes no decision about the directory on disk —
`TripService` does.

`createApp(deps)` is pure assembly and binds no port, which is why tests drive the whole API through
`app.request()` with a temp root and an in-memory database.

## Changing this package

It is a pinned snapshot, so the bar is explicit: an **additive** change confined to travel-agent's
own concepts — a new table, a nullable column, new routes — is the established pattern (that is what
the Trip was). A change to inherited engine behaviour is a decision that gets written down first.
