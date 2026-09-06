# Agent Note: Context compaction is automatic; the product has no `/compact`

Status: implemented.

## Problem

The composer inherited a `/compact` slash command from PenguinHarness: a person types it to
summarise the conversation's context and free the model's window. That is a developer's control.
A traveller planning a trip has no model of "context", no way to know when it is nearly full, and
no reason to be handed a command whose wrong use — compacting mid-plan — loses detail the agent
was relying on. The engine already decides this on its own: core compacts when usage reaches its
configured threshold (`compaction.max_context_length`, 128k by default, capped below the model's
window) and reports what it did through the same banner.

## Decision

The product exposes no manual compaction. The `/compact` command, its callback plumbing and its
API call are removed from the web surface; the slash menu offers only an active Session's switch
commands (`/model`, `/agent`), and a draft — which has neither — opens no menu on `/`. Automatic
compaction is unchanged and stays visible: the stream renders the banner where the engine
compacted, so a person can see that it happened and whether it succeeded.

The server's `POST /api/sessions/:id/compact` stays. It is part of the pinned engine baseline
(Hard Rule 3), it is tested there, and nothing on this surface calls it; removing it would be an
opportunistic edit to the engine for no product gain.

## What this gives up

- A person cannot force a fresh context before a long new task. The engine's threshold is the
  only trigger. If that proves too late for a real travel session, the lever is the threshold in
  the Agent's compaction settings, not a command.
- Two browser tests that existed only to exercise the manual path are gone: `compact-abort` (both
  cases were about `/compact` feedback) and the "manual `/compact` between turns" case in
  `compaction.spec`. The automatic path keeps its end-to-end case, and stream-model's unit tests
  keep the reason-based ordering rules for `manual` as well, since the API still emits it.

## Alternatives considered

- Keep `/compact` but hide it behind an advanced setting: a control that must be explained is a
  control the product has failed to make unnecessary.
- Add a visible "free up space" button when the context ring nears full: the engine already acts
  at that point; a button would race it.

## Consequences

GitHub #8 listed the manual-compaction browser test among its load-sensitive cases; that case no
longer exists. The browser-cli cases in the same issue are unaffected by this decision.

## Testing

Web typecheck; the web browser suite with `compact-abort.spec` removed and `draft.spec` asserting
that `/` in a draft opens no menu and stays as text; the automatic-compaction case in
`compaction.spec` unchanged.
