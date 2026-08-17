/**
 * The parts of Chrome's `os_crypt` this app has to reproduce exactly.
 *
 * These are not our formats. Every constant — the salt, the iteration counts, the sixteen-space IV,
 * the epoch offset — belongs to Chromium, and getting one wrong produces plausible-looking garbage
 * rather than an error: AES-CBC with the wrong key decrypts to noise, and a mistimed epoch produces
 * a cookie that expired in the seventeenth century and is silently dropped on arrival. Both failures
 * look exactly like "the import quietly did nothing", which is why they are pinned here with
 * round-trips built from the same constants Chromium writes with.
 */
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ChromeDecryptError,
  chromeTimeToIso,
  chromeTimeToUnixSeconds,
  decryptValue,
  deriveCbcKey,
  LINUX_FALLBACK_PASSWORD,
} from "../src/browser-import/chrome-crypto.js";

/** Encrypts the way Chromium does on Linux/macOS, so the decryptor can be tested against it. */
function sealLikeChromiumCbc(plaintext: string, key: Buffer, prefix = "v10"): Buffer {
  const iv = Buffer.alloc(16, " ");
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from(prefix, "latin1"), body]);
}

/** Encrypts the way Chromium does on Windows. */
function sealLikeChromiumGcm(plaintext: string, key: Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("v10", "latin1"), nonce, body, cipher.getAuthTag()]);
}

describe("deriving the key Chromium used", () => {
  it("uses one PBKDF2 iteration on Linux and 1003 on macOS", () => {
    // Not a preference. These are the numbers the file was written with; a "safer" choice here
    // does not harden anything, it just fails to decrypt.
    expect(deriveCbcKey("secret", "linux")).toEqual(
      pbkdf2Sync("secret", "saltysalt", 1, 16, "sha1"),
    );
    expect(deriveCbcKey("secret", "darwin")).toEqual(
      pbkdf2Sync("secret", "saltysalt", 1003, 16, "sha1"),
    );
  });

  it("produces a 128-bit key, which is what AES-128-CBC takes", () => {
    expect(deriveCbcKey("secret", "linux")).toHaveLength(16);
  });

  it("refuses a platform it has no derivation for, rather than inventing one", () => {
    expect(() => deriveCbcKey("secret", "freebsd")).toThrow(ChromeDecryptError);
  });
});

