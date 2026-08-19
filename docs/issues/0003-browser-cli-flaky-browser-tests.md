# Two browser-backed tests in browser-cli fail intermittently

- **Status:** open, pre-existing — not caused by the 2026-08-19 `src/` layout refactor
- **Area:** `packages/browser-cli/test/screen-recording.test.ts`, `test/relay-navigation.test.ts`
- **Found:** recorded before the refactor by the session that landed `4a25889`; re-measured 2026-08-19

## Summary

The full `pnpm --filter penguin-browser test` run is not reproducible. Three consecutive runs of the
same tree gave:

| Run | Result |
| --- | --- |
| 1 | 572 passed, 6 skipped, **0 failed** |
| 2 | 2 failed — `relay-navigation` (inline snapshot mismatch) + `screen-recording` |
| 3 | 1 failed — `screen-recording > does not let public status reconciliation release a terminal operation in flight` |

Isolated re-runs: `relay-navigation` passed 2/2; `screen-recording` failed 1, passed 1.

Within `relay-navigation` the *failing test changes between runs* — once
"restores restricted iframes when all debugger attach retries fail", once
"should resolve locators for cross-origin iframe that starts with empty src".

## Prior observation

The session that landed `4a25889` recorded the same thing before any of this work:

> Browser CLI's full legacy suite has one pre-existing deterministic screen-recording test failure
> […] A cross-origin iframe E2E failed once in the full run and passed on isolated retry.

Its "deterministic" reading is not supported by the measurements above — `screen-recording` passed
on an isolated re-run, so it is timing-sensitive rather than deterministic.

## Why it matters beyond the noise

A suite that fails differently on each run cannot answer "did my change break something". During the
layout refactor these two had to be separated by hand from real breakage, using the note above as
the only baseline. CI will either flake or, worse, train everyone to re-run until green — at which
point a genuine regression in these files is invisible.

## Leads, not yet investigated

- `vitest.config.ts` sets `hookTimeout: 600000` because browser suites queue behind a serialized
  extension build (`withExtensionBuildLock`). Contention there plausibly shifts test timing.
- `screen-recording` asserts on `lifecycleState.recordings.size` immediately after an async
  transition — the shape of an ordering assumption rather than a wait.
- The package runs `vitest run --no-file-parallelism`, so the interference is *within* a file or
  through shared external state (a relay port, a browser process), not between files.
