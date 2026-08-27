# The agent is told where its trip folder is, and the itinerary is styled

Running the product against a live model found two defects that every test had passed over. Both
were only visible by reading what the agent actually received and what the page actually looked
like.

Details:

- **The trip-folder line never reached a new trip's first message.** The composer resolved the
  folder from the *existing* trip a draft belonged to; a trip created by the send itself had no
  folder at the moment the message was composed, so the line was silently absent. The
  `trip-workspace` skill's first instruction is to read `trip.json` from the path the app gives
  it — with no path, the entire mechanism was inert for every trip started from "new trip", which
  is every trip. The line is now added after the trip exists, and the chips stay with the
  composer where they belong.
- **The itinerary rendered unstyled.** The trip page asked for a `prose-chat` class that does not
  exist; the repository's markdown stylesheet is `md-body`, the one the transcript uses. Headings,
  lists and spacing were flat until it was named correctly.

Verified against a real run rather than a fixture: a trip started from one sentence produced
`trips/nara/`, the message arrived carrying `Trip folder: …/trips/nara`, and the agent wrote an
`itinerary.md` that follows the skill's shape — the identity line, days with reasons, and an
"Open questions" section naming the budget tier it had not been told. It also declined to draw a
map, saying its map service covers mainland China only, which is the limitation the skill states.
