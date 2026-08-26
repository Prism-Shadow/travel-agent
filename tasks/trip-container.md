# Plan — the Trip container and the consumer sidebar

The product direction withdrawn on 2026-08-18 is settled: travel-agent is an **open-source
consumer travel application** built on the PenguinHarness engine. Its first-class object becomes
the **Trip**. This plan carries that from schema to sidebar.

Architecture is decided separately in
[`docs/decisions/proposed/2026-08-26-trip-as-server-entity-owning-a-directory.md`](../docs/decisions/proposed/2026-08-26-trip-as-server-entity-owning-a-directory.md)
— a Trip is a server entity that owns a directory; membership is a nullable foreign key; no
`packages/core` change and no Session's `workspace` is ever re-pointed.

Benchmark evidence is `docs/research/mindtrip.md` §11–§13 (§13 is a first-hand walkthrough).

## What is being matched, and what is deliberately not

Mindtrip is a planning product that recently grew a transaction; travel-agent is a transaction
product with no planning layer. Only the planning pieces that the transaction loop rests on are
adopted.

| Adopt | Because |
| --- | --- |
| Trip as a container above conversations (1 : N) | Without it every conversation restarts from zero and no artifact has a home |
| Constraint chips as trip identity, injected per conversation | The chips already exist as per-draft scaffolding with no home |
| Mutable chat↔trip membership | Verified first-hand as the shipped model (§13.4); the product's entry shape means intent is often known late |
| An itinerary artifact | It is the task's visible result and the reason to come back |
| A map, as spatial evidence | Strengthens the one capability reviewers say the whole category lacks — arbitration with reasons |

| Do not adopt | Because |
| --- | --- |
| A proprietary POI/fact layer | Years of work plus an acquisition for them; our anti-hallucination story is different — the agent reads the real page |
| Inspiration feed, community, creators, group collaboration | Growth mechanics of a free consumer product, unrelated to this tool |
| The six-module trip hub, the proactive opener, suggestion pills, the "Trip N" badge | They serve "planning as the product" (§13.5) |
| Price watching and drop alerts | Conflicts with the standing product judgement: no long-lived processes |
| Booking/receipt ledger | Cut on 2026-08-26 — the product stops at the payment page and cannot observe the outcome; a record the person must confirm by hand buys too little |

## Phases

### P0 — Records (0.5d)

- [ ] The decision note above moves through review.
- [ ] `AGENTS.md` Product Direction is rewritten: open-source consumer application, Trip as the
      first-class object. The one-sentence-to-payment-page loop stays as the core interaction, no
      longer as the whole product definition.
- [ ] `docs/architecture/README.md` opening section updated to match.
- [ ] Changelog entry.

### P1 — Trip contract and backend (3–4d)

- [ ] `trips` table and `sessions.trip_id` (nullable) in the server index; migration for existing
      rows (all become floating).
- [ ] Routes: create / patch / list / delete a trip; attach / detach a conversation.
- [ ] Directory creation under a user-visible root, and the `trip.json` mirror written on every
      identity change. Dev entry points stay on `~/.penguin/dev-data`.
