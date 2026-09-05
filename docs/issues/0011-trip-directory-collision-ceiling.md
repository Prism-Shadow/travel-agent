# 0011 — Trip creation stops after 50 directory-name collisions

Status: closed. Observed during Trips overview browser QA on 2026-09-05 and resolved in the
workspace review. Tracked as [T08](../../tasks/todo.md#t08--remove-the-trip-directory-collision-ceiling).

## Evidence and impact

Repeated browser tests against one temporary data root returned HTTP 500 with code
`trip_dir_unavailable` from the Trip creation endpoint. New test users did not avoid the failure.
The same 10 overview/discovery-rail checks passed after restarting the server and mock with a fresh
data root. The failed and passing logs are local QA evidence under `artifacts/design-qa/`.

[TripService](../../packages/server/src/services/trip-service.ts) previously attempted only the bare basename
and suffixes `-2` through `-50`. It returned that error after every candidate already existed. Its
configured Trip root is shared across projects; a missing destination produces `trip-YYYY-MM-DD`
using the UTC creation date. Separate users and projects therefore still compete for those names.
The same ceiling applies to repeated destination/month basenames.

This blocked creation despite other directory names being available. No basis found for loss of
existing Trip records or for this failure affecting the user's development data during QA.

## Reproduction

Use an isolated server data root and create 51 Trips without a destination through
`POST /api/projects/:projectId/trips` on the same UTC day, keeping their directories. The allocator
can create the first 50 candidates; the next request has no candidate in its search range.
Alternatively, pre-create those 50 directories in the isolated root and create one matching Trip.
Do not run this against real user data.

## Resolution

After the 50 readable candidates are occupied, `fs.mkdtemp` atomically allocates a random suffix.
The fallback preserves readable prefixes, leaves every existing directory untouched and lets
filesystem errors propagate. Route tests prepopulate all 50 names, run three concurrent creators
for both destinationless and destination/month basenames, and verify every original sentinel and
every new `trip.json`. The tests reproduced HTTP 500 before the fix and pass after it.

The verified criteria are:

- Creation can allocate a new directory when the first 50 candidates already exist.
- Existing directories and their contents are never reused or overwritten.
- Concurrent creators cannot claim the same directory, and real filesystem failures remain visible.
- Tests cover destinationless Trips, repeated destination/month names and concurrency.

Do not bypass this limit by deleting user directories or by changing the overview's creation flow.
