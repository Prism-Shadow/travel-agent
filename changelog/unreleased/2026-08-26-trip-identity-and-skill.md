# The chips become a trip's identity, and the agent learns to work in its folder

Constraint chips stop being scaffolding for one message and become the identity of the journey
they describe; a new built-in skill teaches the agent to read and maintain the trip's folder.
This is P3 of `tasks/trip-container.md`.

Details:

- Inside a trip, the four chips (Where / When / Who / Budget) *are* that trip's identity: they
  open showing what the journey already knows, and editing one patches the trip. The second
  conversation about a journey no longer asks for what the first one established.
- On a conversation belonging to no trip the chips stay what they were — local scaffolding for
  one message, cleared after a send. Filling them does not quietly create a trip: a journey
  begins when the person says so, not because a city was named in a question.
- The chips write through to the trip rather than optimistically: a failed write must not leave
  the chips showing a value the journey does not have.
- The trip's folder path leads the visible message prefix when a conversation belongs to one, so
  the agent is told where to work in the same text the person can see they sent — no hidden
  channel. Later messages do not repeat it; the skill reads `trip.json` instead.
- New built-in skill `trip-workspace`: read `trip.json` (identity, app-owned) and `itinerary.md`
  (the plan, model-owned) before starting; record decisions, reasons and stated preferences back
  into the folder; never write `trip.json`, never delete anything, and keep no booking ledger,
  since the run stops at the payment page and cannot see the outcome.
- `TripWhen` / `TripWho` / `TripBudgetTier` now have one definition, in the server's API types,
  re-exported by the web module that renders them — two copies would have drifted the first time
  either side gained a field.
- **Deferred, with the reason recorded in the plan:** model-proposed trip creation. The agent
  cannot create a trip, and the two ways to let it — a new engine tool, or the Web inferring
  intent from a card's prose — are respectively a change to the pinned engine and code guessing
  at what the model meant. Both would be mechanism ahead of a caller. "New trip" and moving a
  conversation into a trip already serve the need.
