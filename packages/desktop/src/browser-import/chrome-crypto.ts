/**
 * Undoing Chrome's `os_crypt` so an imported cookie or password is a value rather than a blob.
 *
 * Chrome does not store cookie values or passwords in the clear. It encrypts each one with a key
 * that the operating system holds, and the three platforms do it three different ways. All of that
 * variation is confined to this file, and it is expressed as **pure functions over a key** so the
 * hard part — the format parsing — can be tested on a machine with no keyring at all. Only
 * `chrome-key.ts` talks to the OS.
 *
 * The formats, as of Chrome 131:
 *
 * | Prefix | Where | Scheme |
 * | --- | --- | --- |
 * | `v10` (Linux) | Linux | AES-128-CBC, fixed IV of 16 spaces, PBKDF2-SHA1(password, "saltysalt", 1 iteration) |
 * | `v11` (Linux) | Linux | Same, but the password comes from the keyring instead of being `"peanuts"` |
 * | `v10` (macOS) | macOS | AES-128-CBC, fixed IV of 16 spaces, PBKDF2-SHA1(keychain secret, "saltysalt", 1003 iterations) |
 * | `v10`/`v11` (Windows) | Windows | AES-256-GCM: 12-byte nonce, ciphertext, 16-byte tag, key from `Local State` via DPAPI |
 * | *(none)* | Windows, old | Raw DPAPI blob, decrypted directly |
 * | `v20` | Windows, Chrome 127+ | App-Bound Encryption — **not decryptable by another application** |
 *
 * Two of those rows deserve a note, because both are places where the tempting thing is wrong:
 *
 * - **The iteration counts and the "saltysalt" salt are Chromium's, not ours.** They look far too
 *   weak to be right — one PBKDF2 iteration on Linux — and they are, but that is not a parameter
 *   this code may choose. It is reading somebody else's file, and the file was written with those
 *   values. Changing them does not improve anything; it just fails to decrypt.
 *
 * - **`v20` is refused, not attempted.** Chrome 127+ on Windows binds the key to the Chrome
 *   executable itself, specifically so that other applications cannot do what this file does. The
 *   honest response is to tell the person their cookies cannot be brought over and why. Silently
 *   importing the handful of pre-v20 rows and reporting success would leave them wondering why they
 *   are still signed out everywhere.
 */
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";

/** Chromium's fixed salt. Not a choice — it is what the file was written with. */
const SALT = "saltysalt";
/** Length of the SHA-256 domain hash Chromium prepends to a cookie's plaintext. See below. */
const COOKIE_DOMAIN_HASH_BYTES = 32;
/** Chromium's fixed IV for the CBC variants: sixteen spaces. */
const CBC_IV = Buffer.alloc(16, " ");
const CBC_KEY_BYTES = 16;

/** PBKDF2 iteration counts, per platform, exactly as Chromium uses them. */
const ITERATIONS: Partial<Record<NodeJS.Platform, number>> = { linux: 1, darwin: 1003 };

/**
 * The password Chromium falls back to on Linux when no keyring is reachable.
 *
 * It is a real, hardcoded, upstream constant, and it is why a `v10` blob on Linux is not meaningfully
 * encrypted at all. Worth knowing in both directions: it lets this import work on a machine with no
 * keyring, and it is the reason the fail-closed storage rule refuses to let *our* vault run on such a machine.
 */
export const LINUX_FALLBACK_PASSWORD = "peanuts";

export class ChromeDecryptError extends Error {
  override readonly name = "ChromeDecryptError";
  /** Whether every value will fail this way, so the caller can stop instead of retrying 4000 rows. */
  readonly fatal: boolean;
  constructor(message: string, options: { fatal?: boolean } = {}) {
    super(message);
    this.fatal = options.fatal ?? false;
  }
}

/** Derives the AES-128-CBC key used by the Linux and macOS formats. */
export function deriveCbcKey(password: string, platform: NodeJS.Platform): Buffer {
  const iterations = ITERATIONS[platform];
  if (iterations === undefined) {
    throw new ChromeDecryptError(`No key derivation is defined for ${platform}.`, { fatal: true });
  }
  return pbkdf2Sync(password, SALT, iterations, CBC_KEY_BYTES, "sha1");
}

/**
 * The key material this machine's format needs, whatever that format is.
 *
 * A discriminated union rather than a bare Buffer because the two schemes take different keys and
 * confusing them produces garbage rather than an error — AES will happily decrypt with the wrong
 * key and hand back noise.
 */
export type ChromeKey =
  | { scheme: "cbc"; key: Buffer }
  | { scheme: "gcm"; key: Buffer }
  /** Windows, no `Local State` key: every value is a bare DPAPI blob. */
  | { scheme: "dpapi"; unprotect: (blob: Buffer) => Buffer };

/**
 * Strips Chromium's PKCS#7-ish padding.
 *
 * Chromium pads to the AES block size, but a *truncated* or foreign blob can decrypt to something
 * whose last byte claims a padding length that is not there. Validating it is what keeps a corrupt
 * row from silently becoming a value with bytes chopped off the end.
 */
function stripPadding(plain: Buffer): Buffer {
  if (plain.length === 0) return plain;
  const pad = plain[plain.length - 1] ?? 0;
  if (pad === 0 || pad > 16 || pad > plain.length) return plain;
  for (let index = plain.length - pad; index < plain.length; index += 1) {
    if (plain[index] !== pad) return plain;
  }
  return plain.subarray(0, plain.length - pad);
}

