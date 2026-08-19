/**
 * Which fields may reach a model, and the two boundaries that no setting can move.
 *
 * The interesting assertions here are the refusals. A tier table that only says where things
 * *belong* is documentation; what makes it a control is that L3 has no way in or out, that an
 * unrecognised field lands on the strict side, and that the one loosening move a person can make
 * (L2 → L1) cannot happen without a confirmation to record.
 */
import { describe, expect, it } from "vitest";

import {
  isNeverFilled,
  isNeverPersisted,
  judgeTierChange,
  knownFields,
  maskFor,
  projectValue,
  specFor,
  tierOf,
} from "../src/vault/tiers.js";
import { judgeStorage, readStorageFacts } from "../src/vault/safe-storage.js";

describe("the default classification", () => {
  it("puts the document type in L1 and the number in L2", () => {
    // The model has to pick which document to use; it never needs to read the number.
    expect(tierOf("id_document_type")).toBe("L1");
    expect(tierOf("id_number")).toBe("L2");
    expect(tierOf("passport_number")).toBe("L2");
  });

  it("treats a merchant payment token as an encrypted identifier, not a public one", () => {
    // The token may itself be able to charge the card.
    expect(tierOf("payment_token")).toBe("L2");
    expect(maskFor("payment_token", "tok_1P4kJ2abcdef")).toBe("••••");
  });

  it("keeps every never-persist field out of storage", () => {
    for (const field of [
      "cvv",
      "otp",
      "three_d_secure",
      "account_password",
      "payment_password",
      "passkey",
    ]) {
      expect(tierOf(field)).toBe("L3");
      expect(isNeverPersisted(field)).toBe(true);
    }
  });

  it("never fills a payment password or a passkey, even inside a secret phase", () => {
    expect(isNeverFilled("payment_password")).toBe(true);
    expect(isNeverFilled("passkey")).toBe(true);
    // A one-time code *may* be filled once the scoped secret phase is proven — a different rule.
    expect(isNeverFilled("otp")).toBe(false);
  });

  it("lands an unknown field on the strict side", () => {
    // The two failure directions are not symmetric: a new identifier mistaken for a preference is
    // handed to a model, while a preference mistaken for an identifier merely needs a handle.
    expect(tierOf("national_insurance_number")).toBe("L2");
    expect(specFor("national_insurance_number")).toBeUndefined();
  });

  it("describes every field it knows with a label a person can read", () => {
    for (const spec of knownFields()) {
      expect(spec.label.trim()).not.toBe("");
      expect(["L1", "L2", "L3"]).toContain(spec.tier);
    }
  });
});

describe("what a projection shows", () => {
  it("gives an L1 value as itself", () => {
    expect(projectValue({ field: "given_name", value: "小明", tier: "L1" })).toBe("小明");
  });

  it("masks an email by default, and only shows it in full when the grant asked for it", () => {
    expect(projectValue({ field: "contact_email", value: "ming@example.com", tier: "L1" })).toBe(
      "m***@example.com",
    );
    expect(
      projectValue({ field: "contact_email", value: "ming@example.com", tier: "L1", full: true }),
    ).toBe("ming@example.com");
  });

  it("shows nothing at all for L2 and L3, whatever is asked for", () => {
    expect(
      projectValue({ field: "id_number", value: "310101199001011234", tier: "L2" }),
    ).toBeNull();
    expect(
      projectValue({ field: "id_number", value: "310101199001011234", tier: "L2", full: true }),
    ).toBeNull();
    expect(projectValue({ field: "cvv", value: "123", tier: "L3" })).toBeNull();
  });

  it("masks a phone to its last four, the way a booking form shows it back", () => {
    expect(maskFor("phone_number", "13800005678")).toBe("138****5678");
  });

  it("masks the door number out of an address and leaves the street", () => {
    expect(maskFor("street_address", "南京西路 1266 号 32 楼")).toBe("南京西路 **** 号 ** 楼");
  });
});

describe("changing a field's tier", () => {
  it("lets a person tighten without ceremony", () => {
    expect(judgeTierChange({ field: "contact_email", to: "L2" })).toEqual({
      allowed: true,
      requiresConfirmation: false,
      from: "L1",
      to: "L2",
    });
  });

  it("requires a confirmation to loosen, because that hands the value to a model", () => {
    expect(judgeTierChange({ field: "loyalty_number", to: "L1" })).toEqual({
      allowed: true,
      requiresConfirmation: true,
      from: "L2",
      to: "L1",
    });
  });

  it("refuses to move anything out of L3", () => {
    for (const field of ["cvv", "otp", "payment_password"]) {
      expect(judgeTierChange({ field, to: "L1" })).toMatchObject({ allowed: false });
      expect(judgeTierChange({ field, to: "L2" })).toMatchObject({ allowed: false });
    }
  });

  it("refuses to move anything into L3, since that list is not a level to be promoted to", () => {
    expect(judgeTierChange({ field: "id_number", to: "L3" })).toMatchObject({ allowed: false });
    expect(tierOf("id_number", { id_number: "L3" })).toBe("L2");
  });

  it("reads an existing override as the current tier", () => {
    expect(tierOf("loyalty_number", { loyalty_number: "L1" })).toBe("L1");
    expect(
      judgeTierChange({ field: "loyalty_number", to: "L2", overrides: { loyalty_number: "L1" } }),
    ).toMatchObject({ requiresConfirmation: false, from: "L1", to: "L2" });
  });
});

describe("whether this machine may hold a vault at all", () => {
  it("allows it when the platform reports encrypted storage", () => {
    expect(
      judgeStorage({ platform: "darwin", encryptionAvailable: true, backend: null }).usable,
    ).toBe(true);
    expect(
      judgeStorage({ platform: "linux", encryptionAvailable: true, backend: "gnome_libsecret" })
        .usable,
    ).toBe(true);
  });

  it("refuses when encryption is unavailable, and says what to do", () => {
    const verdict = judgeStorage({ platform: "win32", encryptionAvailable: false, backend: null });
    expect(verdict.usable).toBe(false);
    expect(verdict.remedy.join(" ")).toMatch(/keyring|password-store/);
  });

  it("refuses the Linux plaintext backend — attack A9", () => {
    // `basic_text` is what Electron falls back to with no keyring, and it does not encrypt.
    const verdict = judgeStorage({
      platform: "linux",
      encryptionAvailable: true,
      backend: "basic_text",
    });
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toMatch(/plaintext/);
  });

  it("refuses when the backend cannot be read, rather than assuming it is real", () => {
    expect(
      judgeStorage({ platform: "linux", encryptionAvailable: true, backend: null }).usable,
    ).toBe(false);
  });

  it("reads the facts out of Electron's object, tolerating every way the call can fail", () => {
    expect(
      readStorageFacts(
        {
          isEncryptionAvailable: () => {
            throw new Error("no display");
          },
        },
        "linux",
      ),
    ).toEqual({ platform: "linux", encryptionAvailable: false, backend: null });

    expect(
      readStorageFacts(
        {
          isEncryptionAvailable: () => true,
          getSelectedStorageBackend: () => {
            throw new Error("unsupported");
          },
        },
        "linux",
      ).backend,
    ).toBeNull();

    // The backend question is only asked on Linux; elsewhere it is not what decides.
    expect(readStorageFacts({ isEncryptionAvailable: () => true }, "darwin")).toEqual({
      platform: "darwin",
      encryptionAvailable: true,
      backend: null,
    });
  });
});