describe("decrypting a value", () => {
  it("round-trips a v10 CBC value the way Linux writes it", () => {
    const key = deriveCbcKey(LINUX_FALLBACK_PASSWORD, "linux");
    const blob = sealLikeChromiumCbc("session=abc123", key);
    expect(decryptValue(blob, { scheme: "cbc", key }, "linux").toString("utf8")).toBe(
      "session=abc123",
    );
  });

  it("round-trips a v11 value, which differs only in where the password came from", () => {
    const key = deriveCbcKey("a-keyring-secret", "linux");
    const blob = sealLikeChromiumCbc("keyring-backed", key, "v11");
    expect(decryptValue(blob, { scheme: "cbc", key }, "linux").toString("utf8")).toBe(
      "keyring-backed",
    );
  });

  it("round-trips a macOS value at its own iteration count", () => {
    const key = deriveCbcKey("mac-secret", "darwin");
    const blob = sealLikeChromiumCbc("mac-cookie", key);
    expect(decryptValue(blob, { scheme: "cbc", key }, "darwin").toString("utf8")).toBe(
      "mac-cookie",
    );
  });

  it("round-trips the Windows AES-256-GCM format", () => {
    const key = randomBytes(32);
    const blob = sealLikeChromiumGcm("windows-cookie", key);
    expect(decryptValue(blob, { scheme: "gcm", key }, "win32").toString("utf8")).toBe(
      "windows-cookie",
    );
  });

  it("strips the padding rather than returning it as part of the value", () => {
    // A value that is not a whole block: the padding must come off, or every imported cookie ends
    // with invisible bytes and the site rejects it.
    const key = deriveCbcKey("secret", "linux");
    for (const plaintext of ["a", "0123456789abcde", "0123456789abcdef", "x".repeat(33)]) {
      const blob = sealLikeChromiumCbc(plaintext, key);
      expect(decryptValue(blob, { scheme: "cbc", key }, "linux").toString("utf8")).toBe(plaintext);
    }
  });

  it("refuses v20 as fatal, because no other application can read App-Bound Encryption", () => {
    // The important half is `fatal`: it stops the reader retrying four thousand rows that cannot
    // work, and it makes the dialog say why instead of reporting an empty success.
    const blob = Buffer.concat([Buffer.from("v20", "latin1"), randomBytes(32)]);
    try {
      decryptValue(blob, { scheme: "gcm", key: randomBytes(32) }, "win32");
      expect.unreachable("v20 must not decrypt");
    } catch (error) {
      expect(error).toBeInstanceOf(ChromeDecryptError);
      expect((error as ChromeDecryptError).fatal).toBe(true);
      expect((error as ChromeDecryptError).message).toMatch(/App-Bound/);
    }
  });

  it("treats an unprefixed value on Linux as already plaintext", () => {
    // Chromium writes values in the clear when os_crypt was unavailable at write time.
    const blob = Buffer.from("plain-value", "utf8");
    expect(decryptValue(blob, { scheme: "cbc", key: randomBytes(16) }, "linux").toString()).toBe(
      "plain-value",
    );
  });

  it("sends an unprefixed Windows value through DPAPI", () => {
    const blob = Buffer.from("protected", "utf8");
    const key = { scheme: "dpapi" as const, unprotect: () => Buffer.from("unwrapped") };
    expect(decryptValue(blob, key, "win32").toString("utf8")).toBe("unwrapped");
  });

  it("fails one row, not the import, when a value is the wrong length for AES", () => {
    const key = deriveCbcKey("secret", "linux");
    const truncated = Buffer.concat([Buffer.from("v10", "latin1"), randomBytes(7)]);
    try {
      decryptValue(truncated, { scheme: "cbc", key }, "linux");
      expect.unreachable("a short body must not decrypt");
    } catch (error) {
      expect(error).toBeInstanceOf(ChromeDecryptError);
      // Not fatal: the next row may be fine, and one bad row is not a failed import.
      expect((error as ChromeDecryptError).fatal).toBe(false);
    }
  });

  it("does not decrypt with the wrong key into something that looks right", () => {
    const written = deriveCbcKey("the-real-secret", "linux");
    const guessed = deriveCbcKey("the-wrong-secret", "linux");
    const blob = sealLikeChromiumCbc("session=abc123", written);
    let output: string | null = null;
    try {
      output = decryptValue(blob, { scheme: "cbc", key: guessed }, "linux").toString("utf8");
    } catch {
      output = null;
    }
    expect(output).not.toBe("session=abc123");
  });
});

describe("Chromium timestamps", () => {
  it("converts from the 1601 epoch, not the Unix one", () => {
    // 13 000 000 000 000 000 µs after 1601-01-01 is 2012-12-... — the check that matters is that
    // it lands in this century at all. Read as a Unix time it would be the year 413000.
    const seconds = chromeTimeToUnixSeconds(13_000_000_000_000_000n);
    expect(seconds).not.toBeNull();
    const year = new Date((seconds as number) * 1000).getUTCFullYear();
    expect(year).toBeGreaterThan(2000);
    expect(year).toBeLessThan(2100);
  });

  it("round-trips a known instant exactly", () => {
    // 2026-08-17T00:00:00Z, expressed in Chromium's epoch.
    const unix = Date.UTC(2026, 7, 17) / 1000;
    const chromeTime = BigInt(unix) * 1_000_000n + 11_644_473_600_000_000n;
    expect(chromeTimeToUnixSeconds(chromeTime)).toBe(unix);
    expect(chromeTimeToIso(chromeTime)).toBe("2026-08-17T00:00:00.000Z");
  });

  it("reports 0 as no expiry, which is how a session cookie is written", () => {
    expect(chromeTimeToUnixSeconds(0)).toBeNull();
    expect(chromeTimeToIso(0)).toBeNull();
  });

  it("reports a timestamp before the Unix epoch as unset rather than negative", () => {
    expect(chromeTimeToUnixSeconds(1_000n)).toBeNull();
  });
});
