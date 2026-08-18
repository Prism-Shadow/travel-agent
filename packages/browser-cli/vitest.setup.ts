import os from 'node:os'
import path from 'node:path'

/**
 * Vitest setup - handles Playwright CDP disconnect race condition.
 *
 * ROOT CAUSE (from Playwright source crConnection.ts:164):
 *
 *   _onMessage(object: ProtocolResponse) {
 *     if (object.id && this._callbacks.has(object.id)) {
 *       // Handle response with matching callback
 *     } else if (object.id && object.error?.code === -32001) {
 *       // Closed session error - ignore
 *     } else {
 *       assert(!object.id);  // ← FAILS: expects event, got orphaned response
 *     }
 *   }
 *
 * WHY IT HAPPENS:
 * 1. Relay sends CDP response to Playwright
 * 2. Playwright's messageWrap() schedules _onMessage for next task
 * 3. browser.close() is called
 * 4. _onClose() fires IMMEDIATELY and clears callbacks via dispose()
 * 5. Scheduled _onMessage finally runs
 * 6. Looks for callback → NOT FOUND → assertion fails
 *
 * This is a race condition in Playwright's async message handling that we cannot
 * fix without patching Playwright. The assertion error during disconnect is benign
 * and expected - it just means a CDP response arrived after we stopped caring.
 *
 * See: https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crConnection.ts
 */

/**
 * A CDP log file per worker, so suites cannot erase each other's.
 *
 * `createCdpLogger` opens its file with `fs.writeFileSync(path, '')` — it *truncates*. The default
 * path is one shared `cdp.jsonl`, and vitest runs test files in parallel worker processes, each
 * starting its own relay on its own port. So every suite that came up wiped the log another suite
 * was in the middle of writing, and the tests that read it back (download events, dialog
 * de-duplication) saw their earliest lines gone while later ones survived — a failure that moved
 * between suites from run to run and never reproduced when a file was run alone.
 *
 * Set here rather than in the relay because `LOG_CDP_FILE_PATH` in utils.ts is a module-level
 * constant read from this variable at import time, and setup files run before the test module
 * graph is loaded. That ordering is what makes the relay and the test that reads its output agree
 * on one path.
 */
if (!process.env.PENGUIN_BROWSER_CDP_LOG_FILE_PATH) {
  const worker = process.env.VITEST_WORKER_ID ?? String(process.pid)
  process.env.PENGUIN_BROWSER_CDP_LOG_FILE_PATH = path.join(
    os.tmpdir(),
    `penguin-browser-cdp-${process.pid}-${worker}.jsonl`,
  )
}

process.on('unhandledRejection', (reason: any) => {
  // Check if this is Playwright's CDP disconnect assertion error
  if (reason?.message === 'Assertion error') {
    const stack = reason?.stack || ''
    if (stack.includes('crConnection.js') || stack.includes('crSession')) {
      // Benign race condition during disconnect - suppress
      return
    }
  }

  // Re-throw other unhandled rejections to fail the test
  throw reason
})
