# 0008 — The pane's active session lags one conversation behind, so every fresh chat's agent is refused tabs

Two consecutive conversations (2026-08-21 01:48:42 and 01:49:05, traces on disk) asked the
in-app browser for tabs and were refused with `IAB_SESSION_NOT_VISIBLE`, each time with the pane
reporting a *stale* displayed conversation — exactly one station behind reality:

| Agent asking | Pane said it was showing |
| --- | --- |
| session A (01-48-42) | A's own draft scope (`draft-scope-c03b9a6f…`) |
| session B (01-49-05) | A |

The user was demonstrably viewing the asking conversation both times (they were reading its
transcript). The agent then asks the user to "switch to this conversation" — which they are
already on. Repeated retries by starting a new chat reproduce the failure, shifted by one.

## What is pinned

- The refusal itself is the deliberate Phase-1 visibility gate
  (`browser-pane.ts openTabForAgent`: `activeSession !== sessionId` → throw).
- The send flow orders correctly (`draft-view.tsx`: createSession → promote scope → postTask →
  navigate), and promotion (`reassignActiveSession`) sets `activeSession` to the new session on
  success. A successful designed path cannot produce the observed state.
- For session A the promotion evidently did not complete (pane still on the draft scope when
  A's agent asked); for B the pane held A, so *something* wrote A after B's promotion should
  have written B.

## What is not pinned — no basis found yet

The final writer of the stale value. Static analysis eliminated the designed renderer paths
(`use-browser-pane` layout effect announces on every scope change with an ordering counter;
`applySessionSwitch` skips superseded announces; `iab:set-session` applies synchronously).
`setActiveSession` has no log line, so the desktop's stdout cannot answer it retroactively.
Next step: add a transition log to `setActiveSession` / `reassignActiveSession` failure paths
and replay draft → send → new chat → send while watching main's log.

## The design question underneath

The gate's comment justifies refusal with "a tab created for conversation A while the user is
reading conversation B appears in no strip at all" — but that premise predates per-conversation
strips: today tabs live in their conversation's own strip (`activeByScope`, dormant
materialization), and the same comment concedes that a *running* task keeps working after the
user navigates away. Starting hidden is representable now; only starting is banned. When the
gate misfires (this bug), the agent's only recourse is asking the user to be where they already
are.

## Fix directions to decide

1. Fix the lag itself (once the writer is pinned) — necessary regardless.
2. Product decision: let an agent open tabs into its own conversation's non-displayed strip
   (visible immediately on switching back, plus a sidebar cue), reserving the hard refusal for
   the case the strip model genuinely cannot represent. This dissolves the entire failure class
   rather than the one writer.
