# Trips exist: the backend a journey lives in

The Trip becomes a real object in the server — a row that owns a directory, with conversations
attached by a nullable foreign key. This is P1 of `tasks/trip-container.md`, implementing
`docs/decisions/proposed/2026-08-26-trip-as-server-entity-owning-a-directory.md`.

Details:

- `trips` table (name, destination, when, who, budget, dir) and `sessions.trip_id`, which is
  NULL for a floating "scratch" conversation. Existing databases pick the column up through the
  same `ensureColumn` guard the earlier columns use.
- Routes: `GET|POST /api/projects/:projectId/trips`, `GET|PATCH|DELETE /api/trips/:tripId`,
  `GET /api/trips/:tripId/sessions`, and `PUT /api/sessions/:sessionId/trip` — attach, move
  between trips, or detach with `tripId: null`.
- Every identity field is optional and independently patchable: an omitted key keeps the stored
  value, `null` clears that field alone. A trip can be created from a sentence with nothing
  known yet, and is honestly named "Untitled trip" until it has a destination.
- Each trip owns a directory named for its destination and travel month (`tokyo-2026-10`,
  collisions suffixed `-2`), holding a `trip.json` mirror of the row for the agent to read. The
  mirror write is best-effort: a folder the person moved cannot make their trip unusable in the
  app, and `dirExists` reports the truth instead.
- Deleting a trip detaches its conversations rather than deleting them, and never deletes the
  directory — those files are the person's.
- `PENGUIN_TRIPS_DIR` chooses where trip folders live, defaulting to `<root>/trips` so every
  entry point that redirects the data root keeps its trips with it. Only a packaged desktop app
  claims `~/Penguin Trips`; a source run cannot write into real trips.
- Trip ordering breaks ties on insertion order, not on the trip id: two trips created in the
  same millisecond share a `created_at`, and ordering by a random id shuffled the list between
  reads (caught by running the new suite repeatedly, not by a single green run).
