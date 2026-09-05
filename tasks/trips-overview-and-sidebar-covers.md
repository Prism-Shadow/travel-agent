# Plan — Trips overview page and sidebar trip covers

Status: T04 implemented and verified in the working tree. The owner selected
the second visual concept on 2026-09-05, with a dark navy New trip button and suitcase icon, and requested a first-visit background. Sidebar
thumbnails remain T05. Queue and priority: [T04 and T05](todo.md#proposed-order).
Origin: 2026-09-03 review of Mindtrip's surfaces against ours (the IA analysis is in
[the research snapshot](../docs/research/mindtrip.md), sections 12–13).

## The claim this plan rests on

Mindtrip's sidebar and "Your trips" page feel better than ours for one reason that is ours to
take — the covers and the overview grid — and one that is not: the booking/receipt ledger.
The information architecture itself (Trip 1:N conversations, loose chats first-class,
promotion via row menu) is already equivalent in this product; `docs/research/mindtrip.md`
§12.3 records that their v9 hub is the shape our sidebar already has. The overview answers "what journeys do I have?" at a glance; the remaining presentation gap is
cover thumbnails in sidebar headers.

The cover asset cost is already paid: `packages/web/src/lib/travel-cover-library.ts` ships 192
curated covers with a deterministic selector (`selectTravelCovers`), used
by the draft screen's rail and the Trips overview.

## Scope

**In:**

1. A `/trips` overview page: cover-card grid of the person's trips, grouped by departure.
2. Trip cover thumbnails in the sidebar's trip group headers, and the sidebar's "Trips"
   heading becoming the entry point to `/trips`.

**Out, with the reason each stays out (root `SPEC.md` Declined table):**

- Receipts tab / "Booked only" filter — a booking ledger is declined: the run stops at the
  payment page and cannot observe the outcome; a stored "booked" state would be a guess.
- Calendar tab — deferred, not declined: renderable from index fields, but it is a second
  view of the same data and earns nothing until trips carry more dated artifacts.
- Explore / inspiration feed / invite-collaboration — declined growth mechanics.
- Proactive AI opener, suggestion pills, six-module hub — "planning as the product",
  declined; research verdict "not ours to copy" (`mindtrip.md` §13.5).

## Implementation choices

### Selected T04 design and implementation contract

- A large leading trip card sits beside two smaller cards. Additional dated trips and flexible
  trips remain reachable in a responsive two-column list; past trips expand from a summary row.
- The header uses the selected dark navy New trip button. Both it and the empty-state action
  park existing draft text and open an independent conversation draft; a Trip requires explicit
  promotion, as specified by [D01](unified-trip-entry.md).
- The first-visit state uses a local decorative coastal background, an invitation to start a
  journey, and one primary action. It contains no example trips presented as the user's records.
- The sidebar's My Trips link opens the overview so the page has a discoverable entry;
  thumbnails remain a separate task. The existing application shell remains shared.
- A single cover allocation covers all overview sections, including collapsed past trips.
  Covers are context-dependent decorative choices, not persistent Trip identity. Once matching
  and neutral candidates are exhausted, eligible covers may repeat; unrelated destinations are
  never borrowed. No change to the draft rail's allocation or three-card ordering.
- Past requires a known end before today. Start-only trips stay in the dated section after
  departure because their return is unknown. Blank, invalid, reversed and flexible windows are
  unscheduled. Explicitly started trips get a departed/in-progress label instead of a countdown.
- Implement loading and retryable error states using the existing Trips provider; failed loading
  must never appear as a first visit. Check grouping, navigation, draft preservation, both locales,
  long lists, phone layouts and dark theme. Update the web spec and cover decision with delivery.

## Remaining steps

T04 is implemented in the working tree. Its behavior is owned by
[the web spec](../packages/web/SPEC.md); the selected visual and checks are local evidence under
`artifacts/design-qa/`. The previous unused date draft has production callers and focused tests.

T05 — sidebar thumbnails:

- [ ] Add a small rounded, lazy-loaded decorative cover to each Trip group header.
- [ ] Decide allocation when the sidebar and overview or discovery rail coexist; reuse of the
      catalog alone does not guarantee matching images or cross-surface deduplication.
- [ ] Preserve group expansion, active state, keyboard behavior, the single New trip entry and Models link.
- [ ] Extend the existing sidebar browser checks for long names, many groups and narrow layouts.
- [ ] Update the web spec, sidebar comment and cover decision with the actual allocation scope.

The sidebar's Trips heading already opens `/trips`; it is part of T04's usable entry path.

## Verification

Per phase: `pnpm typecheck`, `pnpm --filter @prismshadow/penguin-web test`, the new/changed
e2e specs in isolation. Before push: the full AGENTS.md gate (build, format, all tests, web +
desktop + live-model e2e).

## Risks

- **Sidebar image weight.** Dozens of trips → dozens of thumbnails; `loading="lazy"` and the
  already-optimized assets bound this. Measure before adding anything cleverer.
- **Cover mismatch on odd trip names.** Unknown titles fall back to generic covers by design
  (`selectTravelCovers` guarantees it); acceptable, already the rail's behaviour.
- **`/trips` empty state duplicating the first-run rail's job.** Keep its decorative background,
  brief guidance and New trip action focused on starting; the draft screen remains the opening scene.
