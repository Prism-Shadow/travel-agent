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

## Prior art — Codex (snapshot
[2026-08-21](../research/2026-08-21-codex-browser-conversation-model.md))

Codex has no analog of this gate. Its browser is "a shared view inside a chat" (a single
visible page today — users are requesting tabs); its safety interposition is per-site approval
and per-action confirmation, not "your thread must be on screen"; and its cloud browser runs
agent browsing with no live pane at all, delivering visibility as screenshots and a replay in
the transcript. Pop-out windows also mean "which conversation is visible" has no single answer
there.

## Status update (2026-08-21, later)

Two further changes narrow this issue:

- **The only identified silent-skip is closed.** `applySessionSwitch` used to skip the
  announce entirely when the hide was unconfirmed — the exact shape that leaves main one
  conversation behind while the renderer moves on. It now always announces (main tracks
  truth) and only withholds the *confirmation*; two scope tests pin the new contract.
- **The transition is logged.** `setActiveSession` logs `active session <prev> -> <next>`,
  so the next occurrence convicts or clears the remaining candidates from the desktop log
  alone. Repro protocol: run `pnpm desktop`, then draft → send → New Chat → send while an
  agent opens tabs, and read the transition lines around any refusal.

If the lag never reproduces after the announce fix, the silent-skip was the writer and this
issue closes; the log is the arbiter either way.

## Status update (2026-08-21)

Direction 2 shipped: the visibility gate is retired
(`docs/decisions/implemented/2026-08-21-agent-tabs-follow-conversation-not-screen.md`), so this
bug no longer locks agents out — its remaining damage is a late strip render. Direction 1 (pin
the stale writer with a transition log) remains open; this issue now tracks only that
correctness bug.

## Status update (2026-08-27) — the class is closed; the writer is still not pinned

The writer was never found, and the fix stopped depending on finding it.

What static analysis established: `activeSession` has exactly two writers, `setActiveSession` and
`reassignActiveSession`, both driven from the renderer over IPC, and no path through today's code
produces a stale write. What it also established is why that search could never have been
conclusive: **main had no ordering knowledge at all.** The renderer numbered its switches — but only
to decide which *reply* to believe; the number was never sent. Main, which holds the state that gets
corrupted, applied whatever arrived last.

Both recorded symptoms were then reproduced at the unit level, which had not been done before:

| Sequence | `activeSession` afterwards |
| --- | --- |
| promote `draft-scope-aaa` → `session-B`, then a late announce naming the draft scope | `draft-scope-aaa` |
| `session-A` → draft → promote to `session-B`, then a late announce naming `session-A` | `session-A` |

Those are the two rows of the table at the top of this issue, produced on demand. So whatever sent
the late announce, it was permitted — and the fix is to stop permitting it rather than to keep
hunting the sender.

**The stamp.** The renderer's switch sequence is now sent with each announce, and main refuses one
older than the stamp it last applied. The sequence moved out of the hook and into the scope module
so it survives a remount; a stamp from a different epoch is a new document and is adopted wholesale,
because refusing it would leave the pane stuck on the old conversation for the rest of the run.
Refusals are logged, so if a late announce is still being sent, the log now names it.

Four tests pin this in `packages/desktop/test/browser-pane-behaviour.test.ts`; the two symptom tests
were confirmed red against the un-stamped code before the guard landed. The contract is in
[`packages/desktop/SPEC.md`](../../packages/desktop/SPEC.md).

## Closed (2026-08-30)

The original correctness question — *which* code path sent an announce out of order — was never
pinned, and no longer needs to be. The stamp guard makes the state unrepresentable: all 877
desktop tests pass (including the 4 stamp-guard tests in `browser-pane-behaviour.test.ts`),
and the refusal log has not fired since the guard shipped. The class is closed.

Direction 2 below shipped on 2026-08-21 and is recorded for context.

## Fix directions (historical)

1. Fix the lag itself (once the writer is pinned) — superseded: the class was closed without
   pinning it, by moving the ordering guard to the side that holds the state.
2. Product decision: let an agent open tabs into its own conversation's non-displayed strip
   (visible immediately on switching back, plus a sidebar cue), reserving the hard refusal for
   the case the strip model genuinely cannot represent. **Shipped 2026-08-21.**
