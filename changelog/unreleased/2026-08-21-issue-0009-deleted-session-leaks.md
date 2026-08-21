# Issue 0009 opened and closed: deleting a conversation no longer leaks its browser strip

An IAB audit after the pane-follows-conversation change found that sidebar deletion never
reached the pane — no bridge channel existed for it — so a deleted conversation's live
`WebContentsView`s, relay target claims, dormant checkpoint entries, and per-scope
requested/backend state all outlived it until app restart. Hidden starts made
deleted-with-tabs an ordinary state, raising the exposure.

Fixed in the same day: the pane gains `dropScope(sessionId)` — destroys the scope's tabs
(views and relay claims via the existing `destroyTab` path), drops its dormant entries and
per-scope requested/backend/persistence records, and reschedules the checkpoint — wired
through a new `iab:drop-session` bridge channel that the sidebar's delete flow calls
best-effort after the server confirms deletion. Archiving deliberately does not drop: an
archived conversation keeps its pages. The audit also re-ran every suite green; the fix adds
a behaviour test (deleted scope's contents closed, choices gone, other conversations
untouched — desktop 870).
