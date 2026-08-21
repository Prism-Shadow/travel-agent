# 0009 — Deleting a conversation never reaches the pane: its strip, views and state leak

Sidebar deletion (`sidebar.tsx` `confirmDeleteSession`) calls `api.deleteSession`, removes the
list entry and clears the input draft — and stops there. No IAB bridge call exists for it, and
the pane has no session-deleted path at all (`grep deleteSession packages/desktop/src` is
empty).

Everything scoped to the deleted conversation therefore outlives it until app restart:

- live tabs in its strip — attached `WebContentsView`s with real pages, hidden but consuming
  memory and CPU, their relay target claims still registered;
- `dormant` entries, which the checkpoint keeps persisting, so a deleted conversation's pages
  would even be re-materialized as ghosts on a later restore;
- `requestedByScope` and `backendBySession` entries.

The 2026-08-21 pane-follows-conversation change amplifies exposure: hidden strips can now grow
while a conversation is not displayed, so deleted-with-tabs becomes an ordinary state rather
than an edge case.

## Fix direction

A `dropScope(sessionId)` on the pane — destroy the scope's tabs (`destroyTab` handles views and
relay claims), drop its dormant/requested/backend entries, and reschedule the checkpoint —
invoked from the renderer's delete flow over a new bridge channel (and from any server-driven
deletion path that desktop observes). Archive flows need a decision: archived conversations
presumably keep their pages; deletion does not.
