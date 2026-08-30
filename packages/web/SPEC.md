---
id: module-web
type: module-design
status: active
title: web — travel-agent's consumer surface
parent: arch-travel-agent
depends-on:
  - module-server
tags:
  - web
  - ui
---

# web — travel-agent's consumer surface

## Responsibility

The single UI, rendered both by a browser during `pnpm dev` and by the Electron renderer in the
shipped app. There is no second front end: what the desktop shows *is* this SPA.

Its job is to make a traveller's journey the thing on screen. The engine's configuration surfaces
— Agents, Models — live behind a collapsed Settings fold in the sidebar, reachable but not
prominent: they name the wrong things for a person who has trips, not workspaces. The developer
console features (Usage, Traces, Benchmark) are removed; the runtime services that record usage
and traces during agent execution remain in the server.

## What it owns

- **The Trip's presentation.** The sidebar is a list of trips with loose conversations kept in a
  place of their own; the trip page shows identity, the journey's conversations, and the itinerary.
  A conversation belonging to no trip is an ordinary state and must never be forced into one.
- **The composer's constraint chips**, which edit the owning Trip's identity when the conversation
  has one, and which materialize a trip on the first message rather than on the click that opened
  the draft.
- **Rendering the model's documents without editing them.** `itinerary.md` and any map the agent
  drew are read-only here; relative image names resolve through the server's trip-file endpoint.
- **The OmniMessage stream → view-model reduction** (`src/lib/omni/`): start/delta/stop aggregation,
  complete-message replacement, origin-chain nesting into subagent cards. This is the most
  behaviour-dense logic in the package and is unit-tested on its own.

## Boundary

- **DTOs come from [[module-server]] type-only** (`@prismshadow/penguin-server/api`); no server code
  enters the bundle.
- **`@prismshadow/penguin-core` is a runtime dependency, not a type-only one.** Around twenty files
  import from it, and `src/lib/omni/stream-controller.ts` imports the value guards `isEventMessage`
  and `isPartialPayload`. The package README's blanket "type-only" claim is true of the server
  import and false of this one.
- The web app never talks to the browser relay, the vault, or Electron directly. Anything needing
  the shell goes through [[module-desktop]]'s preload surface.

## The rule that keeps the browser pane honest

The backend a conversation uses is the conversation's property, not the screen's — the contract is
[[goal-travel-agent]] requirement 5. What this package owes it: render the state as reported,
including "unavailable", and never present the other backend as a substitute.
