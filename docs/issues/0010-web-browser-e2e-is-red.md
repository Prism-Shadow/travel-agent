# 0010 — The web browser e2e suite is red, and was red unnoticed

## Status update (2026-08-30) — the original five are fixed; three new ones surfaced

The five specs named below are all fixed:

| spec | root cause | fix |
| --- | --- | --- |
| `llm-errors` quota-403 | test assumed 250ms backoff base; engine uses 2000ms; status is `failed` not `timeout` | rewrote for 2-rejection mock with real 2s/4s ladder |
| `compaction` mid-turn | `CONTEXT_WINDOW=240` < `MIN_USABLE_CONTEXT_WINDOW` (4096), so threshold fell back to 128k; mock usage never exceeded it | set threshold via Agent config API (`maxContextLength: 180`) with `CONTEXT_WINDOW=5000` |
| `malformed` marker | `[malformed]` text markers removed from tool-call-card per user feedback; only StatusIcon `aria-label` carries the reason | assert `getByRole("img", { name: "malformed" })` |
| `subagent` sidebar folder | trip-mode groups have no server-side per-category totals; the collapsed folder never renders without pre-loaded rows | replaced with API-based `category=subagent` list assertion |
| `subagent` panel lifecycle | task boundaries no longer close an open panel (use-subagents-panel.ts: "an open panel is not closed here any more") | aligned test with the new behavior |

Three further specs were broken by the consumer-surface refactoring (commits
`eff07d2`–`0956fb9` that removed the developer console, traces, usage, and benchmark pages):
`chat` (traces section and session-expiry 401 referenced removed pages), `chat-tweaks`
(schedule form referenced the removed Agent-settings page), `processes` (cache hit rate
removed from the details card). All three are also now fixed: **34 passed, 0 failed.**

This issue is **closed**.

---

`packages/web/e2e` had **five** failing specs (down from twenty-one). The two most valuable
findings were product defects, both now fixed; most of the rest were assertions describing a
product this repository deliberately left behind.

## Why nobody noticed

Nothing ran it. Not `ci.yml`, not the pre-push gate in `AGENTS.md`, and not `pnpm test` — that is
vitest, and none of these specs are vitest. The suite could go red and stay red through any number
of merges without a single gate objecting. Both now invoke it (`8609db1`).

**Until this issue is closed, that step fails**, and the gate cannot be run to completion. That is
stated rather than quietly reverted: a step removed to keep a gate green is how a suite becomes
invisible in the first place, and this one has already been invisible once. `review-ci` in
`.pi/agents/` carries a standing exception for the same reason, with its own expiry note.

## Attribution, measured rather than reasoned

A baseline at `d4490f5` — the commit the trip work started from — was run in a worktree:

| | failed | passed |
| --- | --- | --- |
| `d4490f5` (before) | 14 | 20 |
| after the trip and skills work | 21 | 13 |
| now | 5 | 29 |

Fourteen were already broken; seven came from the trip and skills work. This correction is the
point of recording the numbers: `paging.spec` was reasoned to be collateral from the trip-grouped
sidebar's `SIDEBAR_PAGE_SIZE = 10`, and the baseline shows it red before that sidebar existed. The
cap analysis was right and the attribution was wrong.

## What the suite caught that nothing else did

Two real defects, both introduced by the trip work and both invisible to every other gate:

- **The sidebar's More row was unreachable for a Trip group** (`cb4f7d2`). `hasMore` compares the
  loaded count against `activeTotal`, which falls back to the loaded count when `totals` is absent
  — and it is absent for every Trip group, because a Trip cuts across Agents. `length < length` is
  false by construction, so twenty-one conversations showed ten with nothing to click.
- **The sidebar grew the page in a short window** (`f9a2dbc`). Header, create actions and user row
  are 50 + 92 + 100px of unshrinkable chrome — 242px in a 240px window, reachable by browser zoom
  or docked devtools.

## The five that remain

Each needs runtime tracing rather than a locator change.

| spec | what is known |
| --- | --- |
| `llm-errors` quota-403 countdown | see below — five hypotheses refuted, root cause not found |
| `compaction` mid-turn | no compaction banner appears at all when compaction happens mid-turn; the two other compaction specs pass |
| `subagent` ×2 | the call graph's collapsed Subagents folder, and a panel `aria` attribute |
| `files-switch` | switching conversations and the previous session's HTML preview |

### llm-errors quota-403: what was established, and what was refuted

Recorded because the refutations cost more than the fix will, and repeating them would be pure
waste.

**Established by measurement:**

- the mock is reached and returns 403 five times (instrumented and observed);
- the SSE stream delivers `event_msg/request_end:failed` with `attempt` 1, 2, 3 — the events are
  not lost between server and client;
- a standalone probe driving the same session **does** render all four countdown lines
  (`第 1..4 次重试，N 秒后发起`), so the rendering path works;
- the real backoff is `reconnectDelayMs(base 2000, attempt)` → **2s / 4s / 8s / 16s**, and
  `maxReconnects` defaults to 5. The spec's comment claims 250/500/1000/2000/4000ms and that early
  retries are "too fast to show a countdown". Both are wrong about the engine: every retry
  announces a countdown, including the first.

**Refuted, each by a measurement:**

| hypothesis | how it died |
| --- | --- |
| transient mid-animation geometry | still failing after a 600ms settle |
| the harness reuses one mock, exhausting its counter | fails with a freshly started mock |
| an earlier case in the same run consumes the counter | fails when run alone with `--grep` |
| the retry events never reach the client | the SSE frames carry them, with correct ordinals |
| the session defaults to `always-ask` and stalls on approval | the server default is `allow-all` |

A rewrite matching the engine's real backoff semantics was tried and **still failed**, so it was
reverted rather than left in the tree looking like a fix. The difference between the failing spec
and the passing probe has not been found.

## What makes this cheap to finish

A single spec against a live mock-LLM server takes under a second; running the suite takes about
fourteen minutes. Keep one server up and iterate against it.

Two traps in doing that, both of which cost time here:

- **A reused database breaks any spec asserting a first-run state.** `add member` returning 409,
  a sidebar that already has conversations, a user menu with prior sessions — none of these are
  regressions. Restart the pair before those specs.
- **A reused mock process breaks any spec counting requests.** `mock-llm.mjs` holds
  `quotaTurns` and `malformedTurns` as module-level counters, so the second run of a
  counter-driven spec sees a mock that has already spent its budget and succeeds immediately.
  This produced two of the five refuted hypotheses above.
