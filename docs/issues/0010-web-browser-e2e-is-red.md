# 0010 — The web browser e2e suite is red, and was red unnoticed

`packages/web/e2e` has nineteen failing specs. Two of the original twenty-one were fixed when the
suite was added to the gate; the rest are deferred.

## What is broken

Almost nothing in the product. The specs assert an older product — the one that existed before the
sidebar became a list of trips and the engine's console moved behind a settings row. A spec that
expects seven entries in the collapsed rail is not reporting a defect; it is describing a design
this repository deliberately left behind.

That is not a reason to leave them red. A suite that fails everywhere cannot say when something
real breaks: the alarm is already sounding, so nobody looks at one more red line.

## Why nobody noticed

Nothing ran it. Not `ci.yml`, not the pre-push gate in `AGENTS.md`, and not `pnpm test` — that is
vitest, and none of these specs are vitest. The suite could go red and stay red through any number
of merges without a single gate objecting.

Both now invoke it (`8609db1`). **Until this issue is closed, that step fails**, and the gate
cannot be run to completion. That is stated here rather than quietly reverted: a step removed to
keep a gate green is how a suite becomes invisible in the first place, and this one has already
been invisible once.

## Attribution, measured rather than reasoned

A baseline at `d4490f5` — the commit the trip work started from — was run in a worktree:

| | failed | passed |
| --- | --- | --- |
| `d4490f5` (before) | 14 | 20 |
| at the time of writing | 21 | 13 |

Fourteen were already broken; seven came from the trip and skills work. This correction is the
point of recording the numbers: `paging.spec` was reasoned to be collateral from the trip-grouped
sidebar's `SIDEBAR_PAGE_SIZE = 10`, and the baseline shows it red before that sidebar existed. The
cap analysis was right and the attribution was wrong.

## The remaining nineteen

| spec | first failure |
| --- | --- |
| `chat` | click times out |
| `compact-abort`, `compaction` ×2 | a locator never becomes visible |
| `draft`, `draft-park`, `draft-user-scope` | draft screen; likely the new `draftInputPlaceholder` |
| `layout` ×4 | overlap at 390px, pinned sidebar at 240px, two timeouts |
| `llm-errors` ×2 | locator not visible; a `toContain` on `undefined` |
| `malformed` | the malformed marker is not visible |
| `paging` | expects 20 rows, gets 10 |
| `project-switch` | a locator never becomes visible |
| `subagent` ×3 | collapsed folder, an attribute, a draft-flow timeout |

Each needs its own diagnosis: some are stale assertions, and the ones that were already red at
`d4490f5` have not been diagnosed at all.

## What makes this cheap to finish

Running the suite takes about fourteen minutes; a single spec against a live mock-LLM server takes
under a second. Keep one server up and iterate against it rather than re-running `run.sh` per
attempt. The specs that assert a first-run state — an empty sidebar, no sessions yet — need a fresh
data directory, so restart the pair before those rather than reusing a seeded one.
