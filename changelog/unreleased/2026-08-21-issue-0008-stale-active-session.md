# Issue 0008 opened: the pane's active session lags one conversation behind

Two consecutive fresh conversations were refused browser tabs with `IAB_SESSION_NOT_VISIBLE`
while the user was demonstrably viewing them; the pane reported the previously displayed scope
each time (the asking session's own draft scope, then the previous session). Traces pin the
pattern; the final writer of the stale value is not yet pinned — the designed renderer paths
were statically eliminated, and `setActiveSession` has no transition log to consult. The issue
records the evidence, the diagnostic next step, and the product question underneath: the
visibility gate's stated premise ("a hidden tab appears in no strip at all") predates
per-conversation strips, so refusing to *start* hidden is now a choice, not a necessity.

A dated research snapshot
(`docs/research/2026-08-21-codex-browser-conversation-model.md`) records the prior art: Codex
ships no such visibility gate — its interposition is per-site approval and per-action
confirmation, its cloud browser runs agent browsing with no live pane (progress and replay in
the transcript), and its local browser is a single shared page inside the chat, behind our
strip model in tab handling.
