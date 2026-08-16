/**
 * The vault's encryption, tested for the properties the design leans on rather than for "it round
 * trips".
 *
 * Two of them are the reason the code looks the way it does: a value cannot be moved from one field
 * to another inside the file (the AAD binds the field name), and a wrapped data key cannot be read
 * as a value or vice versa. Both are silent failures if the AAD is ever dropped — the file still
 * decrypts, just into the wrong field — so they are pinned here.
 */
import { describe, expect, it } from "vitest";

import {
  generateKey,
  open,
  openText,
  sameSecret,
  seal,
  unwrapDek,
  VAULT_CRYPTO_VERSION,
  VaultCryptoError,
  wipe,
  wrapDek,
} from "../src/vault/crypto.js";

describe("sealing a value", () => {
  it("round-trips under the same key and field", () => {
    const key = generateKey();
    const box = seal({ key, field: "passport_number", plaintext: "E12345678" });
    expect(openText({ key, field: "passport_number", box })).toBe("E12345678");
  });

  it("never leaves the value visible in what gets written to disk", () => {
    const key = generateKey();
    const box = seal({ key, field: "id_number", plaintext: "310101199001011234" });
    expect(JSON.stringify(box)).not.toContain("310101199001011234");
    expect(Buffer.from(box.ct, "base64").toString("latin1")).not.toContain("3101011990");
  });

  it("produces a different ciphertext every time, so equal values are not visibly equal", () => {
    const key = generateKey();
    const a = seal({ key, field: "phone_number", plaintext: "13800005678" });
    const b = seal({ key, field: "phone_number", plaintext: "13800005678" });
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
  });

  it("refuses to open a box that was filed under another field", () => {
    // The attack this stops: someone with write access to the vault file swaps the phone number's
    // ciphertext into the payment token's slot, and the application fills one where it meant the
    // other. Without the AAD binding, that swap decrypts cleanly.
    const key = generateKey();
    const box = seal({ key, field: "phone_number", plaintext: "13800005678" });
    expect(() => open({ key, field: "payment_token", box })).toThrow(VaultCryptoError);
    expect(() => open({ key, field: "payment_token", box })).toThrow(/did not authenticate/);
  });

  it("refuses a box whose ciphertext or tag was edited", () => {
    const key = generateKey();
    const box = seal({ key, field: "id_number", plaintext: "310101199001011234" });
    const flipped = Buffer.from(box.ct, "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 0x01;
    expect(() =>
      open({ key, field: "id_number", box: { ...box, ct: flipped.toString("base64") } }),
    ).toThrow(VaultCryptoError);
    expect(() =>
      open({ key, field: "id_number", box: { ...box, tag: Buffer.alloc(16).toString("base64") } }),
    ).toThrow(VaultCryptoError);
  });

  it("refuses a box from another key", () => {
    const box = seal({ key: generateKey(), field: "id_number", plaintext: "x" });
    expect(() => open({ key: generateKey(), field: "id_number", box })).toThrow(VaultCryptoError);
  });

  it("refuses a format version it does not read, instead of guessing at the layout", () => {
    const key = generateKey();
    const box = seal({ key, field: "id_number", plaintext: "x" });
    expect(() =>
      open({ key, field: "id_number", box: { ...box, v: VAULT_CRYPTO_VERSION + 1 } }),
    ).toThrow(/format v/);
  });

  it("refuses a key of the wrong size rather than deriving one", () => {
    expect(() => seal({ key: Buffer.alloc(16), field: "f", plaintext: "x" })).toThrow(
      /must be 32 bytes/,
    );
  });
});

describe("field-level data keys", () => {
  it("wraps and unwraps a data key under the master key", () => {
    const masterKey = generateKey();
    const dek = generateKey();
    const wrapped = wrapDek({ masterKey, field: "id_number", dek });
    expect(unwrapDek({ masterKey, field: "id_number", wrapped }).equals(dek)).toBe(true);
  });

  it("keeps a data key from being unwrapped as another field's", () => {
    const masterKey = generateKey();
    const wrapped = wrapDek({ masterKey, field: "id_number", dek: generateKey() });
    expect(() => unwrapDek({ masterKey, field: "payment_token", wrapped })).toThrow(
      VaultCryptoError,
    );
  });

  it("keeps a wrapped key from being opened as a value of the same name", () => {
    // `dek:<field>` and `<field>` are different labels on purpose: a file where the two are
    // interchangeable lets a value be substituted for a key.
    const masterKey = generateKey();
    const wrapped = wrapDek({ masterKey, field: "id_number", dek: generateKey() });
    expect(() => open({ key: masterKey, field: "id_number", box: wrapped })).toThrow(
      VaultCryptoError,
    );
  });

  it("decrypts exactly one field at a time — a second field's key does not open the first", () => {
    const masterKey = generateKey();
    const idDek = unwrapDek({
      masterKey,
      field: "id_number",
      wrapped: wrapDek({ masterKey, field: "id_number", dek: generateKey() }),
    });
    const phoneBox = seal({ key: generateKey(), field: "phone_number", plaintext: "13800005678" });
    expect(() => open({ key: idDek, field: "phone_number", box: phoneBox })).toThrow(
      VaultCryptoError,
    );
  });
});

describe("clearing a key", () => {
  it("overwrites the buffer in place", () => {
    const key = generateKey();
    wipe(key);
    expect(key.equals(Buffer.alloc(32))).toBe(true);
  });

  it("does nothing, quietly, for a key that was never there", () => {
    expect(() => wipe(null)).not.toThrow();
    expect(() => wipe(undefined)).not.toThrow();
  });
});

describe("comparing secrets", () => {
  it("is true only for identical strings, and never throws on a length mismatch", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
    expect(sameSecret("", "")).toBe(true);
  });
});
