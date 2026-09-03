# Plan — Trips overview page and sidebar trip covers

Status: planned, not started. Origin: 2026-09-03 review of Mindtrip's surfaces against ours
(screenshots in chat; the IA analysis they confirm is `docs/research/mindtrip.md` §12–13).

## The claim this plan rests on

Mindtrip's sidebar and "Your trips" page feel better than ours for one reason that is ours to
take — the covers and the overview grid — and one that is not: the booking/receipt ledger.
The information architecture itself (Trip 1:N conversations, loose chats first-class,
promotion via row menu) is already equivalent in this product; `docs/research/mindtrip.md`
§12.3 records that their v9 hub is the shape our sidebar already has. What we lack is purely
presentational: the trip has no face anywhere, and there is no one screen that answers
"what journeys do I have?" at a glance.

The cover asset cost is already paid: `packages/web/src/lib/travel-cover-library.ts` ships 192
curated covers with a deterministic, dedup-guaranteeing selector (`selectTravelCovers`), used
today by the draft screen's rail only.

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

## Design decisions

- **Cover selection reuses the existing API unchanged.** Subjects are
  `{ sessionId: tripId, title: name || destination }` — exactly how the Up-next card already
  selects (`jump-back-in.tsx` covers memo). One `selectTravelCovers` call per surface keeps
  that surface's dedup guarantee; across surfaces, the same trip naturally resolves to the
  same cover, which is consistency, not collision. The web SPEC's covers bullet currently
  says selection "excludes images already reserved by another simultaneously visible rail" —
  reword to state the per-surface guarantee and the cross-surface consistency.
- **Grouping is index-only.** Sections: **Upcoming** (has a `when` with a future start,
  sorted soonest first), **Unscheduled** (no usable date), **Past** (ended before today),
  in that order. No model call — same rule the SPEC already states for the rail.
- **Extract the date logic.** `pickUpNextTrip` / `localTodayIso` live inside
  `jump-back-in.tsx`; the ordering they embody is what the overview sections need. Extract
  the trip-date comparison into `src/lib` (e.g. `trip-order.ts`), have both callers use it;
  `test/up-next.test.ts` keeps pinning the rail behaviour through its current import or the
  new module, whichever reads cleaner — do not fork the logic.
- **Card content = what the sidebar already knows.** Cover (decorative, empty `alt` — the
  card title is the accessible name, per the covers bullet), trip display name
  (`tripDisplayName`), meta line (`tripMetaLine`), the waiting-on-you badge if the count is
  already in the loaded index. Click navigates to `/trips/:tripId`. No new server calls:
  `TripsProvider` already holds the list.
- **Route.** `<Route path="/trips" element={<TripsPage />} />` beside the existing
  `/trips/:tripId`; no conflict in react-router v7.
- **Sidebar thumbnail is small and lazy.** One `<img loading="lazy">` per trip group header,
  rounded, ~28px; `focalPoint` drives `object-position`. The header keeps its text as the
  accessible name; the thumbnail is decorative (`alt=""`).
- **Strings.** New entries in `strings.ts` (zh) + `strings-en.ts`: page title, section
  headings (Upcoming / Unscheduled / Past), empty state. Both catalogs in the same commit
  (placeholders-parity test enforces this).

## Steps

Phase 1 — the overview page:

- [ ] Extract trip-date ordering into `packages/web/src/lib/trip-order.ts`; rewire
      `jump-back-in.tsx`; keep `up-next.test.ts` green.
- [ ] `features/trips/trips-overview-page.tsx`: sections, cover cards, empty state; one
      `selectTravelCovers` call across all visible cards.
- [ ] Route `/trips`; strings in both catalogs.
- [ ] Unit tests: section grouping (dates, flexible, none, past), cover subject mapping.
- [ ] e2e `packages/web/e2e/trips-overview.spec.mjs`: provision trips via API (dated +
      undated), assert section membership, card navigation, and the empty state.

Phase 2 — the sidebar:

- [ ] Thumbnail in the trip group header; "Trips" heading links to `/trips`.
- [ ] Extend one existing sidebar-focused e2e assertion rather than a new file, if one fits.

Phase 3 — the record (same commits as the code they describe, Hard Rule 2):

- [ ] `packages/web/SPEC.md`: new bullet for the trips overview under "What it owns";
      covers bullet reworded (per-surface dedup, cross-surface consistency, new consumers);
      sidebar bullet mentions the thumbnail and the heading link.
- [ ] `sidebar.tsx` header comment updated.
- [ ] Decision note not required: no boundary moves — presentation only, over data the
      surfaces already load. The research doc already records the adopt/decline verdict.

## Verification

Per phase: `pnpm typecheck`, `pnpm --filter @prismshadow/penguin-web test`, the new/changed
e2e specs in isolation. Before push: the full AGENTS.md gate (build, format, all tests, web +
desktop + live-model e2e).

## Risks

- **Sidebar image weight.** Dozens of trips → dozens of thumbnails; `loading="lazy"` and the
  already-optimized assets bound this. Measure before adding anything cleverer.
- **Cover mismatch on odd trip names.** Unknown titles fall back to generic covers by design
  (`selectTravelCovers` guarantees it); acceptable, already the rail's behaviour.
- **`/trips` empty state duplicating the first-run rail's job.** Keep it one line + the
  New-trip action; the draft screen remains the product's opening scene.
