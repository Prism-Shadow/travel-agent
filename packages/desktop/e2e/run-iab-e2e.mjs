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
import { checkExitStatus, redactSecrets } from "./exit-status.mjs";

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
if (!exit.ok) {
  // Both streams, before the message. `checkExitStatus` attaches a stderr tail, which is enough
  // when Electron said something — and useless when it did not. A launch that fails before
  // Chromium initialises (a sandbox the kernel refuses, a missing shared library) can exit
  // non-zero with *both* streams empty, and the first CI run of this gate did exactly that: the
  // log carried one sentence and no evidence, and the cause had to be reproduced locally to be
  // seen at all. Printing what was captured — including "nothing", said explicitly — is what
  // makes the next failure diagnosable from the log.
  const tail = (text) =>
    redactSecrets(text ?? "")
      .slice(-4000)
      .trim();
  console.error(`iab-e2e: --- electron stdout (tail) ---\n${tail(stdout) || "(empty)"}`);
  console.error(`iab-e2e: --- electron stderr (tail) ---\n${tail(result.stderr) || "(empty)"}`);
  fail(exit.message);
}

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
  "an untouched conversation shows no pane and no eager browser target",
);
expect(
  "draft-before-chat",
  (s) =>
    s.scope?.startsWith("draft-scope-") &&
    s.tabs === 1 &&
    s.navigated === true &&
    s.polledAsSession === false,
  "a user can open and navigate the browser before sending the first message",
);
expect(
  "draft-promoted",
  (s) =>
    s.scope?.startsWith("session-") &&
    s.tabs === 1 &&
    s.sameTab === true &&
    s.polledAsSession === true,
  "the first send promotes the same draft tab into the newly-created Session",
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
  "popup-adopted",
  (s) => s.uncaught === null,
  "an opener-carrying popup throws nothing in the main process (issue 0007)",
);
expect(
  "popup-adopted",
  (s) => s.requested === true && s.adopted === true && s.openerAlive === true,
  "the popup is adopted as a live tab, opener handle intact",
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
  // The first open consumes the session's exact owned bootstrap tab, avoiding a visible blank.
  // The second open must still mint a distinct page rather than making tabs.open() idempotent.
  (s) => s.status === 200 && s.tabs === 2,
  "the first tabs.open() consumes the bootstrap and the next one mints a distinct tab",
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
  (s) =>
    s.tabs === 2 &&
    s.retainedUnowned === true &&
    s.resultRetained === true &&
    s.markedRetained === true,
  "a read-only task keeps its final result and the user-marked page without an owner",
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
