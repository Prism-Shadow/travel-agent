# The browser pane follows the conversation: hidden starts allowed, open state per conversation

Two fixes from the Codex benchmarking pass, one decision note
(`docs/decisions/implemented/2026-08-21-agent-tabs-follow-conversation-not-screen.md`):

- **The visibility gate is retired.** `openTabForAgent` no longer refuses a conversation that
  is not on screen (`IAB_SESSION_NOT_VISIBLE` is unreachable and removed from the
  penguin-browser skill, now v10): the tab lands in the agent conversation's own strip, hidden
  until the user opens that conversation — the same state as a task kept working after the
  user navigates away. Identity, task-liveness, ownership and the unconditional payment stop
  are untouched. This also collapses issue 0008's blast radius from "agent locked out while
  the user watches" to a cosmetic late render; the stale-active-session root cause remains
  open as a correctness bug.
- **The pane's open state is per conversation.** The single global `requested` boolean leaked
  one conversation's open browser into every other and greeted browserless conversations with
  an empty pane. `requestedByScope` now records explicit choices per conversation, derives
  "open" from content for the rest (pages → open, none → closed), migrates across draft
  promotion, and drives layout, state and shortcut entitlement. Cold start shows no pane until
  a conversation has something to show, superseding that part of the 2026-08-17 default-on
  behavior.

Verified: desktop unit suites (869) with new per-scope visibility and hidden-start tests, and
the real-Electron e2e with the cold-start pin updated to the new semantics.
