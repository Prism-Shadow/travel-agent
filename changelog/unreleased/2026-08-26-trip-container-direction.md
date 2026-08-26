# The product direction is settled: a Trip is the first-class object

The direction deliberately left open when M3 and M5 were withdrawn (2026-08-18) is decided.
travel-agent is an open-source consumer travel application on the PenguinHarness engine, and its
first-class object becomes the Trip — recorded as a proposed decision note plus a phased plan.

Details:

- `docs/decisions/proposed/2026-08-26-trip-as-server-entity-owning-a-directory.md`: a Trip is a
  server entity that **owns** a directory rather than being one. Membership is a nullable foreign
  key on the session row, so attach / move / detach are single updates.
- The decisive finding behind it: a workspace is a *default for relative paths, not a boundary*.
  The file tools resolve absolute paths unchanged and no confinement guard exists in
  `core/src/environment/tools/`, so the trip directory does not have to be the conversation's
  workspace. The alternative — making `workspace` re-pointable — would have changed the
  append-only Trace contract, the memory-key derivation and workspace immutability during a
  session, and would have left a conversation's recorded `cwd` permanently untrue.
- Five alternatives are recorded with the evidence that rejected each, so the question is not
  re-litigated: workspace re-pointing (full and promotion-only), Trip-as-Workspace decided at
  draft time, directory-per-conversation with `trip.json` as the promotion marker, Trip-as-Project,
  and a presentation-only mapping.
- `tasks/trip-container.md`: phases P0–P5 — records, Trip contract and backend, sidebar
  information architecture, chips becoming trip identity plus a trip skill, the itinerary page,
  and a map scoped as *spatial evidence* rather than a planning canvas (the right-hand pane stays
  the in-app browser).
- `AGENTS.md` Product Direction and the architecture README's opening are rewritten to the new
  framing: an open-source consumer travel application whose first-class object is the Trip, with
  the one-sentence-to-payment-page loop kept as the core interaction rather than the whole product
  definition. The architecture document continues to describe what exists and links the decision
  for what does not.
- The plan states what is deliberately not adopted from the benchmark: a proprietary POI layer,
  inspiration/community/creator surfaces, the six-module hub with its proactive opener and
  suggestion pills, price watching, and — cut on 2026-08-26 — any booking or receipt ledger, since
  the product stops at the payment page and cannot observe the outcome.