- [ ] Decide the trip-directory root and record it (user-visible path is the point of the
      open-source narrative — the folder is the person's).
- [ ] Honest degradation when `trips.dir` is missing.
- Verify: server tests for each route; a conversation attaches, moves, detaches with its
  `workspace` unchanged (assert it).

### P2 — Sidebar information architecture (3–4d)

- [ ] Workspace grouping becomes **Trips**: a trip card renders name, destination, dates and a
      running-status dot, and expands to its conversations.
- [ ] Conversations with no trip render in a "scratch" section.
- [ ] Conversation row menu: move to trip (new or existing) / move to another trip / remove from
      trip / rename / delete — the shape verified in §13.4.
- [ ] Agents / Models / Usage / Traces / Benchmark demote into a developer console entry; routes
      stay reachable.
- [ ] The draft screen's Agent and Workspace pills hide in consumer mode; project defaults supply
      them silently.
- [ ] zh and en strings for everything new.
- Verify: `pnpm dev` walkthrough — one sentence creates a trip; a second conversation in it
  inherits identity; a scratch conversation stays scratch; a scratch conversation is promoted
  afterwards.

### P3 — Chips become trip identity, and the trip skill (2–3d)

- [ ] Chips write trip identity at creation instead of composing a per-message prefix.
- [ ] A conversation inside a trip shows inherited values rather than empty chips; editing them
      updates the trip.
- [ ] New built-in skill (patterned on `skills/penguin-browser`): read `trip.json` and
      `itinerary.md` before starting work; write findings and decisions back into the trip
      directory.
- **Deferred: model-proposed trip creation.** The plan was for the agent to notice that a loose
  conversation is a journey and raise the existing `selection` card to propose making it one.
  On implementation the mechanism turned out not to exist: the agent has no way to create a
  Trip. Interaction cards carry a *choice* back to the agent, not a command to the server, so
  the only ways to close the loop would be to give the agent a trip tool (a change to the pinned
  engine's tool set) or to have the Web pattern-match a card's text to decide it means "create a
  trip" (code inferring intent the model expressed in prose — the wrong side of Hard Rule 4, and
  fragile).

  Building either would be a mechanism ahead of a caller, which this repository has paid for
  twice (`@travel-agent/domain`, `packages/transaction`). The need it was meant to serve is
  already met by two shipped affordances: "new trip", and moving a conversation into a trip from
  its row menu. If use shows people want the agent to offer it, that is the moment to design the
  path properly.
- Verify: web tests for chip inheritance, the trip-folder line, and clearing a field.

### P4 — Trip detail: the itinerary (2d)

- [ ] The trip page renders `itinerary.md` from the trip directory, reusing the existing file
      panel component.
- [ ] Honest empty state before the agent has written anything.
- Not in scope: any booking or receipt artifact (see the table above).

### P5 — Map as spatial evidence (4–5d)

The map's job here is not a planning canvas; it is evidence for a claim. When the agent says a
hotel is close to the station — the constraint our own starter prompt uses — the map is what makes
that checkable. It does not take the right-hand pane: that belongs to the in-app browser.

- [x] **P5.0 spike — done, and it changed the shape.** The question was which credential a
      browser-side map would need. The answer is that no browser-side map should exist: `AMAP_KEY`
      is a Web Service key living in the *agent's* vault, reaching the agent's command environment
      and nothing else. Putting a map in the frontend would have meant a second credential class
      (a JS API key) exposed to the browser, or a server proxy reaching into a vault whose gates
      are fail-closed behind the unresolved isolation decision. Both are worse than the
      alternative: **the agent renders the map and the app renders the file.** That is the same
      ownership split the rest of the trip folder already has, and no key ever reaches the
      browser.
- [x] **P5.1 data path.** `places.json` (coordinates the agent geocoded) and `map.png` (the
      rendered static map) are artifacts the agent writes into the trip folder, taught by the
      `trip-workspace` skill. The frontend renders; it does not geocode, and it does not parse
      prose.
- [x] **P5.2 the map on the trip page.** `GET /api/trips/:tripId/file` serves the trip folder
      through the existing workspace-file reader — inheriting its symlink-aware confinement and
      its rule that scriptable content is served as plain text — and relative image names in
      `itinerary.md` resolve to it. `![map](map.png)` beside the fact it evidences renders inline.
      No coordinates, no file, no map: nothing is drawn and nothing claims to be missing.
- [x] **P5.3 spatial evidence.** Delivered by the same mechanism rather than a separate
      message-level widget: the agent embeds the map in the itinerary at the point the claim is
      made ("400 m from Ginza station" with the map beside it), so the evidence lives next to the
      assertion it supports and outlives the conversation that produced it. A widget bound to a
      message would have shown the same picture and lost it as soon as the thread scrolled.
- Boundary, recorded in the skill: no draggable itinerary canvas, no prices on the map, no
  heat-map exploration. The map answers a claim; it is not a planning surface.
- Known limitation, stated in the skill so the agent acts on it: Amap covers mainland China well
  — which is where the target scenarios live (Ctrip, Fliggy, Xiaohongshu) — and elsewhere poorly.
  Outside the mainland the agent states the distance and its source instead of drawing a map that
  would be wrong or empty. An international base map is a later, separate question.

## Acceptance for the whole plan

One sentence creates a trip; the agent compares real options on a real site and returns a few
representatives each with a reason; a click authorizes form-filling; the run stops at the payment
page; the trip page shows the itinerary the agent wrote, and a spatial claim in it can be checked
on the map.

That is the withdrawn M3 acceptance run, restored in a form that also has somewhere to keep what
it produced.

## Gates

`pnpm typecheck`, the affected package's tests, and `pnpm build` whenever paths, layout or
bundling move. P2 onwards also needs a `pnpm dev` walkthrough against `~/.penguin/dev-data`.
