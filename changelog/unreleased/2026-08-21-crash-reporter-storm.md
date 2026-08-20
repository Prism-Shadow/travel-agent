# One popup, one record: the window.open crash fixed at its root, and the reporter that amplified it

Running the Ctrip starter crashed the desktop app (SIGTRAP in `CrBrowserMain`) and left a 9.2 GB
`crashes.jsonl`. Two defects compounded — a popup-adoption contract violation triggered an
uncaught main-process exception, and the crash reporter's own design turned that one exception
into a ~5,000 records/s storm. Both are fixed; the full story is
[postmortem 0002](../../docs/postmortem/0002-popup-adoption-crash-storm.md).

## The trigger: popup adoption violated Electron's createWindow contract

The in-app browser adopts popups as tabs, and `createWindow` always returned a view it had built
itself. Electron 43's `guest-window-manager.ts` pre-creates the popup's `WebContents` when
`window.open()` keeps its opener — every booking site's login window — and then requires
`createWindow` to return exactly that object; anything else is thrown in the main process as
`Invalid webContents`. `target=_blank` links carry implicit `noopener` and take the guest-less
branch, which is why ordinary browsing worked while login popups crashed.

`createWindow` now honours the contract, read from the v43.2.0 source rather than inferred: a
pre-created guest is returned as-is and the tab is rebuilt around it
(`WebContentsView({ webContents })`, the `recoverFromCrash` idiom), keeping the opener handle,
`window.name`, referrer and POST body live; a failed rebuild still returns the guest and closes
it — fail-closed instead of an uncaught exception. The guest-less branch keeps the pre-built
view. Unit doubles now pass `options.webContents` through, and two tests pin the identity
contract and the fail-closed path.

## The amplifier: a crash reporter that fed itself

`installCrashReporting` wrote a report and rethrew on a later tick. Registering the listener
suppresses Node's default fatal handling, and the deferred throw re-entered the same handler —
an infinite loop appending the same line (the log's final 300 KB span 93 ms) that had been
growing through storms since 2026-08-16. During the death, pane teardown measured a destroyed
window, feeding a second exception family into the loop.

- The handler now detaches itself before its single rethrow: one report, then the platform's
  default print-and-exit.
- `fileCrashSink` takes a required `statSync` port and stops appending at a 5 MB cap, logging
  one dropped-reports notice. The 9.2 GB file was sampled to local `artifacts/` and deleted.
- `applyLayout` gained the `disposed` guard its siblings `publishState` and
  `scheduleCheckpoint` already had, plus `window.isDestroyed?.()`.

## The gate: the e2e now opens a real popup

The real-Electron e2e fixture serves a `/popup` page and clicks an opener-carrying
`window.open()`; the runner asserts that nothing was thrown in the main process and that the
popup entered the strip as a live tab with its opener handle intact. Verified in both
directions: the pre-fix code fails the new assertion with the exact production error string, and
the fixed code passes all 23 assertions.

Issue 0007 is closed by this change (file deleted; the number is never reused); the lessons file
carries the two compressed warnings.
