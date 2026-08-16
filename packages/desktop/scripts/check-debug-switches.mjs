/**
 * CI hard-check: no debug switch ships in source (design/002 §11.2).
 *
 * Walks the shipped TypeScript of every workspace package — `src/` only, no tests, no build output —
 * and fails the build if any line *uses* `--remote-debugging-port`, an inspector switch, or the
 * like. Prose that names a switch to explain why it is avoided (comments) is fine; an actual switch
 * is not. The decision logic is `security-guards.mjs`; this file is the walk and the exit code.
 *
 *   node packages/desktop/scripts/check-debug-switches.mjs [repoRoot]
 *
 * Exit 0 clean, 1 with findings printed one per line. Run in CI ahead of the build so a leaked
 * switch fails fast and unmistakably.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanForDebugSwitches } from "./security-guards.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(process.argv[2] ?? path.join(here, "..", "..", ".."));
const packagesDir = path.join(repoRoot, "packages");

/** Directories never worth scanning: build output, dependencies, and generated bundles. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-e2e",
  "build",
  ".git",
  "assets",
  "snapshots",
]);

/** Files that are not shipped code: any test, and non-TS. */
function isShippedSource(filePath) {
  if (!/\.(ts|tsx|mjs|cjs|js)$/.test(filePath)) return false;
  if (/\.(test|unit\.test|spec)\.[tj]sx?$/.test(filePath)) return false;
  if (/[/\\]test[/\\]/.test(filePath)) return false;
  return true;
}

function collect(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const full = path.join(dir, entry.name);
      if (isShippedSource(full)) out.push(full);
    }
  }
}

const files = [];
collect(packagesDir, files);
// This scanner and the guard module name the switches as data; exclude them so the guard does not
// flag its own vocabulary.
const readable = files
  .filter(
    (file) => !file.endsWith("security-guards.mjs") && !file.endsWith("check-debug-switches.mjs"),
  )
  .map((file) => ({ path: path.relative(repoRoot, file), content: fs.readFileSync(file, "utf8") }));

const desktopPrefix = path.join("packages", "desktop") + path.sep;
const desktopFiles = readable.filter((file) => file.path.startsWith(desktopPrefix));
const otherFiles = readable.filter((file) => !file.path.startsWith(desktopPrefix));

// The desktop package is the Electron app we ship and run: any occurrence — flag, string or API —
// is about our own process (002 §11.2). Everywhere else, only the unambiguous appendSwitch/argument
// form is a leak; a `--remote-debugging-port` inside browser-cli help text is instructing the
// person to open a port on *their own* Chrome for the direct-CDP backend, which is a feature.
const findings = [
  ...scanForDebugSwitches(desktopFiles),
  ...scanForDebugSwitches(otherFiles, { apiOnly: true }),
];

if (findings.length === 0) {
  process.stdout.write(`debug-switch guard: clean (${readable.length} source files scanned)\n`);
  process.exit(0);
}

process.stderr.write(
  `debug-switch guard: ${findings.length} forbidden switch use(s) in shipped source (002 §11.2):\n`,
);
for (const finding of findings) {
  process.stderr.write(
    `  ${finding.path}:${finding.line}  --${finding.switch}  |  ${finding.text}\n`,
  );
}
process.stderr.write(
  "\nA debug/inspector switch in shipped code exposes every target in the process to any local " +
    "caller. Remove it, or if a mention is genuinely safe, keep it in a comment or mark the line " +
    "with penguin-allow-debug-switch.\n",
);
process.exit(1);
