# A map as evidence for a spatial claim, drawn by the agent

When the plan turns on where something is — "400 m from the station" — the map that proves it now
appears beside the claim. This is P5 of `tasks/trip-container.md`, and the spike that opened it
changed its shape.

Details:

- **The spike's finding: there is no browser-side map, and there should not be.** `AMAP_KEY` is a
  Web Service key held in the *agent's* vault, reaching the agent's command environment and
  nothing else. A frontend map would have needed a second credential class exposed to the
  browser, or a server proxy reaching into a vault whose gates are fail-closed behind the
  unresolved isolation decision. Instead the agent renders the map and the application renders
  the file — the same ownership split the rest of the trip folder already has, and no key ever
  reaches the browser.
- `GET /api/trips/:tripId/file` serves the trip's own folder through the existing workspace-file
  reader, inheriting its symlink-aware confinement and its rule that scriptable content (html,
  svg) is served as plain text — files there are agent-generated and are not trusted with this
  origin.
- Relative image names in `itinerary.md` resolve to that endpoint, so `![map](map.png)` written
  beside the fact it evidences renders inline on the trip page. The chat's markdown renderer
  gained an optional resolver for this and is otherwise untouched — its frozen component maps
  still apply when no resolver is passed, so streaming replies do not remount their code blocks.
- The `trip-workspace` skill now teaches the whole path: geocode with `amap-lbs-skill`, record
  `places.json`, render `map.png` through Amap's static-map endpoint, embed it next to the claim,
  and never write the key into any file in the folder.
- Scoped deliberately: the map answers a claim, it is not a planning surface. No draggable
  itinerary canvas, no prices on the map, no heat-map exploration.
- Stated as a limitation the agent acts on: Amap covers mainland China well — where the target
  scenarios live — and elsewhere poorly. Outside the mainland it states the distance and its
  source rather than drawing a map that would be wrong or empty.

Records: the decision note graduates to `docs/decisions/implemented/` with what shipped, its
deferrals and what now pins the behaviour — and the three source comments that cite it
(`db/schema.ts`, `db/repos/trips.ts`, `services/trip-service.ts`) follow it there, so the citation
still resolves; the changelog entries that cite the old path are dated records and keep it; `tasks/trip-container.md` is deleted (the work shipped
and the changelog keeps the record); the architecture README gains the Trip as built; and two
lessons are recorded — run every package's suite, and give same-millisecond rows a tiebreak that
means something.
