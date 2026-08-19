# A conversation's pages come back when you open it, and the restore prompt is gone

The in-app browser used to greet a new run with *"The last run left 7 pages open — Reopen them /
Discard"*. Answering it reopened three. The other four were real and undamaged; they belonged to
four other conversations, and the tab strip only ever shows the conversation you are in.

That was not a counting bug. **The prompt was global state acting on conversation state**, and every
symptom followed from that one mismatch:

- The count came from the whole checkpoint while the view was filtered by scope, so the number and
  the result could not agree.
- The prompt rendered in whichever conversation happened to have no tabs — **including a brand-new
  one**. Answering it there reopened seven pages into five other conversations, left the current one
  empty, and consumed the offer. The user saw a button that did nothing.
- Accepting built every view at once, so conversations nobody was looking at each got a renderer
  process, hidden behind `HIDDEN_LAYOUT`.
- The file accumulated: the checkpoint that produced this report held tabs from five conversations
  spanning five days.

## What replaced it

A tab is conversation state — the same kind of thing as the message list, which nobody is asked
whether to restore. So the pages of a conversation are materialized **when that conversation is
opened**, and at no other time:

- No prompt, no count, no accept/discard, and nothing restored at launch.
- Opening a conversation is both the trigger and the consent, and it is a more precise consent than
  a global yes/no: you can see which conversation you are entering.
- A conversation nobody opens costs nothing.

Design/002 §6.4's concern — that reopening a batch of booking pages unasked re-enters flows the user
may have abandoned, and produces traffic that reads as automation — is **better served** by this than
by the prompt: nothing reopens until the user deliberately navigates to the conversation that owns
those pages. The concern was right; the mechanism it chose was wrong for the state model the code
already had, where 23 sites in `browser-pane.ts` scope everything else by `sessionScope`.

## What this deleted

`restorable`, `restore()`, `discardPendingRestore()`, `promoteCrashedCheckpoint()`,
`mergeCheckpoints()`, `pendingRestoreCount()`, the `pendingCheckpoints` store and its `.pending`
file, `liveCheckpointsSuspended`, the `iab:restore` IPC channel, the preload and bridge methods, the
`BrowserRestorePrompt` component, and eight product strings in both locales — about 250 lines across
ten files in three layers. All of it existed to track four states: did the last run crash, was the
user asked, did they answer, and did the copy-aside succeed. None of those questions exists now.

The checkpoint is also no longer cleared on shutdown. It was cleared so that finding it next launch
would mean "the previous run crashed"; nothing asks that question any more, and a conversation's
pages should be there whether the app quit cleanly or was killed.

## The trap that came with the new model

A checkpoint written from open tabs alone deletes the pages of every conversation this run has not
visited. Unopened entries are held in memory and written back out with the live tabs on every
checkpoint, and there is a test for exactly that: open one conversation, close its tab, and the other
conversation's page must still be on disk. Clearing the browser profile drops them deliberately —
they were signed in with the profile that was just wiped.

Verification: desktop 873 tests and web 819 tests pass, both typechecks clean, the app builds and
launches. `packages/core`'s two `exec-session` timing failures are pre-existing — confirmed by
running that file on a stashed tree.
