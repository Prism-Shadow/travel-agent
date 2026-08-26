# The sidebar is a list of trips

The consumer surface's first-class object becomes the Trip: the sidebar groups conversations by
the journey they belong to, and the engine's console moves out of the way. This is P2 of
`tasks/trip-container.md`.

Details:

- Trips replace Workspace/Agent grouping in the sidebar. Each group is a journey, its header
  carrying the identity a traveller recognizes — destination, dates, travellers, budget tier —
  rendered only for the fields that are set, so a trip stated in one sentence does not look
  unfinished.
- A trip with no conversations yet still appears. It exists from the moment it is created, and
  hiding it until its first message made the click look inert.
- Conversations belonging to no trip land in a trailing "loose questions" group, which
  disappears when empty. A question like "is the rail pass worth it?" is not forced through a
  journey it does not need, and a conversation that turns out to be one can be moved in later
  from its row menu: move to a trip, move to another, or remove from one.
- A conversation whose trip has been deleted elsewhere shows among the loose questions instead
  of disappearing with its group.
- Agents / Models / Usage / Traces / Benchmark move from the sidebar's top-level navigation into
  a collapsed "developer console" entry at the bottom. Demoted, not removed: every route stays
  reachable and unchanged.
- "New trip" creates the trip immediately and lands on a draft attached to it — nothing is asked
  for up front, since the person is about to say it in their own sentence. A trip's own "+"
  starts another conversation inside it.
- Sessions can be created already attached to a trip (`tripId` on session create, validated to
  exist in the same Project).
