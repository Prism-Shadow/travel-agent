/**
 * Whether this machine may hold a vault at all, and the one API it is held with.
 *
 * design/003 §4.4 makes this a fail-closed decision rather than a preference. Electron's
 * `safeStorage` falls back to a `basic_text` backend on Linux when no keyring is reachable, and
 * that backend does not encrypt — it obfuscates. A vault that started anyway would write personal
 * data as recoverable plaintext while telling the person it was protected, which is worse than
 * having no vault: it converts a visible missing feature into an invisible broken promise. The same
 * judgement `journal.ts` makes about a torn final line — refuse to load rather than skip it.
 *
 * Two smaller decisions are recorded here because they are easy to get wrong later:
 *
 * - **The async API is preferred.** 003 §4.2 follows Electron's own advice: the synchronous calls
 *   block the main process and may reach the OS keyring, which on some desktops shows a prompt.
 *   The port is therefore async even where the adapter has to fall back to the sync call.
 * - **An unreadable backend fails closed too.** If `getSelectedStorageBackend` is missing or throws
 *   on Linux, this reports the vault as unusable. "We could not tell whether the keyring is real"
 *   is not evidence that it is.
 */

/** The subset of Electron's `safeStorage` the vault uses, as a port so it can be tested. */
export interface SafeStoragePort {
  /** Encrypts with the OS keychain / DPAPI / libsecret. Async per 003 §4.2. */
  encryptString(plaintext: string): Promise<Buffer>;
  decryptString(ciphertext: Buffer): Promise<string>;
}

/** What Electron reports about this machine, as plain data so the rule can be tested. */
export interface StorageFacts {
  platform: NodeJS.Platform;
  /** `safeStorage.isEncryptionAvailable()`. */
  encryptionAvailable: boolean;
  /**
   * `safeStorage.getSelectedStorageBackend()` on Linux; `null` when the call is unavailable or
   * threw, which is treated as unknown — and unknown fails closed.
   */
  backend: string | null;
}

export interface StorageAvailability {
  /** Whether the vault may start. Everything gated on the vault reads this, never the raw facts. */
  usable: boolean;
  /** One line, written for a person reading a settings page, not for a log grep. */
  reason: string;
  /** What to do about it, when there is something to do. Empty when the vault is usable. */
  remedy: string[];
}

/** Linux backends that do not actually encrypt. `basic_text` is the one Electron falls back to. */
const PLAINTEXT_BACKENDS = new Set(["basic_text", "basic"]);

/**
 * The fail-closed rule of 003 §4.4, as a pure function.
 *
 * Kept apart from Electron so the decision itself can be exercised — including the Linux
 * no-keyring case (attack A9 of 003 §12), which is otherwise only reachable on a machine
 * deliberately built without one.
 */
export function judgeStorage(facts: StorageFacts): StorageAvailability {
  if (!facts.encryptionAvailable) {
    return {
      usable: false,
      reason:
        "This machine reports no encrypted storage, so the vault will not start. Personal data " +
        "would otherwise be written where anything running as you could read it.",
      remedy: [
        "On Linux, install and unlock a keyring (gnome-keyring or kwallet), or start the app " +
          "with --password-store=<backend>.",
        "Sensitive fields stay manual entry until then.",
      ],
    };
  }

  if (facts.platform === "linux") {
    if (facts.backend === null) {
      return {
        usable: false,
        reason:
          "The keyring backend could not be read, so it is not possible to tell whether storage " +
          "is really encrypted. The vault stays off rather than assuming it is.",
        remedy: [
          "Check that a keyring service is running (gnome-keyring or kwallet), then restart.",
        ],
      };
    }
    if (PLAINTEXT_BACKENDS.has(facts.backend)) {
      return {
        usable: false,
        reason:
          `Linux selected the "${facts.backend}" backend, which stores values as recoverable ` +
          "plaintext. The vault will not start: silently downgrading to plaintext would be worse " +
          "than not offering it.",
        remedy: [
          "Install and unlock gnome-keyring or kwallet, or pass --password-store=<backend>.",
          "Until then, enter sensitive fields by hand each time — nothing is stored.",
        ],
      };
    }
  }

  return { usable: true, reason: "Encrypted storage is available on this machine.", remedy: [] };
}

/**
 * Reads the facts from Electron's `safeStorage`, tolerating every way the call can fail.
 *
 * Anything unexpected becomes "unknown", which {@link judgeStorage} turns into "unusable". The
 * shape of the argument is structural on purpose: the desktop main process passes Electron's real
 * object, and nothing else in this file imports Electron.
 */
export function readStorageFacts(
  safeStorage: {
    isEncryptionAvailable(): boolean;
    getSelectedStorageBackend?(): string;
  },
  platform: NodeJS.Platform = process.platform,
): StorageFacts {
  let encryptionAvailable = false;
  try {
    encryptionAvailable = safeStorage.isEncryptionAvailable() === true;
  } catch {
    encryptionAvailable = false;
  }

  let backend: string | null = null;
  if (platform === "linux") {
    try {
      backend = safeStorage.getSelectedStorageBackend?.() ?? null;
    } catch {
      backend = null;
    }
  }

  return { platform, encryptionAvailable, backend };
}

/**
 * Adapts Electron's `safeStorage` to the port, preferring the async API (003 §4.2).
 *
 * The sync fallback exists because the async methods were added later than the versions this
 * project has to keep loading on; it is wrapped so callers never learn which one ran.
 */
export function electronSafeStorage(safeStorage: {
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
  // Electron types the async return as a wrapper object, not a bare string, and older type
  // packages omit these entirely. `unknown` here, coerced below, keeps this file buildable across
  // the versions this project loads on without importing Electron's exact declaration.
  encryptStringAsync?(plaintext: string): Promise<unknown>;
  decryptStringAsync?(ciphertext: Buffer): Promise<unknown>;
}): SafeStoragePort {
  return {
    async encryptString(plaintext) {
      if (typeof safeStorage.encryptStringAsync === "function") {
        return (await safeStorage.encryptStringAsync(plaintext)) as Buffer;
      }
      return safeStorage.encryptString(plaintext);
    },
    async decryptString(ciphertext) {
      if (typeof safeStorage.decryptStringAsync === "function") {
        return String(await safeStorage.decryptStringAsync(ciphertext));
      }
      return safeStorage.decryptString(ciphertext);
    },
  };
}
