# Agent Note: The browser pane follows the conversation — tabs, and the pane's own open state

Status: implemented

## Problem

Two couplings tied the per-conversation browser model to a single global notion of "the screen":

1. `openTabForAgent` refused any conversation not currently displayed
   (`IAB_SESSION_NOT_VISIBLE`), citing a Phase-1 premise — "a tab created for a hidden
   conversation appears in no strip at all" — that per-conversation strips had made false. Its
   enforcement key (`activeSession`) sits on a state-sync path that drifted in the wild
   (issue 0008): agents were refused for conversations the user was looking at, and could only
   ask the user to go where they already were.
2. The pane's open state was one global boolean: opening the browser in one conversation opened
   it over every other, and a conversation that had never used the browser greeted the user
   with an empty pane.

Prior art (research snapshot `2026-08-21-codex-browser-conversation-model.md`): Codex ships no
visibility gate — its interposition is per-site approval and per-action confirmation, and its
cloud browser runs agent browsing with no live pane, delivering visibility as transcript
evidence.

## Decision

The pane follows conversations in both respects:

- **Tabs.** `openTabForAgent` opens into the agent conversation's own strip unconditionally.
  Identity, task-liveness, ownership and every action gate (including the unconditional payment
  stop) are unchanged. A tab for a non-displayed conversation starts hidden — the layout
  renders only the displayed scope, and driving hidden views was already shipped behavior for
  tasks the user navigates away from. `IAB_SESSION_NOT_VISIBLE` is retired from the pane and
  from the penguin-browser skill (v10), whose guidance is now to keep working and narrate
  progress rather than ask the user to switch.
- **Open state.** `requestedByScope` records an explicit choice per conversation (the user's
  toggle, or a tab being created); a scope with no entry derives its answer from content —
  open when the conversation has pages (live or dormant), closed when it has none. Creating a
  tab marks its own conversation open: on screen that opens the pane now, hidden it takes
  effect when the user arrives. Draft promotion migrates the recorded choice with the strip.
- `activeSession` thereby leaves the agent-correctness path: issue 0008's remaining damage is
  cosmetic (a late strip render), and its root cause stays tracked as a correctness bug.

This supersedes the launch behavior recorded in the 2026-08-17 "IAB default on" change insofar
as the pane no longer forces itself over conversations without browser content; the browser
remains enabled by default and opens the moment a conversation has something to show.

## Alternatives considered

- **Keep the gate and only fix the 0008 writer.** Rejected: the premise was outdated, the
  drift failure mode was an agent and a user waiting on each other, and the surveyed prior art
  ships without such a gate.
- **Auto-switch the user's view to the agent's conversation.** Rejected for the reason the old
  code recorded: yanking the user into another conversation is worse than starting hidden.
- **Adopt Codex's single shared page (drop strips).** Rejected: Codex users are requesting the
  tab model this project already has (openai/codex #23314).
- **Keep the open state global but close it on empty conversations.** Rejected: it still leaks
  the user's explicit close/open across conversations, which is the reported bug.
- **Pop-out windows per conversation** (Codex's parallelism answer). Orthogonal and larger;
  nothing here precludes it.

## Consequences

- An agent whose conversation is hidden browses in its own strip; the user sees the work by
  opening that conversation, and the pane never pops over an unrelated chat.
- Each conversation keeps its own pane state; an untouched conversation shows the full-width
  chat, including at cold start (the e2e's cold-start assertion now pins `requested: false`).
- Surprise browsing is bounded by the transcript, the sidebar running indicator, task-scoped
  ownership, and the unchanged action gates; hidden-view resource use is identical in kind to
  the already-shipped navigate-away-mid-task state.

## Testing

Unit: hidden start lands in the agent's strip without touching the viewer's pane; per-scope
open state does not leak and remembers an explicit close per conversation; shortcut entitlement
follows the per-conversation state; ownership and task-end rules are unchanged. The
real-Electron e2e runs the full suite with the updated cold-start pin and the unchanged
auto-open, splitter, ownership and payment-path assertions.
