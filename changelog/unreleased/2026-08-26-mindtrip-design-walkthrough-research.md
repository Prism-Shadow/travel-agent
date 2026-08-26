# Research: Mindtrip's five open design flows, walked first-hand

A live logged-in walkthrough of mindtrip.ai answers the five interaction-level questions §12 left
open, each mapped to a pending travel-agent design decision; recorded as §13 of
`docs/research/mindtrip.md`.

Details:

- Chip dialogs documented field by field (Where with POI autocomplete and road-trip toggle; When
  as dates-or-flexible with multi-month selection; Who with a fourth Pets stepper; Budget's five
  tiers confirming the `trip-constraints.ts` "verbatim" note first-hand).
- Trip creation: the "What's the plan?" form is destination + timing + 2000-char prose only;
  Who/Budget chips are adopted from the chat wholesale after Create; the trip opens as a sheet
  over the chat (`?tripSheet=1`), not a navigation away.
- Chat↔trip membership is a first-class mutable edge: "Move to trip" (new or existing) on
  floating chats, "Move to another trip" / "Remove from trip" inside trips; on adoption the
  trip's chips replace the chat's own.
- Chips are bidirectional: the model inferred Where="Japan" from a JR-Pass question — the
  "model judges, UI renders, user overwrites" shape of Hard Rule 4.
- Mindtrip has no draft state (a chat URL materializes on first chip touch), a deliberate
  contrast with travel-agent's draft-first design, recorded with its cost.
- §13.5 flags the one hard tension for the Trip-as-Workspace mapping: conversation re-parenting
  means workspace reassignment, which the engine locks at Session creation — the promotion story
  must be decided before the sidebar restructure's P2.
- Working screenshots in gitignored `artifacts/research-mindtrip/`; a test trip was left on the
  research account for re-verification.
