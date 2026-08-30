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

Its job is to make a traveller's journey the thing on screen. The engine's developer surfaces
are removed: the Agents page (system prompt, tools, MCP, skills, memory, vault, schedules), the
developer console (Usage, Traces, Benchmark), the skills picker, and the per-project settings
dialog. Model configuration stays, as the **Models** page (`/models`, linked at the sidebar's
top beside New trip and New chat): model entries and API keys, pricing, and the default model.
On first visit without a configured key, the chat page shows a one-time credential guide that
leads there. Interface preferences (language, theme, font, display currency) live in the
sidebar's account menu; new-chat engine defaults (agent, approval mode, thinking level,
workspace) still resolve from the Project's server-side defaults but are not editable on this
surface.

## What it owns

- **The Trip's presentation.** The sidebar is a list of trips with loose conversations kept in a
  place of their own; the trip page shows identity, the journey's conversations, and the itinerary.
  A conversation belonging to no trip is an ordinary state and must never be forced into one.
- **The draft screen's discovery rail**, in two mutually exclusive states. First run shows the
  editorial "Get inspired" prompts; from the first real trip or conversation the rail belongs to
  the person's own work — an "Up next" trip card (soonest future departure, else latest touched;
  countdown, aggregated waiting-on-you badge, the trip's meta line) over the "Jump back in"
  conversation tiles, waiting-on-you first. Every element is rendered from trip and session index
  fields; the rail makes no model call, because the root spec declines a proactive AI opener.
- **The composer's constraint chips**, which edit the owning Trip's identity when the conversation
  has one, and which materialize a trip on the first message rather than on the click that opened
  the draft. Where remains a free-text field; its debounced destination suggestions come from the
  server's replaceable geocoder gateway and a gateway failure never disables Done. Opening Who
  commits its visible one-adult default so the dialog summary and the closed chip cannot disagree.
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
  and `isPartialPayload`. Only the server import is type-only.
- The web app never talks to the browser relay, the vault, or Electron directly. Anything needing
  the shell goes through [[module-desktop]]'s preload surface.

## The rule that keeps the browser pane honest

The backend a conversation uses is the conversation's property, not the screen's — the contract is
[[goal-travel-agent]] requirement 5. What this package owes it: render the state as reported,
including "unavailable", and never present the other backend as a substitute.
