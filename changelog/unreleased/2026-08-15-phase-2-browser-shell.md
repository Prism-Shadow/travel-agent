# Phase 2: the pane becomes a browser, and a tab learns who it belongs to

Phase 1 put one live page in the right half of the window. Phase 2 makes it a browser: a tab strip
we draw ourselves, an address bar, back and forward, the keyboard shortcuts a browser has — and,
underneath all of it, an answer to a question the previous phase could avoid with a single view.
**Whose tab is this?**

At this checkpoint the pane was still off by default. The startup default was later superseded:
current Desktop builds enable and open the IAB automatically, while `chrome.fallback` still gates
offering the user's own Chrome as an alternative.

## The question that had no answer

A tab is opened by a *task* — one turn of a conversation — and stops being writable when that turn
ends, while staying visible in the conversation it belongs to. Two different lifetimes, so two
identifiers. The repository had neither.

There was no per-run identifier anywhere: core minted a Session id and nothing below it, the server
tracked a running turn as a status flag and an `AbortController` keyed by session id, server events
carried no run id, and the only thing called a "task" was an integer derived afterwards by
re-scanning a trace file. So the contract was completed rather than faked: a Task id minted where a
task is *accepted* — queued work included, so a caller can name a turn before it starts — carried
through `Session.run`, bracketed around the turn, injected into the environment of every command the
Agent spawns, and travelling from there through the CLI and the relay to the tab it opens.

Two details are worth stating because both were changed after review. A goal run is **one** task, not
one per round: rounds are core's own subdivision and no host ever sees them, so per-round ids
produced ownership nothing could ever release. And there is deliberately **no `--task-id` flag** —
the process running that command is the agent, and a flag would let it name any owner it liked,
including a turn that has ended and whose pages now belong to the user.

## Ownership that is enforced rather than displayed

`ownedByTask` started as a field the tab strip rendered. That is not enough, and the reason is the
whole point of the feature: **a retained tab stays alive on purpose**. Nothing else refuses a write
to it — the executor is still connected, the CDP session is still valid, the page is still there.

So it is checked in three places, each answering something the others cannot. The relay refuses a
call from a task that does not own the browser session, because relay session ids are small integers
that outlive the turn that created them. The shell refuses a command whose task no longer owns the
page it reached, with a code the agent can act on — `IAB_TAB_RELEASED` means *claim it or open your
own*, `IAB_TAB_FOREIGN` means *that is someone else's*. And a tab is opened or claimed only for a
turn the harness says is running, so a background command still holding that turn's environment
cannot quietly open new tabs under a name that was genuine when it was issued.

The two registries — the relay's concurrency claims and the shell's task ownership — stay separate,
as they must, and are kept in step by a reconciliation contract instead of a stream of
notifications: every target announcement carries the shell's full statement of who holds the page,
restated on every reconnect. A message lost while the socket was down costs nothing.

## Conversations cannot see each other

One shell serves every conversation over a single backend connection, which meant every Playwright
client could see every conversation's targets — their URLs and titles — before any ownership check
ran. Each client now carries its conversation, each target carries its scope, and the relay filters
initial target lists, live target events, *every* other backend event by the session it was routed
through, and the root operations that would otherwise pick another conversation's page at random.
Child frames inherit their page's scope; a scoped client fails closed on anything it cannot
attribute. Extension and direct connections are untouched.

## The four tab-lifecycle rules, running

A read-only turn closes its tabs. A turn that left an order, or stopped on a payment page, keeps
them. A failure keeps them, because the scene is the evidence. A tab the user marked "keep" is never
closed by any of it. The agent declares which case it was when it closes its browser session — it is
the only party that knows — but the rules run at the harness's own end-of-task boundary, so an abort
after the declaration overrides a `read_only`, including the kind of failure that never throws: core
converges a rejected credential into the message stream, and reading that as a clean run would have
closed the evidence of it.

A crashed renderer rebuilds that tab and only that tab. `killed` counts as a crash — it is what the
OOM killer reports, which is exactly when a user wants their page back. A crashed *app* offers the
pages back on the next launch and reopens nothing until asked; that offer now survives opening new
tabs before answering, and survives closing the window without answering, because it lives in its
own file rather than in the checkpoint that is rewritten on every navigation.

## The rest of the browser

Tabs, address bar with real URL completion and refusal, back/forward/reload/stop, a visible and
retryable failed load. Popups are **adopted** rather than re-navigated — Electron 43 lets the shell
hand Chromium a view of its own as the real child — so a `target=_blank` search keeps its POST body
and referrer, and `window.open()` followed by assigning `location` works. Shortcuts live in one
routing table that main applies on both focus paths, because focus can be inside a page where the
renderer sees nothing.

Overlays get a reference-counted coordinator rather than a boolean, since they nest; all eight
portal and full-screen components are wired, and a dropdown in the left column no longer blinks the
browser. Downloads land in the conversation's own scratchpad — the directory the agent already reads,
deleted with the conversation — with the site's filename sanitised and a second file of the same name
kept beside the first rather than over it. "Clear browser data" clears storage *and* the HTTP cache
*and* cached credentials, because anything less is not a sign-out; it clears before closing anything,
so a failure costs neither. The browser backend is chosen per conversation, held shut while that
conversation has a task running, and honestly marked unavailable when this run cannot reach it.

Two things the browser has to get right when nobody is watching it, and both come down to the same
question: **who says a turn is running?** Not the renderer. It disposes its stream when you change
conversation, it takes its bookkeeping with it when it reloads, and a stale frame asserting a turn
is alive is exactly the authority a leftover background command is reaching for.

So the main process asks the server, on a loop, about the conversations it holds tabs for, and
applies the answer. A turn that finishes while you are reading something else still releases its
tabs. A turn that has ended cannot open another. There is no queue to lose and no acknowledgement to
miss: a failed poll changes nothing and the next one asks again — which is also why an answer it
cannot fully understand is refused rather than read as "nothing is running", since that reading
would release the tabs of every turn in progress.

The same principle settled two other things. Where a conversation's downloads go is the server's
answer, not the renderer's — and it is re-checked, through the filesystem rather than by comparing
strings, at the moment the file is written, because a path that was inside the data root when it was
worked out can be a link somewhere else by the time it is used. And the two commands that hand a tab
to a task now take the conversation and task from the connection they arrived on, so one agent
session cannot open tabs as another's live turn.

Full record, including seventy-five defects found and fixed in the working tree:
`docs/verification/phase-02.md`. The human half is `docs/manual-testing/phase-02-browser-shell.md`,
entirely PENDING.