/**
 * Decrypts one `encrypted_value` / `password_value` blob.
 *
 * Returns a Buffer rather than a string because a cookie value is not guaranteed to be UTF-8, and
 * because the caller for passwords wants to control when the value becomes a JS string (which it
 * can no longer wipe).
 *
 * Throws `ChromeDecryptError` for a value it cannot read. The caller counts those and carries on:
 * one unreadable row out of four thousand is a bad row, not a failed import — but a `fatal` error
 * means the *scheme* is wrong and every remaining row would fail the same way.
 */
export function decryptValue(blob: Buffer, key: ChromeKey, platform: NodeJS.Platform): Buffer {
  if (blob.length === 0) return blob;

  const prefix = blob.subarray(0, 3).toString("latin1");

  // Chrome 127+ on Windows. Refused loudly and once, because no key this process can obtain opens
  // it — see the file header.
  if (prefix === "v20") {
    throw new ChromeDecryptError(
      "This browser uses App-Bound Encryption (Chrome 127+), which deliberately prevents other " +
        "applications from reading its cookies. They cannot be imported.",
      { fatal: true },
    );
  }

  if (prefix === "v10" || prefix === "v11") {
    const body = blob.subarray(3);
    if (key.scheme === "gcm") return decryptGcm(body, key.key);
    if (key.scheme === "cbc") return decryptCbc(body, key.key);
    throw new ChromeDecryptError(
      `A ${prefix} value needs a derived key, but this machine only produced a DPAPI unprotector.`,
      { fatal: true },
    );
  }

  // No recognised prefix. On Windows that is the pre-v10 format: a bare DPAPI blob. Anywhere else
  // it is an unencrypted value, which Chromium does write when os_crypt is unavailable.
  if (platform === "win32" && key.scheme === "dpapi") return key.unprotect(blob);
  if (platform === "win32") {
    throw new ChromeDecryptError("A legacy DPAPI value needs the DPAPI unprotector.");
  }
  return blob;
}

function decryptCbc(body: Buffer, key: Buffer): Buffer {
  if (body.length === 0 || body.length % 16 !== 0) {
    throw new ChromeDecryptError("Encrypted value is not a whole number of AES blocks.");
  }
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, CBC_IV);
    // Chromium's own padding is validated by `stripPadding`, which reports a bad pad by leaving the
    // bytes alone rather than throwing. Node's automatic check would throw on exactly the rows we
    // want to skip individually, and its error says nothing useful about which row.
    decipher.setAutoPadding(false);
    return stripPadding(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch (error) {
    throw new ChromeDecryptError(`AES-128-CBC failed: ${(error as Error).message}`);
  }
}

/** Windows v10/v11: 12-byte nonce ‖ ciphertext ‖ 16-byte tag, AES-256-GCM. */
function decryptGcm(body: Buffer, key: Buffer): Buffer {
  const NONCE = 12;
  const TAG = 16;
  if (body.length <= NONCE + TAG) {
    throw new ChromeDecryptError("Encrypted value is too short to hold a nonce and a tag.");
  }
  const nonce = body.subarray(0, NONCE);
  const ciphertext = body.subarray(NONCE, body.length - TAG);
  const tag = body.subarray(body.length - TAG);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new ChromeDecryptError(`AES-256-GCM failed: ${(error as Error).message}`);
  }
}

/**
 * Chrome's own epoch, converted.
 *
 * Chromium timestamps are microseconds since 1601-01-01 UTC (the Windows FILETIME epoch), not the
 * Unix epoch. A cookie imported without this conversion expires in the seventeenth century and is
 * dropped on arrival — which looks exactly like "the import silently did nothing".
 */
const WINDOWS_EPOCH_OFFSET_MICROSECONDS = 11_644_473_600_000_000n;

/**
 * Removes the domain Chromium binds into every cookie value it writes.
 *
 * Since cookie-database version 24 the plaintext of `encrypted_value` is not the value: it is
 * `SHA-256(host_key)` followed by the value. The hash binds a row to its domain, so that copying a
 * cookie between hosts inside the file is detectable.
 *
 * The consequence for a reader that does not know this is not an error — decryption *succeeds* — but
 * every value comes out with 32 bytes of hash glued to its front. Chromium's own cookie parser then
 * rejects almost all of them for containing control characters, and the handful whose hash happens
 * to be free of forbidden bytes are accepted while still being wrong. So this is checked, not
 * assumed: the prefix is stripped only when it really is this host's hash, which leaves values
 * written by older Chromium versions (no prefix) untouched in the same file.
 */
export function stripCookieDomainHash(plain: Buffer, hostKey: string): Buffer {
  if (plain.length < COOKIE_DOMAIN_HASH_BYTES) return plain;
  const expected = createHash("sha256").update(hostKey).digest();
  if (!plain.subarray(0, COOKIE_DOMAIN_HASH_BYTES).equals(expected)) return plain;
  return plain.subarray(COOKIE_DOMAIN_HASH_BYTES);
}

/** Chromium microseconds → Unix seconds. `0` means "no expiry recorded" and comes back as null. */
export function chromeTimeToUnixSeconds(chromeTime: number | bigint): number | null {
  const value = typeof chromeTime === "bigint" ? chromeTime : BigInt(Math.trunc(chromeTime));
  if (value <= 0n) return null;
  const unixMicroseconds = value - WINDOWS_EPOCH_OFFSET_MICROSECONDS;
  if (unixMicroseconds <= 0n) return null;
  return Number(unixMicroseconds / 1_000_000n);
}

/** Chromium microseconds → an ISO string, for the history store. Null when unset or nonsensical. */
export function chromeTimeToIso(chromeTime: number | bigint): string | null {
  const seconds = chromeTimeToUnixSeconds(chromeTime);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
