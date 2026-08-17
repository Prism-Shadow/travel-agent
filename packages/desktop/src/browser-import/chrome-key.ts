/**
 * Getting the other browser's encryption key out of this operating system.
 *
 * This is the only file in the import feature that talks to the OS keyring, and it is deliberately
 * thin: it produces a `ChromeKey` and nothing else, so that everything downstream — format parsing,
 * SQLite reading, the import itself — stays testable on a machine with no keyring.
 *
 * **On macOS this prompts.** Reading `Chrome Safe Storage` out of the login keychain shows the
 * system's own "Travel Agent wants to use your confidential information" dialog. That is not a
 * problem to be engineered around; it is the operating system asking the user to confirm exactly
 * the thing this feature does, with an identity our own dialog cannot forge. If the user declines,
 * `security` exits non-zero and the import reports that it was refused.
 *
 * On Linux the same secret lives in gnome-keyring or kwallet under the label `Chrome Safe Storage`.
 * Reading it via `secret-tool` is best-effort: when it is missing, Chromium itself falls back to
 * the hardcoded password (see `LINUX_FALLBACK_PASSWORD`), so trying the fallback is not a downgrade
 * we are choosing — it is the same key Chromium used to write the file.
 *
 * On Windows the key is in `Local State`, wrapped by DPAPI. Unwrapping it needs `CryptUnprotectData`,
 * which Node cannot call directly; the PowerShell route below is the standard way to reach it
 * without adding a native module to a shipped desktop app.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ChromeDecryptError, deriveCbcKey, LINUX_FALLBACK_PASSWORD } from "./chrome-crypto.js";
import type { ChromeKey } from "./chrome-crypto.js";
import { readLocalState } from "./chrome-profiles.js";

const run = promisify(execFile);

/** How long any one helper process gets. A hung keyring must not hang the import dialog. */
const HELPER_TIMEOUT_MS = 20_000;

/** The keychain/keyring account each family stores its secret under. */
const SAFE_STORAGE_LABELS: Record<string, { service: string; account: string }> = {
  chrome: { service: "Chrome Safe Storage", account: "Chrome" },
  chromium: { service: "Chromium Safe Storage", account: "Chromium" },
  edge: { service: "Microsoft Edge Safe Storage", account: "Microsoft Edge" },
  brave: { service: "Brave Safe Storage", account: "Brave" },
  vivaldi: { service: "Vivaldi Safe Storage", account: "Vivaldi" },
};

export interface KeyRequest {
  familyId: string;
  userDataDir: string;
  platform?: NodeJS.Platform;
}

/**
 * The key for one browser on this machine.
 *
 * Throws `ChromeDecryptError` with `fatal: true` when there is no route to a key at all — the
 * caller turns that into a sentence in the dialog rather than a silent empty import.
 */
export async function acquireChromeKey(request: KeyRequest): Promise<ChromeKey> {
  const platform = request.platform ?? process.platform;
  switch (platform) {
    case "darwin":
      return {
        scheme: "cbc",
        key: deriveCbcKey(await macKeychainSecret(request.familyId), platform),
      };
    case "linux":
      return { scheme: "cbc", key: deriveCbcKey(await linuxSecret(request.familyId), platform) };
    case "win32":
      return windowsKey(request.userDataDir);
    default:
      throw new ChromeDecryptError(`Importing is not supported on ${platform}.`, { fatal: true });
  }
}

/**
 * macOS: the `Chrome Safe Storage` generic password.
 *
 * `security find-generic-password -w` is used rather than a native binding because it is present on
 * every macOS install and because it routes through the same authorisation prompt the user would
 * see for any other application — which is the behaviour we want, not a limitation.
 */
async function macKeychainSecret(familyId: string): Promise<string> {
  const label = SAFE_STORAGE_LABELS[familyId];
  if (label === undefined) {
    throw new ChromeDecryptError(`No keychain entry is known for ${familyId}.`, { fatal: true });
  }
  try {
    const { stdout } = await run(
      "security",
      ["find-generic-password", "-w", "-s", label.service, "-a", label.account],
      { timeout: HELPER_TIMEOUT_MS },
    );
    const secret = stdout.replace(/\n$/, "");
    if (secret === "") throw new Error("the keychain returned an empty secret");
    return secret;
  } catch (error) {
    throw new ChromeDecryptError(
      "macOS did not release the browser's encryption key. If a keychain prompt appeared, it " +
        `has to be allowed for the import to read anything. (${(error as Error).message})`,
      { fatal: true },
    );
  }
}

/**
 * Linux: the keyring secret, or Chromium's own fallback.
 *
 * The fallback is not a weakening. When no keyring is reachable Chromium *writes* with `peanuts`,
 * so a `v10` blob on such a machine was never protected by anything; using the same password is
 * simply reading the file the way it was written. `secret-tool` is tried first because a machine
 * *with* a keyring wrote `v11` blobs that the fallback cannot open.
 */
async function linuxSecret(familyId: string): Promise<string> {
  const label = SAFE_STORAGE_LABELS[familyId];
  if (label !== undefined) {
    try {
      const { stdout } = await run(
        "secret-tool",
        ["lookup", "application", label.account.toLowerCase()],
        { timeout: HELPER_TIMEOUT_MS },
      );
      if (stdout !== "") return stdout;
    } catch {
      // No secret-tool, no keyring, or no entry. Fall through: `peanuts` is what Chromium would
      // have used in exactly those conditions.
    }
  }
  return LINUX_FALLBACK_PASSWORD;
}

