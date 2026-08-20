# 0002 — One popup, one crash, 9.2 GB: the reporter amplified what it recorded

## What happened

Running the Ctrip starter on 2026-08-21 ~00:04, a `window.open()` login popup killed the desktop
app (SIGTRAP in `CrBrowserMain`) and left a 9,256,697,524-byte `crashes.jsonl`.

Two defects compounded. The in-app browser adopts popups as tabs, and its `createWindow`
callback always returned a view it had built itself; Electron 43's `guest-window-manager.ts`
pre-creates the popup's `WebContents` when the opener is kept, and requires `createWindow` to
return exactly that object — anything else is thrown in the main process as an uncaught
`Invalid webContents`. The crash reporter then handled that `uncaughtException` by writing a
report and rethrowing on a later tick: with its listener attached, Node's default fatal handling
stayed suppressed, and the deferred rethrow re-entered the same handler — an infinite loop
appending the same line at ~5,000 records/s (the log's final 300 KB span 93 ms). The file had
been growing through repeated storms since 2026-08-16. A third defect surfaced during the death:
pane teardown (`destroy → destroyTab → forgetTab → applyLayout`) measured a destroyed window,
feeding "Object has been destroyed" into the same loop.

## Why nothing caught it

- **The failure-surfacing machinery was the amplifier.** The reporter existed to make crashes
  visible; its record-then-rethrow design instead suppressed the platform's own fatal handling
  and converted one exception into a silent, unbounded file in a gitignored user directory.
  Nothing measured the file; nothing rotated it; nothing exited.
- **The unit doubles could not express the bug.** Every test invoked `createWindow()` with no
  arguments — the mock world had no concept of a Chromium-pre-created guest, so the identity
  contract was untestable there and its violation invisible.
- **The strongest gate had no popup.** The real-Electron e2e exercised `tabs.open`, snapshots
  and clicks, but never a `window.open()` that keeps its opener — the exact shape of every
  booking site's login window.
- **The common path masked the broken one.** `target=_blank` links carry implicit `noopener`
  (Chromium ≥ 88), taking the guest-less branch that worked; only opener-carrying popups hit the
  broken branch, so days of successful browsing coexisted with bursts of storming.

## What changed

- `createWindow` honours the contract, read from the v43.2.0 source rather than inferred: a
  pre-created guest is returned as-is and the tab is rebuilt around it
  (`WebContentsView({ webContents })`, the `recoverFromCrash` idiom); a failed rebuild still
  returns the guest and closes it — fail-closed instead of an uncaught exception. The guest-less
  branch keeps the pre-built view.
- The reporter records once, detaches, then rethrows into the platform default; the sink stops
  at a 5 MB cap. One crash, one line, one honest exit.
- `applyLayout` gained the `disposed` guard its siblings already had.
- The e2e fixture now serves a popup and clicks an opener-carrying `window.open()`; the runner
  asserts no main-process throw and live adoption. Verified in both directions: the pre-fix code
  fails the new assertion with the exact production error, the fixed code passes all 23.

## Links

- Fixing change: [2026-08-21 crash-reporter and popup-adoption entry](../../changelog/unreleased/2026-08-21-crash-reporter-storm.md)
- Compressed warnings: [tasks/lessons.md](../../tasks/lessons.md) — the `uncaughtException`
  detach rule, and doubles that accept fewer arguments than the real caller passes
- Closed issue: `docs/issues/` 0007 (deleted with this change; the number is never reused)
