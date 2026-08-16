/**
 * The vault's encryption, and the reason it is per field rather than per file.
 *
 * design/003 §4.2 asks for a master key wrapped by the OS keychain and a **separate data key for
 * every field**. The obvious cheaper design — one key, one encrypted blob — fails three ways that
 * matter here: deleting a field would mean rewriting everything, rotating a key would mean
 * decrypting everything at once, and reading a passport number would mean holding every other field
 * in plaintext at the same moment. Filling one form field should decrypt exactly one value, and
 * that is what a field-level DEK buys.
 *
 * Every sealed thing is AES-256-GCM with **additional authenticated data naming the field and the
 * format version**. The AAD is not decoration: without it, a ciphertext could be moved from
 * `phone_number` to `payment_token` in the file and would still open, so an attacker with write
 * access to the vault file could make the application fill one value where another was meant. With
 * it, the move fails authentication and the read refuses.
 *
 * What this module does **not** claim: it protects data at rest. The master key is handed to the OS
 * keychain by the caller (`safe-storage.ts`), and 003 §4.3 is explicit that this defends against a
 * stolen disk, not against another process running as the same user while the app is unlocked.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/** Format version, mixed into every AAD so a future layout cannot be opened as this one. */
export const VAULT_CRYPTO_VERSION = 1;

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** A ciphertext, in the shape it is written to disk. All base64, all safe to log *as shapes*. */
export interface SealedBox {
  /** Format version this box was written with. */
  v: number;
  iv: string;
  ct: string;
  tag: string;
}

export class VaultCryptoError extends Error {
  override readonly name = "VaultCryptoError";
}

/** A fresh 256-bit key. Used for the master key, each field's DEK, and the audit's HMAC key. */
export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * Overwrites a key buffer in place.
 *
 * Worth exactly what it is worth: it shortens the window in which a key sits in this process's
 * heap, and it does nothing about copies the runtime may have made (a `Buffer.from`, a GC move, a
 * core dump). It is here because `lock()` promising to clear the master key should do something
 * real, not because it makes memory-reading attacks fail — 003 §0.3 is where that is addressed.
 */
export function wipe(key: Buffer | null | undefined): void {
  if (key) key.fill(0);
}

function aad(field: string, version: number): Buffer {
  return Buffer.from(`penguin-vault/v${version}/${field}`, "utf8");
}

function assertKey(key: Buffer, what: string): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new VaultCryptoError(`${what} must be ${KEY_BYTES} bytes; got ${key?.length ?? "none"}.`);
  }
}

/**
 * Seals `plaintext` under `key`, bound to `field`.
 *
 * `field` is the label the value is filed under — a field name for a value, or `"dek:<field>"` for
 * a wrapped data key. Opening with a different label fails, which is the whole point.
 */
export function seal(input: { key: Buffer; field: string; plaintext: string | Buffer }): SealedBox {
  assertKey(input.key, "sealing key");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, input.key, iv, { authTagLength: 16 });
  cipher.setAAD(aad(input.field, VAULT_CRYPTO_VERSION));
  const body = Buffer.isBuffer(input.plaintext)
    ? input.plaintext
    : Buffer.from(input.plaintext, "utf8");
  const ct = Buffer.concat([cipher.update(body), cipher.final()]);
  return {
    v: VAULT_CRYPTO_VERSION,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Opens a box, or throws.
 *
 * Throws rather than returning null: every failure here means the file has been altered, the label
 * does not match, or the key is wrong — and each of those is a reason to stop, not to carry on with
 * a missing value. The message deliberately says which field failed and never what was in it.
 */
export function open(input: { key: Buffer; field: string; box: SealedBox }): Buffer {
  assertKey(input.key, "opening key");
  const { box } = input;
  if (box?.v !== VAULT_CRYPTO_VERSION) {
    throw new VaultCryptoError(
      `"${input.field}" was written in vault format v${box?.v ?? "?"}, and this build reads ` +
        `v${VAULT_CRYPTO_VERSION}. Refusing to guess at the layout.`,
    );
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, input.key, Buffer.from(box.iv, "base64"), {
      authTagLength: 16,
    });
    decipher.setAAD(aad(input.field, box.v));
    decipher.setAuthTag(Buffer.from(box.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(box.ct, "base64")), decipher.final()]);
  } catch {
    throw new VaultCryptoError(
      `"${input.field}" did not authenticate. Either the vault file was altered, or this value ` +
        `was filed under a different name — both mean the value must not be used.`,
    );
  }
}

/** Opens a box as text. Convenience for the ordinary case; same refusal on failure. */
export function openText(input: { key: Buffer; field: string; box: SealedBox }): string {
  return open(input).toString("utf8");
}

/** Wraps a field's data key with the master key. The label keeps a DEK from being re-filed. */
export function wrapDek(input: { masterKey: Buffer; field: string; dek: Buffer }): SealedBox {
  assertKey(input.dek, "data key");
  return seal({ key: input.masterKey, field: `dek:${input.field}`, plaintext: input.dek });
}

export function unwrapDek(input: { masterKey: Buffer; field: string; wrapped: SealedBox }): Buffer {
  const dek = open({ key: input.masterKey, field: `dek:${input.field}`, box: input.wrapped });
  assertKey(dek, "unwrapped data key");
  return dek;
}

/** Constant-time comparison for MACs and digests. Wrong-length inputs are simply not equal. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