/**
 * Windows: `os_crypt.encrypted_key` from `Local State`, unwrapped with DPAPI.
 *
 * The key is base64, prefixed with the ASCII `DPAPI`. PowerShell's `ProtectedData` is used to call
 * `CryptUnprotectData`; it is on every supported Windows and avoids shipping a native module whose
 * only job is one syscall.
 */
async function windowsKey(userDataDir: string): Promise<ChromeKey> {
  const facts = readLocalState(userDataDir);
  if (facts?.appBoundKeyPresent === true && facts.encryptedKey === null) {
    throw new ChromeDecryptError(
      "This browser stores its key with App-Bound Encryption (Chrome 127+), which cannot be read " +
        "by another application. Its cookies and passwords cannot be imported.",
      { fatal: true },
    );
  }
  if (facts?.encryptedKey == null) {
    // No stored key at all: the browser is old enough to DPAPI-protect each value on its own.
    return { scheme: "dpapi", unprotect: dpapiUnprotectSync };
  }

  const wrapped = Buffer.from(facts.encryptedKey, "base64");
  const PREFIX = "DPAPI";
  if (wrapped.subarray(0, PREFIX.length).toString("latin1") !== PREFIX) {
    throw new ChromeDecryptError("The stored key is not in the DPAPI format this build reads.", {
      fatal: true,
    });
  }
  const key = await dpapiUnprotect(wrapped.subarray(PREFIX.length));
  return { scheme: "gcm", key };
}

/** Calls `CryptUnprotectData` through PowerShell and returns the plaintext bytes. */
async function dpapiUnprotect(blob: Buffer): Promise<Buffer> {
  const script =
    "$ErrorActionPreference='Stop';" +
    "Add-Type -AssemblyName System.Security;" +
    "$b=[Convert]::FromBase64String($env:PENGUIN_DPAPI_BLOB);" +
    "$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null," +
    "[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
    "[Convert]::ToBase64String($p)";
  try {
    const { stdout } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        timeout: HELPER_TIMEOUT_MS,
        // The blob goes through the environment, not the command line: a command line is readable
        // by every process on the machine, and this one carries the browser's master key.
        env: { ...process.env, PENGUIN_DPAPI_BLOB: blob.toString("base64") },
      },
    );
    const key = Buffer.from(stdout.trim(), "base64");
    if (key.length === 0) throw new Error("DPAPI returned nothing");
    return key;
  } catch (error) {
    throw new ChromeDecryptError(
      `Windows would not unwrap the browser's key: ${(error as Error).message}`,
      { fatal: true },
    );
  }
}

/**
 * The per-value DPAPI path, for browsers old enough not to keep a key in `Local State`.
 *
 * Synchronous by necessity — it sits inside `decryptValue`, which is called per row — and therefore
 * genuinely slow. It only runs for pre-2016 profiles, where the row count is small.
 */
function dpapiUnprotectSync(blob: Buffer): Buffer {
  // Imported lazily: this path is Windows-only and rare, and `execFileSync` in the module body
  // would be one more thing loaded on every start for no benefit.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const script =
    "$ErrorActionPreference='Stop';" +
    "Add-Type -AssemblyName System.Security;" +
    "$b=[Convert]::FromBase64String($env:PENGUIN_DPAPI_BLOB);" +
    "$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null," +
    "[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
    "[Convert]::ToBase64String($p)";
  const stdout = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      timeout: HELPER_TIMEOUT_MS,
      encoding: "utf8",
      env: { ...process.env, PENGUIN_DPAPI_BLOB: blob.toString("base64") },
    },
  );
  return Buffer.from(stdout.trim(), "base64");
}

/** Process names to look for, per family and platform. */
const PROCESS_NAMES: Record<string, { unix: string[]; win: string[] }> = {
  chrome: { unix: ["Google Chrome", "chrome"], win: ["chrome.exe"] },
  chromium: { unix: ["chromium", "chromium-browser"], win: ["chromium.exe"] },
  edge: { unix: ["Microsoft Edge", "msedge"], win: ["msedge.exe"] },
  brave: { unix: ["Brave Browser", "brave"], win: ["brave.exe"] },
  vivaldi: { unix: ["Vivaldi", "vivaldi-bin"], win: ["vivaldi.exe"] },
};

/**
 * Whether a browser is running, so the dialog can say "close it first".
 *
 * The check exists because Chrome holds its SQLite files open with a lock, and — more importantly —
 * keeps recent cookie writes in a WAL that has not been checkpointed. An import taken while Chrome
 * runs can therefore miss exactly the session cookie the person just created, which is the one they
 * are importing for.
 *
 * Answers `false` when it cannot tell. A wrong "please close Chrome" on a machine where the check
 * misfires would block an import that would have worked; a missed one produces a partial import
 * that the reported counts will show.
 */
export async function isBrowserRunning(
  familyId: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const names = PROCESS_NAMES[familyId];
  if (names === undefined) return false;
  try {
    if (platform === "win32") {
      const { stdout } = await run("tasklist", ["/FO", "CSV", "/NH"], { timeout: 5000 });
      const haystack = stdout.toLowerCase();
      return names.win.some((name) => haystack.includes(name.toLowerCase()));
    }
    // `pgrep -f` would match this app's own command line whenever it mentions the browser (the
    // import dialog's own argv, a log path). `-x` on the executable name is narrower and enough.
    for (const name of names.unix) {
      try {
        await run("pgrep", ["-x", name], { timeout: 5000 });
        return true;
      } catch {
        // pgrep exits 1 when nothing matched. Try the next spelling.
      }
    }
    return false;
  } catch {
    return false;
  }
}
