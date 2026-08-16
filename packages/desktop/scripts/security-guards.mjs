/**
 * The build-time security guards of design/002 §11.2, as pure functions.
 *
 * Two separate leaks are being prevented, and they leak at two different moments, so there are two
 * guards:
 *
 * 1. **A debug switch in the shipped source.** `--remote-debugging-port` (or an inspector switch)
 *    left in the desktop code is, in 002 §11.2's words, a *severe* defect: the port exposes every
 *    target in the process — including the window holding the user's authenticated session — to any
 *    local caller, with no authentication. Phase 0 used it on a local branch; this guard makes its
 *    return a hard CI failure rather than a code-review hope. It runs on source, so it runs in
 *    ordinary CI.
 * 2. **A missing Electron fuse in the packaged app.** Even with no debug switch in our code, an
 *    Electron binary with `RunAsNode` or `EnableNodeCliInspectArguments` still on can be relaunched
 *    as a plain Node process (or with `--inspect`) by anything that can exec it — the same session
 *    theft by another route. Fuses are flipped into the binary at package time, so that guard runs
 *    in the packaging workflows, against the built app.
 *
 * The logic that decides pass/fail lives here, apart from the filesystem and from Electron, so it
 * is unit-tested directly. The two CLI wrappers (`check-debug-switches.mjs`, `check-fuses.mjs`) are
 * thin: walk/read, call these, exit non-zero on a finding.
 */

/**
 * Command-line switches that must never reach a shipped build.
 *
 * Matched as whole tokens so `remote-debugging-port` catches `--remote-debugging-port=9222` and the
 * `appendSwitch("remote-debugging-port", …)` form alike, while a substring like `#remote-debugging`
 * in a help URL (browser-cli's chrome-discovery copy) does not trip it — see `matchesSwitch`.
 */
export const DANGEROUS_SWITCHES = Object.freeze([
  "remote-debugging-port",
  "remote-debugging-pipe",
  "inspect-brk",
  "inspect-port",
  "inspect", // last: so a line with inspect-brk reports the more specific one first
]);

/** A line opts out with this marker when a mention is genuinely safe (there are none today). */
export const ALLOW_MARKER = "penguin-allow-debug-switch";

/** True when `line` is entirely a comment — where a *mention* of a switch is documentation. */
function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("#")
  );
}

/**
 * Whether `line` uses `switchName`, in one of two senses set by `apiOnly`.
 *
 * There are two spellings of "use", and they carry different false-positive risk:
 *
 * - **The API form** — `appendSwitch("switch", …)` / `appendArgument(…)`. This is unambiguous: it
 *   applies the switch to a process *we* launch. It is never a help string or a sentence, so it is
 *   flagged everywhere in the repo.
 * - **The command-line form** — `--switch`, `--switch=…`. This is the app's own Electron process
 *   opening a port on itself, which is 002 §11.2's threat — but the same characters also appear in
 *   the browser-cli's *help text* telling a person to launch **their own** Chrome for the
 *   direct-CDP backend (a deliberate feature; that is the user's browser, not ours). So the
 *   command-line form is flagged only in the desktop package, where any occurrence is about the
 *   process we ship and run.
 *
 * `apiOnly` selects: true = API form only (the repo-wide pass), false = both (the desktop pass).
 */
export function matchesSwitch(line, switchName, { apiOnly = false } = {}) {
  // appendSwitch("switch"|'switch'|`switch`, …) / appendArgument(…) — the Electron API spelling.
  const asApi = new RegExp(
    `append(?:Switch|Argument)\\s*\\(\\s*['"\`]${escapeRegExp(switchName)}['"\`]`,
  );
  if (asApi.test(line)) return true;
  if (apiOnly) return false;
  // `--switch`, `--switch=…`, or `--switch ` — the command-line spelling.
  const asFlag = new RegExp(`--${escapeRegExp(switchName)}(?=$|[\\s='"\`])`);
  return asFlag.test(line);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scans file contents for debug switches used in shipped code.
 *
 * `files` is `{ path, content }[]` — the caller decides which files ship (see
 * `check-debug-switches.mjs`, which excludes tests and non-source trees). A finding is a
 * non-comment line, without the allow marker, that *uses* a dangerous switch. Comment lines are
 * skipped so the design rationale in `iab-transport.ts` (which names the switch precisely to
 * explain why it is not used) is not a false positive.
 */
export function scanForDebugSwitches(files, { apiOnly = false } = {}) {
  const findings = [];
  for (const file of files) {
    const lines = file.content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (isCommentLine(line) || line.includes(ALLOW_MARKER)) continue;
      for (const switchName of DANGEROUS_SWITCHES) {
        if (matchesSwitch(line, switchName, { apiOnly })) {
          findings.push({
            path: file.path,
            line: index + 1,
            switch: switchName,
            text: line.trim(),
          });
          break; // one finding per line is enough to fail; report the first (most specific) match
        }
      }
    }
  }
  return findings;
}

