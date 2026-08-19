# A core exec-session test fails when the developer's npm config prints a warning

- **Status:** open, environmental — reproduced 2/2 on one dev machine, not caused by any repo change
- **Area:** `packages/core/test/exec-session.test.ts` — "delivers output arriving while the
  consumer is suspended without waiting out the window"
- **Found:** 2026-08-19, running the full core suite during the spec-citation sweep

## Summary

The test asserts that the **first** output chunk of a spawned command is the command's own marker:

```
AssertionError: expected 'Your user's .npmrc file (${HOME}/.npm…' to contain 'first'
```

On this machine, a warning about the user's `~/.npmrc` arrives in the command session's output
stream ahead of the test's own `first` marker, and the assertion on the first chunk fails. Two
consecutive full-suite runs failed identically; every other test in the file passes, including the
neighbouring "hardens the child env against interactive hangs (editor/credentials/pager)".

## What is and is not established

- Established: the failure text is host-environment output, not test output; nothing in the repo
  emits it; the test passes on machines whose npm stack prints no warning (CI has been green).
- Not established: which component prints the warning (npm, pnpm, corepack, or a shell hook
  reacting to `.npmrc` contents) — no basis found yet; the emitter needs to be pinned before
  choosing a fix.

## Why it matters beyond one machine

The suite already hardens the child environment against editors, credential prompts and pagers —
this failure shows the hardening has a gap for *startup chatter*: any host whose shell or package
manager prints one line on spawn breaks every first-chunk assertion. A contributor on such a
machine cannot tell this failure from real breakage (the same trap as issue 0003).

## Fix directions (pick after pinning the emitter)

1. Assert on "the marker appears in the stream" rather than "the first chunk equals the marker",
   for this test only — smallest change, keeps the timing property being tested.
2. Extend the child-env hardening to silence the emitter, once it is identified.

## Repro

```bash
pnpm -C packages/core test exec-session
# on a machine whose npm stack warns about ~/.npmrc on startup
```
