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

- **The Trip.** A row in the server's index that *owns* a directory rather than being one, so a
  conversation's membership is a nullable `sessions.trip_id` and attach / move / detach never touch
  a Session's `workspace`. The reasoning, the four engine invariants that forced it, and the six
  rejected alternatives are in
  [the decision note](../../docs/decisions/implemented/2026-08-26-trip-as-server-entity-owning-a-directory.md);
  they are not restated here.
- **The split of ownership inside a trip directory.** The server writes what it renders — the row
  and its `trip.json` mirror; the model owns `itinerary.md` and everything else the work produces.
  The server never edits the model's documents. It deletes a trip directory only when nothing but
  its own `trip.json` is in it.
- **The interaction-card contract** (`src/interaction/`, DTOs in `src/api/types.ts`): the cards the
  agent raises, including the purchase summary a person reviews. A confirmed card acknowledges the
  summary; it grants no authority to spend.
- **The index.** SQLite holds indexes and aggregates only. Agent State, Traces and Workspaces stay
  as files under the data root, shared with the engine.

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
