/**
 * Reports whether this machine can back the private profile vault (design/003 §4.4).
 *
 * Run it on each platform you intend to support:
 *
 *   pnpm --filter @prismshadow/penguin-desktop exec electron scripts/probe-safe-storage.mjs
 *   # headless Linux: prefix with `xvfb-run -a`
 *
 * It prints one JSON line and exits 0 when the vault may start, 1 when it must not. The
 * non-zero exit is the point: this is the fail-closed decision from 003 §4.4 made executable,
 * so CI or an installer check can consume it without re-deriving the rule.
 *
 * On Linux, `safeStorage` falls back to a `basic_text` backend when no keyring is reachable,
 * and that backend does not encrypt. Treating it as "encryption available" would persist
 * personal data in plaintext, so it is reported as unavailable here.
 *
 * Nothing is written to disk and the probe value is a constant — no user data is touched.
 */
import { app, safeStorage } from "electron";

const PROBE_VALUE = "penguin-safe-storage-probe";

app
  .whenReady()
  .then(async () => {
    const report = {
      platform: process.platform,
      electron: process.versions.electron,
      isEncryptionAvailable: null,
      backend: null,
      hasAsyncApi: null,
      roundTrip: null,
      cipherContainsPlaintext: null,
      vaultAllowed: false,
      reason: "",
    };

    try {
      report.isEncryptionAvailable = safeStorage.isEncryptionAvailable();
    } catch (error) {
      report.isEncryptionAvailable = `error: ${error.message}`;
    }

    try {
      report.backend =
        process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "n/a";
    } catch (error) {
      report.backend = `error: ${error.message}`;
    }

    // 003 §4.2 prefers the async API: the sync calls block the main process and may reach the
    // OS keyring, which on some desktops shows a prompt.
    report.hasAsyncApi =
      typeof safeStorage.encryptStringAsync === "function" &&
      typeof safeStorage.decryptStringAsync === "function";

    if (report.isEncryptionAvailable === true) {
      try {
        const encrypted = report.hasAsyncApi
          ? await safeStorage.encryptStringAsync(PROBE_VALUE)
          : safeStorage.encryptString(PROBE_VALUE);
        const decrypted = report.hasAsyncApi
          ? await safeStorage.decryptStringAsync(encrypted)
          : safeStorage.decryptString(encrypted);
        report.roundTrip = decrypted === PROBE_VALUE;
        // A cipher that still contains the input is the basic_text case in disguise.
        report.cipherContainsPlaintext = encrypted.toString("latin1").includes(PROBE_VALUE);
      } catch (error) {
        report.roundTrip = `error: ${error.message}`;
      }
    }

    const linuxPlaintextBackend = process.platform === "linux" && report.backend === "basic_text";
    if (report.isEncryptionAvailable !== true) {
      report.reason = "safeStorage reports encryption is unavailable";
    } else if (linuxPlaintextBackend) {
      report.reason = "Linux selected the basic_text backend, which stores plaintext";
    } else if (report.roundTrip !== true) {
      report.reason = "encrypt/decrypt round-trip failed";
    } else if (report.cipherContainsPlaintext === true) {
      report.reason = "ciphertext still contains the probe value";
    } else {
      report.vaultAllowed = true;
      report.reason = "encrypted storage is usable";
    }

    process.stdout.write(`${JSON.stringify(report)}\n`);
    app.exit(report.vaultAllowed ? 0 : 1);
  })
  .catch((error) => {
    process.stdout.write(`${JSON.stringify({ fatal: String(error?.stack ?? error) })}\n`);
    app.exit(1);
  });
