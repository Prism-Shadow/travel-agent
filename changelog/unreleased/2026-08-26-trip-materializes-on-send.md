# A trip is created by its first message, not by the click that opens it

Walking the product surfaced two defects in how a journey begins, and fixing them surfaced a
third. All three came from the same mistake: the Trip — a row, a directory and files — was being
created by a click, before anything was known and before anyone had committed to anything.

Details:

- **"New trip" now creates nothing.** It opens a draft that will *become* a trip, and the first
  message materializes it — exactly as the first message has always materialized the Session. A
  click someone thought better of leaves no row and no directory. (Four empty trips had
  accumulated in a development data root from four such clicks.)
- **The folder is named for the destination.** Creating the trip at send time means the chips
  have been filled by then, so a journey to Kyoto in November gets `kyoto-2026-11` instead of the
  `trip-<date>` fallback every trip was getting. The naming had been designed and unit-tested,
  but no flow had ever reached it: the tests passed a destination the UI never had at that point.
- **A failed send leaves nothing behind.** The trip is created before the Session so it can be
  joined in one step, and rolled back if anything after it fails — the contract the empty-Session
  cleanup already had. Deleting a trip now also removes its directory **when nothing but our own
  `trip.json` is in it**; a folder holding an itinerary, a map, or any other file is never
  touched. Without that second half the rollback had simply moved the junk from empty rows to
  orphaned folders. The living documents that state this contract — the architecture README, the
  decision note's consequences, and the trip service's own header, which had flatly contradicted
  the method 250 lines below it — now say the same thing.
- Two pieces of the consumer surface that the sidebar work claimed and missed: the collapsed rail
  no longer lists the five engine console routes, and the draft screen no longer asks for an
  Agent or a Workspace. Both still resolve from the Project's new-chat defaults, and both remain
  configurable in the developer console; neither is a choice a traveller has any basis to make
  before their first sentence. The now-unused pickers are deleted rather than hidden.

Verified in the running application, not only in tests: clicking "New trip" leaves the trips
directory empty; a send creates `kyoto/` and, when the Session fails for a missing credential,
the server log shows `POST /trips 201 → POST /sessions 400 → DELETE /trips 204` and the directory
is gone.