/**
 * The Electron fuses a release binary must carry (design/002 §11.2).
 *
 * A fuse is a bit flipped into the binary at package time that Electron reads at startup and cannot
 * be overridden by a command-line switch. The three that matter for the session-theft threat:
 *
 * - **runAsNode** off: the binary cannot be relaunched as a bare Node process (which would run with
 *   the app's entitlements but none of its guards).
 * - **enableNodeCliInspectArguments** off: `--inspect` on the packaged app does nothing, closing the
 *   inspector route that a missing `--remote-debugging-port` guard would not cover.
 * - **enableNodeOptionsEnvironmentVariable** off: `NODE_OPTIONS=--inspect` cannot reopen it either.
 * - **onlyLoadAppFromAsar** is deliberately **false**: this app ships asar off (see
 *   electron-builder.yml), so requiring it would be a fuse we could never satisfy. Recorded here so
 *   the exception is a decision, not a gap.
 * - **enableCookieEncryption** on: the persistent IAB partition's cookies at rest.
 */
export const EXPECTED_FUSES = Object.freeze({
  runAsNode: false,
  enableNodeCliInspectArguments: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableEmbeddedAsarIntegrityValidation: false, // requires asar; off here for the same reason
  onlyLoadAppFromAsar: false,
  enableCookieEncryption: true,
});

/**
 * The fuse wire's index → name map (FuseV1Options in `@electron/fuses`), and its byte states.
 *
 * `getCurrentFuseWire` hands back a sparse object keyed by the numeric index with a byte for the
 * state: 49 (`'1'`) enabled, 48 (`'0'`) disabled, and 114/144 for removed/inherit. Kept here as
 * data so the wire can be turned into a `{name: boolean}` object this module's `diffFuses` reads,
 * and so both halves are exercised by the same unit test rather than only against a real binary.
 */
export const FUSE_INDEX = Object.freeze({
  0: "runAsNode",
  1: "enableCookieEncryption",
  2: "enableNodeOptionsEnvironmentVariable",
  3: "enableNodeCliInspectArguments",
  4: "enableEmbeddedAsarIntegrityValidation",
  5: "onlyLoadAppFromAsar",
  6: "loadBrowserProcessSpecificV8Snapshot",
  7: "grantFileProtocolExtraPrivileges",
});

const FUSE_ENABLED_BYTE = 49; // '1'
const FUSE_DISABLED_BYTE = 48; // '0'

/**
 * Turns a `getCurrentFuseWire` result into `{name: boolean}`.
 *
 * Only the fuses this build opines on (the keys of {@link EXPECTED_FUSES}) are interpreted; any
 * other index in the wire is ignored, so a newer Electron carrying extra fuses does not break the
 * check. A byte that is neither enabled nor disabled (removed/inherit) is reported as `null`, which
 * `diffFuses` treats as a mismatch against any expected boolean.
 */
export function interpretFuseWire(wire) {
  const out = {};
  for (const [index, name] of Object.entries(FUSE_INDEX)) {
    if (!(name in EXPECTED_FUSES)) continue;
    if (!(index in wire)) continue;
    const byte = wire[index];
    out[name] = byte === FUSE_ENABLED_BYTE ? true : byte === FUSE_DISABLED_BYTE ? false : null;
  }
  return out;
}

/**
 * Compares a binary's actual fuse state to {@link EXPECTED_FUSES}.
 *
 * Returns the mismatches, each naming what was expected and what was found. An empty array is a
 * pass. Fuses present in `actual` but not in the expectation are ignored — Electron adds new fuses
 * over versions, and a build should not fail because it carries one this table has not yet opined
 * on.
 */
export function diffFuses(actual) {
  const mismatches = [];
  for (const [name, expected] of Object.entries(EXPECTED_FUSES)) {
    if (!(name in actual)) {
      mismatches.push({ fuse: name, expected, actual: "absent" });
      continue;
    }
    if (actual[name] !== expected) {
      mismatches.push({ fuse: name, expected, actual: actual[name] });
    }
  }
  return mismatches;
}
