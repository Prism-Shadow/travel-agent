# 0001 — Two browser tests that measured the machine, not the code

## What happened

Two browser-backed tests in `browser-cli` failed intermittently for weeks. The pair was expensive
out of proportion to its size: a suite that fails differently on each run cannot answer "did my
change break something", so every red run had to be re-run and hand-classified, and during the
2026-08-19 `src/` layout refactor these two had to be separated from real breakage by hand.

Measured before the fix, on one machine:

| Test file | Result |
| --- | --- |
| `test/screen-recording.test.ts` | 2 of 3 runs failed — always the same test, same assertion |
| `test/relay-navigation.test.ts` | 1 of 5 runs failed — `cross-origin iframe that starts with empty src`, `expected +0 to be 1` |

Both root causes turned out to be the same mistake in two different disguises: **a timer used to
express a state**.

- **`screen-recording`** wanted "a terminal operation is still in flight". It expressed that as a
  server-side `stopDelayMs: 80`, then ran a poll plus an HTTP round trip before asserting that the
  recording entry survived. On a loaded machine the 80ms expires first, the stop completes, the
  entry is released, and the assertion reads 0 — reporting a product bug that is not there.
- **`relay-navigation`** wanted a frame that had "settled". The page under test navigates its
  iframe twice (empty `src` → login → canvas 150ms later), and the test accepted *either* URL. When
  it latched onto the login document, the scripted second navigation replaced that document while
  the assertion counted buttons — again, 0.

## Why nothing caught it

- **CI is a fast path.** Both windows (80ms, 150ms) are comfortable on an idle machine and only
  close under load. Green CI was evidence about the machine, not about the code.
- **The failures looked unrelated.** Different files, different test names, different assertions —
  the pattern reads as environment noise, which is exactly how it was filed.
- **A record can mislead.** The earlier note called the `screen-recording` failure "deterministic";
  measurement showed it passing on an isolated re-run. That word sent the next reader looking for a
  product bug rather than a timing assumption.
- **The right pattern was already in the file.** `screen-recording.test.ts` already had a test
  using an explicit promise gate (`releaseRestore`) for exactly this purpose. The flaky tests were
  written beside it with a timer instead, and nothing flags that as a difference.

## What changed

- `createSuccessfulRecordingHandler`'s `stopDelayMs` is replaced by `stopGate?: Promise<void>` —
  the stop response is held open until the test releases it, so "in flight" is true by
  construction. Both stop-race tests use it; the option that could express a timing hope no longer
  exists.
- `relay-navigation` waits for the **terminal** frame URL instead of accepting the intermediate
  one. Coverage is unchanged — the canvas document is only reachable through the whole empty-src →
  cross-origin sequence.

Measured after: `screen-recording` 4 of 4 runs green, `relay-navigation` 6 of 6 green.

## Not observed

The record also named `restores restricted iframes when all debugger attach retries fail` as a past
failure. It did not appear in 11 runs on the day of the fix. No basis was found for calling it
fixed; it is simply not currently reproducible.

## Links

- Closes `docs/issues/0003-browser-cli-flaky-browser-tests.md` (removed with this change; git holds
  the original).
- Lesson: [`tasks/lessons.md`](../../tasks/lessons.md) — "a timer is not a way to express a state".
