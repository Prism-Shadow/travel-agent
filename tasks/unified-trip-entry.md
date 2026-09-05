# Unified Trip entry implementation

Status: implemented and verified in the working tree. Implements the approved conversation
prototype on the consumer surface.
Visual references: `artifacts/design-qa/d01-v2-start-desktop.png` and the existing chat welcome.

## Decision and scope

- One global New trip entry opens an independent conversation draft. Sending creates a Session,
  not a Trip. Existing engine choices, browser ownership, files and model controls remain usable.
- The person explicitly adds a conversation to a new or existing Trip. No keyword heuristic or
  model-proposed creation mechanism is introduced. Membership preserves history and workspace.
- Trip pages and conversation headers expose a new-topic action. A topic has its own history;
  identity, user-maintained notes and the model's itinerary are shared through the Trip.
- Shared notes require an additive Trip column, DTO field, validation and trip.json mirror in
  the server's product layer. This is a deliberate extension of the existing Trip entity, not
  an engine change. Core and browser gates are outside this change.
- Existing files stay in their original workspace when attached. No automatic artifact migration
  or synthesis of shared notes from arbitrary conversation prose is claimed.

## Implementation

- [x] Persist shared notes on fresh and upgraded databases; validate and mirror them.
- [x] Consolidate navigation and remove first-send Trip creation. Preserve parked drafts and
      their owning Trip across navigation/reload; reject unavailable Trip targets visibly.
- [x] Add explicit create/attach dialog with errors and retry behavior; show Trip context and
      edit/new-topic actions in conversations and on the Trip page.
- [x] Deliver current Trip identity, notes and folder on messages, queued follow-ups and topic
      starts; preserve membership across explicit agent/model forks.
- [x] Update specs and decision notes; record the selected D01 scope in the TODO.
- [x] Run typecheck, package suites, build, Web browser checks and visual QA using isolated data.

## Acceptance

First send leaves the Trip list empty. Promotion preserves Session id, history and workspace;
joining an existing Trip creates no new Trip. Separate topics inherit current identity/notes,
keep independent histories and survive reload. Global starts remain independent from an open
Trip. Drafts survive switching. Failed writes leave the current conversation usable and allow
retry without knowingly creating duplicate Trips. Models remains reachable. Empty Trips retains
the coast; chat start retains the existing small illustration and prominent input.

## Verification

- `pnpm build`, `pnpm typecheck`, `pnpm format:check`, and `pnpm test` passed. The unit suites
  reported 3,893 passing tests and six skipped tests.
- The complete Web browser suite passed all 50 tests against an isolated database and mock LLM.
  A pre-existing skills assertion now waits for persisted messages instead of assuming that an
  optimistic bubble means storage has finished. Its content assertions remain unchanged.
- After making the two dialog footers persistently visible, the Web build and typecheck passed
  again, and all three conversation-flow browser tests passed again. The context-composition
  unit suite passed with an added attachment-preservation assertion (29 tests).
- Playwriter inspected desktop and mobile welcome, topic starts, promotion, shared details,
  Trip contents and dark mode. At 320 x 568, the save action remains within the viewport; at
  390 x 844, the Trip page uses its internal scroller without growing the document.
  Local screenshots and the report live under `artifacts/design-qa/` and are not committed.

This verifies the consumer flow and mock-backed persistence, not real-model planning or the
payment journey. No desktop browser suite, live-model suite, commit or push was performed for D01.
