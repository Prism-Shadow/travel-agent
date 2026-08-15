/**
 * Runs the in-app browser end-to-end check and asserts on what it printed.
 *
 * Kept out of vitest deliberately: the subject is an Electron main process, which has to be the one
 * that starts. This script builds what the harness imports, launches Electron (under Xvfb on a
 * headless Linux box), and turns the `E2E {json}` lines into pass/fail.
 *
 *   pnpm --filter @prismshadow/penguin-desktop test:e2e
 *
 * On a developer machine that cannot host a window at all — no display and no Xvfb — it skips with
 * exit 0, because that is a missing environment rather than a broken product. **In CI it never
 * skips**: a gate that goes green because it did not run is worse than no gate, so a missing
 * Electron or a missing display there is a failure.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkExitStatus } from "./exit-status.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const electron = path.join(pkgDir, "node_modules", ".bin", "electron");

function fail(message) {
  console.error(`iab-e2e: ${message}`);
  process.exit(1);
}

/** True on GitHub Actions and most other runners. */
const inCi = process.env.CI === "true" || process.env.CI === "1";

/** Skips locally, fails in CI — see the header. */
function unavailable(reason) {
  if (inCi) fail(`${reason}. In CI this is a failure: the gate must run, not pass by default.`);
  console.log(`iab-e2e: ${reason}; skipping`);
  process.exit(0);
}

if (!fs.existsSync(electron)) unavailable("electron is not installed here");

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const xvfb = spawnSync("which", ["xvfb-run"], { encoding: "utf8" }).status === 0;
if (process.platform === "linux" && !hasDisplay && !xvfb) {
  unavailable("there is no display and no xvfb-run");
}

// The harness imports the pane and transport as modules. The app's own bundle is a single entry, so
// build the two it needs into a throwaway directory that is git-ignored.
console.log("iab-e2e: building modules under test");
execFileSync(
  path.join(pkgDir, "node_modules", ".bin", "tsup"),
  [
    "src/browser-pane.ts",
    "src/iab-transport.ts",
    "--format",
    "esm",
    "--target",
    "node22",
    "--platform",
    "node",
    "--external",
    "electron",
    "--out-dir",
    "dist-e2e",
  ],
  { cwd: pkgDir, stdio: "inherit" },
);

const harness = path.join(here, "iab-e2e.cjs");
const command = process.platform === "linux" && !hasDisplay ? "xvfb-run" : electron;
const args = process.platform === "linux" && !hasDisplay ? ["-a", electron, harness] : [harness];

console.log("iab-e2e: running");
const result = spawnSync(command, args, { cwd: pkgDir, encoding: "utf8", timeout: 300_000 });
const stdout = result.stdout ?? "";

// Before any step is read. Electron can print everything and then die on teardown, and a runner
// that only inspects the steps would call that a pass.
const exit = checkExitStatus({
  error: result.error,
  status: result.status,
  signal: result.signal,
  stderr: result.stderr,
});
if (!exit.ok) fail(exit.message);

const steps = new Map();
for (const line of stdout.split("\n")) {
  if (!line.startsWith("E2E ")) continue;
  const parsed = JSON.parse(line.slice(4));
  steps.set(parsed.step, parsed);
}

if (steps.has("fatal")) fail(`harness threw: ${steps.get("fatal").error}`);

const expect = (step, predicate, description) => {
  const value = steps.get(step);
  if (!value) fail(`step "${step}" never ran\n${stdout}`);
  if (!predicate(value)) fail(`${description}\n  got: ${JSON.stringify(value)}`);
  console.log(`  ✓ ${description}`);
};

expect(
  "bridge-with-flag",
  (s) => s.available === true,
  "the preload exposes the bridge when main passes the switch",
);
expect(
  "cold-start",
  (s) => s.requested === false && s.present === false,
  "the pane starts closed with no view, which is the shape a cold start actually has",
);
expect(
  "backend",
  (s) => s.publicExtensions === 0,
  "the in-app browser does not appear as a Chrome extension, so choosing your own Chrome cannot select it",
);
expect(
  "session-new",
  (s) => s.mode === "iab" && !s.error,
  "session new --iab succeeds from a cold start",
);
expect(
  "tabs-open",
  (s) => s.status === 200 && s.body.includes("127.0.0.1"),
  "tabs.open navigates the view",
);
expect(
  "auto-open",
  (s) => s.requested === true,
  "opening a tab opens the pane, so the user sees what the agent is doing",
);
expect(
  "snapshot",
  (s) => s.status === 200 && s.body.includes("Fixture"),
  "snapshot returns the page's ARIA tree",
);
expect(
  "click",
  (s) => s.status === 200 && s.body.includes("clicked"),
  "clickThrough actuates the real page",
);
expect(
  "splitter",
  (s) => s.hiddenDuringDrag === true,
  "the view steps aside while the splitter is dragged, so the native surface cannot swallow the pointer",
);
expect(
  "splitter",
  (s) => s.visibleAfter === true,
  "and comes back at the new width once the drag ends",
);
expect(
  "bridge-without-flag",
  (s) => s.available === false,
  "a window created without the switch gets no bridge, so the renderer offers nothing it cannot use",
);
expect(
  "session-new-anonymous",
  (s) => s.status === 400,
  "an in-app browser session without a conversation and a task is refused",
);
expect(
  "stale-task",
  (s) => s.refused === true,
  "a task the harness never reported running cannot open a tab, whatever id it carries",
);
expect(
  "second-tab",
  // Three: the bootstrap tab the relay opens with the session, plus the two the agent asked for.
  // Phase 1 answered every tabs.open() with its single view, which made the call idempotent by
  // accident; the count is the whole point of the assertion.
  (s) => s.status === 200 && s.tabs === 3,
  "each tabs.open() mints a new tab rather than handing back the same one",
);
expect(
  "select-tab",
  (s) => s.switched === true,
  "selecting a tab brings it to the front of its own conversation's strip",
);
expect(
  "foreign-task",
  (s) => s.status === 409,
  "a session created by one task cannot be driven by another",
);
expect(
  "task-end",
  (s) => s.tabs === 1 && s.retainedUnowned === true,
  "a read-only task closes its tabs, and the one the user kept survives without an owner",
);
expect(
  "write-after-end",
  // Refused, which is the property. The *wording* an agent sees is asserted where it is produced —
  // Playwright rewrites a CDP error into its own vocabulary on the way back, so the code would not
  // survive this route intact (see the transport's own tests for IAB_TAB_RELEASED).
  (s) => s.body.includes("Error executing code") || s.status === 409,
  "and the agent's next write to that page is refused rather than silently succeeding",
);
expect("done", () => true, "the harness completed");

console.log("iab-e2e: all assertions passed");
