# The starter cards are replaced: three real-site scenarios are the whole showcase

The draft screen's example set is rebuilt around what the product actually demonstrates best —
driving named sites in the visible browser. The six site-agnostic travel starters (Tokyo plan,
West Lake stays, return flight, organize bookings, change dates, travel link) are removed as a
design that undersold the product: their visible labels were indistinguishable from generic
chatbot suggestion chips. The three starters that remain are:

- **Book tomorrow's flight on Ctrip** (`ctripFlight`) — the write-path starter, phrased
  exactly as a user would say it: a business trip to Shanghai tomorrow, book the
  Beijing–Shanghai flight, pick the cheapest, no add-on service bundles. The prompt recites no
  product contract — representative reasoning, the visible browser, and the payment stop are
  the agent's and the enforced gate's obligations, not something a user types. Earlier copies
  proved both halves of the lesson: a version with "next Saturday" and "moderate budget"
  stalled on clarifying questions live, and a version stuffed with hand-off meta-instructions
  read like nothing a user would write. Fully determined parameters are what keep the run
  question-free.
- **Compare Ctrip and Fliggy prices** (`otaCompare`) — the same room opened in parallel tabs;
  compares tax-inclusive totals, cancellation rules and member rates, and flags offers that are
  not comparable. Asks for the hotel, room type and dates first instead of inventing them — a
  comparison against fictitious parameters would be worthless — and states in the prompt that
  this is a one-time check, not price tracking (the product does no price watching).
- **Turn Xiaohongshu guides into a trip** (`xhsTrip`) — the longest chain: search the notes in
  the visible browser, keep what several guides agree on with per-pick attribution, distill a
  day-by-day itinerary, then book the matching flights and stays. A login or verification wall
  hands the tab to the user, turning the site's gate into a demonstration of the takeover
  interaction.

The three starters demonstrate three distinct interaction modes on purpose: full hand-off to
the payment gate (`ctripFlight`), ask-first decision support (`otaCompare`), and a
takeover-capable long chain that books only after the user's choice (`xhsTrip`).

With the showcase at three cards, the folder indirection is dissolved: `EXAMPLE_FOLDERS` existed
to let the set grow past a flat list behind a collapsible UI that was never rendered, and
`example-tasks.ts` now exports the flat `EXAMPLE_TASKS` directly. The sweep also removes every
dead example string the dictionaries carried: the never-rendered `exampleFolders` names and the
six orphaned upstream demo prompts (`game`, `gamecenter`, `lol`, `rag`, `agentBenchmarkBuild`,
`agentOptimization`) in both locales.

`example-tasks.test.ts` pins the new shape — exactly the three starters in display order,
`skills: []`, and the bilingual decision-and-safety contract markers, which now include the
one-time-check boundary ("not price tracking" / "不做长期盯价") and drop the marker owned by
the removed change-dates card.
