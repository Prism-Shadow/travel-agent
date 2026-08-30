/**
 * Registers the workspace's `penguin-browser` CLI on the pnpm global bin PATH.
 *
 * pnpm 9's bare `pnpm link` (register the current package globally) no longer exists in the
 * pinned pnpm 11 — `pnpm link` now requires a directory argument and links *into* a project —
 * so the root build calls this instead: a symlink in the `pnpm bin -g` directory pointing at
 * `packages/browser-cli/bin.js`. That keeps the penguin-browser skill's contract true: the
 * agent finds the CLI on PATH after `pnpm build`, and the link is live (a rebuild of dist/ is
 * picked up without re-linking).
 *
 * Best-effort by design: a machine without a usable global bin dir still builds — it only
 * loses the dev convenience. The packaged desktop app never needs this; it stages its own
 * bin/ dir onto the agent's PATH (packages/desktop/src/browser-relay.ts).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "[link:browser-cli]";

function skip(reason) {
  console.log(`${PREFIX} skipped: ${reason}`);
  process.exit(0);
}

// A bare symlink is not launchable from cmd/PowerShell; Windows dev runs the CLI via
// `node packages/browser-cli/bin.js` or the packaged app.
if (process.platform === "win32") skip("no symlink dev-link on Windows");

let binDir = "";
try {
  binDir = execFileSync("pnpm", ["bin", "-g"], { encoding: "utf8" }).trim();
} catch {
  skip("`pnpm bin -g` failed (no global bin dir configured?)");
}
if (!binDir) skip("`pnpm bin -g` answered nothing");

const target = path.resolve(fileURLToPath(import.meta.url), "../../packages/browser-cli/bin.js");
const linkPath = path.join(binDir, "penguin-browser");

try {
  fs.mkdirSync(binDir, { recursive: true });
  // Replaces whatever is there: an old pnpm-9 shim, or a symlink into a moved/renamed checkout.
  fs.rmSync(linkPath, { force: true });
  fs.symlinkSync(target, linkPath);
  console.log(`${PREFIX} ${linkPath} -> ${target}`);
} catch (err) {
  skip(err instanceof Error ? err.message : String(err));
}
