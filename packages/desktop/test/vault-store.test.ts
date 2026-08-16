/**
 * The vault as a whole: what it stores, what it refuses to store, and what it does when the file
 * or the keychain is not what it expects.
 *
 * The fake keychain here is a *dummy vault fixture* in the sense 004 Phase 4 requires — no real
 * personal data, no real credential, and no OS keychain touched. What it exercises is the file
 * format, the lifecycle and the refusals; the parts that depend on Electron are one thin adapter
 * away in `safe-storage.ts` and are covered by the probe script instead.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SafeStoragePort, StorageAvailability } from "../src/vault/safe-storage.js";
import {
  createProfileVault,
  VaultCorruptError,
  VaultError,
  VaultLockedError,
  type ProfileVault,
} from "../src/vault/store.js";

/**
 * A stand-in for the OS keychain: a reversible transform that is obviously not encryption.
 *
 * Deliberately not "return the input" — the tests below assert that the wrapped key on disk does
 * not equal the key in memory, and an identity transform would make that assertion pass for the
 * wrong reason.
 */
function fakeKeychain(): SafeStoragePort & { fail: boolean } {
  const port = {
    fail: false,
    async encryptString(plaintext: string): Promise<Buffer> {
      return Buffer.from(`kc:${Buffer.from(plaintext, "utf8").toString("hex")}`, "utf8");
    },
    async decryptString(ciphertext: Buffer): Promise<string> {
      if (port.fail) throw new Error("keychain entry not found");
      const text = ciphertext.toString("utf8");
      if (!text.startsWith("kc:")) throw new Error("not ours");
      return Buffer.from(text.slice(3), "hex").toString("utf8");
    },
  };
  return port;
}

const USABLE: StorageAvailability = { usable: true, reason: "ok", remedy: [] };

let dir: string;
let keychain: ReturnType<typeof fakeKeychain>;
let onLock: ReturnType<typeof vi.fn>;
let vault: ProfileVault;
let clock: Date;

function build(availability: StorageAvailability = USABLE): ProfileVault {
  return createProfileVault({
    filePath: path.join(dir, "profile-vault.json"),
    auditPath: path.join(dir, "vault-audit.jsonl"),
    safeStorage: keychain,
    availability,
    now: () => clock,
    onLock,
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-store-"));
  keychain = fakeKeychain();
  onLock = vi.fn();
  clock = new Date("2026-08-16T10:00:00.000Z");
  vault = build();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

async function readVaultFile(): Promise<string> {
  return fs.readFile(path.join(dir, "profile-vault.json"), "utf8");
}

describe("opening a vault", () => {
  it("writes nothing until it is unlocked", async () => {
    const status = await vault.status();
    expect(status).toMatchObject({ exists: false, unlocked: false, storageUsable: true });
    await expect(fs.access(path.join(dir, "profile-vault.json"))).rejects.toThrow();
  });

  it("creates the file on first unlock, readable only by its owner", async () => {
    await vault.unlock();
    const stat = await fs.stat(path.join(dir, "profile-vault.json"));
    expect(stat.mode & 0o777).toBe(0o600);
    expect(vault.unlocked).toBe(true);
  });

  it("refuses to start where the platform cannot encrypt — 003 §4.4", async () => {
    // The Linux no-keyring case. Nothing is created: a vault here would be plaintext wearing the
    // word "vault".
    const refused = build({
      usable: false,
      reason: "Linux selected the basic_text backend, which stores plaintext",
      remedy: ["install gnome-keyring"],
    });
    await expect(refused.unlock()).rejects.toThrow(VaultLockedError);
    await expect(fs.access(path.join(dir, "profile-vault.json"))).rejects.toThrow();
    expect((await refused.status()).storageUsable).toBe(false);
  });

  it("reopens an existing vault and reads what was stored", async () => {
    await vault.unlock();
    await vault.put("given_name", "小明");
    await vault.put("id_number", "310101199001011234");
    await vault.lock();

    const reopened = build();
    await reopened.unlock();
    expect(await reopened.reveal("id_number", { reason: "test" })).toBe("310101199001011234");
    expect(await reopened.reveal("given_name", { reason: "test" })).toBe("小明");
  });

  it("stays locked when the keychain no longer has the key, and deletes nothing", async () => {
    await vault.unlock();
    await vault.put("id_number", "310101199001011234");
    await vault.lock();

    keychain.fail = true;
    const reopened = build();
    await expect(reopened.unlock()).rejects.toThrow(/could not be recovered|keychain/);
    expect(await readVaultFile()).toContain("fields");
  });

  it("refuses a damaged file rather than starting a fresh one over it", async () => {
    await vault.unlock();
    await vault.put("given_name", "小明");
    await vault.lock();
    await fs.writeFile(path.join(dir, "profile-vault.json"), "{ not json");

    await expect(build().unlock()).rejects.toThrow(VaultCorruptError);
  });

  it("refuses a newer vault from a breaking layout it cannot read (004 Phase 6)", async () => {
    // A future breaking change stamps `compat` to its own version, so an older app refuses rather
    // than misreading — fail closed for a security file.
    await vault.unlock();
    await vault.lock();
    const file = JSON.parse(await readVaultFile()) as Record<string, unknown>;
    await fs.writeFile(
      path.join(dir, "profile-vault.json"),
      JSON.stringify({ ...file, version: 99, compat: 99 }),
    );
    await expect(build().unlock()).rejects.toThrow(/v99/);
  });

  it("reads a newer vault whose change was additive, after a rollback (004 Phase 6)", async () => {
    // A newer app that only added fields stamps `compat` back at 1; an older app reads it, ignoring
    // what it does not know, instead of losing the vault to a rollback.
    await vault.unlock();
    await vault.put("given_name", "小明");
    await vault.lock();
    const file = JSON.parse(await readVaultFile()) as Record<string, unknown>;
    await fs.writeFile(
      path.join(dir, "profile-vault.json"),
      JSON.stringify({ ...file, version: 99, compat: 1, aFieldFromTheFuture: "ignored" }),
    );
    const reopened = build();
    await reopened.unlock();
    expect(await reopened.reveal("given_name", { reason: "test" })).toBe("小明");
  });
});

describe("what may be stored", () => {
  beforeEach(async () => {
    await vault.unlock();
  });

  it("stores a value with no plaintext anywhere in the file", async () => {
    await vault.put("id_number", "310101199001011234");
    await vault.put("payment_token", "tok_1P4kJ2abcdef");
    const raw = await readVaultFile();
    expect(raw).not.toContain("310101199001011234");
    expect(raw).not.toContain("tok_1P4kJ2abcdef");
    // Field names are structure, not secrets — they are how a person reads their own settings page.
    expect(raw).toContain("id_number");
  });

  it("wraps the master key rather than writing it", async () => {
    const file = JSON.parse(await readVaultFile()) as { masterKey: string };
    expect(file.masterKey.startsWith("kc:")).toBe(false); // base64 of the wrapped form
    expect(Buffer.from(file.masterKey, "base64").toString("utf8").startsWith("kc:")).toBe(true);
  });

  it("refuses every never-persist field, whatever tier is asked for", async () => {
    for (const field of ["cvv", "otp", "three_d_secure", "payment_password", "passkey"]) {
      await expect(vault.put(field, "123456")).rejects.toThrow(VaultError);
      await expect(vault.put(field, "123456", { tier: "L2" })).rejects.toThrow(/never stored/);
    }
    expect((await vault.status()).fields).toEqual([]);
  });

  it("refuses to file anything under L3", async () => {
    await expect(vault.put("id_number", "x", { tier: "L3" })).rejects.toThrow(/fixed list/);
  });

  it("refuses an empty value instead of storing a blank", async () => {
    await expect(vault.put("given_name", "")).rejects.toThrow(/no value to store/);
  });

  it("refuses everything while locked", async () => {
    await vault.lock();
    await expect(vault.put("given_name", "小明")).rejects.toThrow(VaultLockedError);
    await expect(vault.reveal("given_name", { reason: "x" })).rejects.toThrow(VaultLockedError);
    await expect(vault.project(["given_name"])).rejects.toThrow(VaultLockedError);
    await expect(vault.exportAll({ reauthenticated: true })).rejects.toThrow(VaultLockedError);
  });

  it("tells the caller to revoke grants when it locks", async () => {
    await vault.lock();
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("gives each field its own key, so one value's key opens nothing else", async () => {
    await vault.put("id_number", "310101199001011234");
    await vault.put("passport_number", "E12345678");
    const file = JSON.parse(await readVaultFile()) as {
      fields: Record<string, { dek: { ct: string } }>;
    };
    expect(file.fields["id_number"]!.dek.ct).not.toBe(file.fields["passport_number"]!.dek.ct);
  });
});

describe("what a model may see", () => {
  beforeEach(async () => {
    await vault.unlock();
    await vault.put("given_name", "小明");
    await vault.put("contact_email", "ming@example.com");
    await vault.put("id_number", "310101199001011234");
    await vault.put("phone_number", "13800005678");
  });

  it("projects L1 fields and silently omits L2 ones", async () => {
    const projection = await vault.project([
      "given_name",
      "contact_email",
      "id_number",
      "phone_number",
    ]);
    expect(projection).toEqual({ given_name: "小明", contact_email: "m***@example.com" });
    expect(JSON.stringify(projection)).not.toContain("310101199001011234");
    expect(JSON.stringify(projection)).not.toContain("13800005678");
  });

  it("shows a masked L1 field in full only when the grant asked for it", async () => {
    expect(await vault.project(["contact_email"], { full: ["contact_email"] })).toEqual({
      contact_email: "ming@example.com",
    });
  });

  it("omits a field that is not stored, without saying anything about it", async () => {
    expect(await vault.project(["loyalty_tier"])).toEqual({});
  });
});

describe("changing and removing", () => {
  beforeEach(async () => {
    await vault.unlock();
    await vault.put("loyalty_number", "MU-88881234");
    await vault.put("given_name", "小明");
  });

  it("refuses to loosen a tier without an explicit confirmation", async () => {
    await expect(vault.reclassify("loyalty_number", "L1")).rejects.toThrow(/explicit confirmation/);
    expect(await vault.project(["loyalty_number"])).toEqual({});
  });

  it("loosens with one, and the field then projects", async () => {
    await vault.reclassify("loyalty_number", "L1", { confirmed: true });
    // Still masked once projected: loosening the tier lets a model *see* the field, and the
    // table's own mask decides how much of it (003 §3 — the model gets `138****5678`, not the
    // whole number).
    expect(await vault.project(["loyalty_number"])).toEqual({ loyalty_number: "MU-****1234" });
  });

  it("tightens without ceremony", async () => {
    await vault.reclassify("given_name", "L2");
    expect(await vault.project(["given_name"])).toEqual({});
  });

  it("refuses to reclassify anything in or out of L3", async () => {
    await expect(vault.reclassify("cvv", "L2", { confirmed: true })).rejects.toThrow(VaultError);
    await expect(vault.reclassify("given_name", "L3")).rejects.toThrow(VaultError);
  });

  it("deletes one field and leaves the rest", async () => {
    expect(await vault.deleteField("given_name")).toBe(true);
    expect(vault.has("given_name")).toBe(false);
    expect(vault.has("loyalty_number")).toBe(true);
    expect(await vault.deleteField("given_name")).toBe(false);
  });

  it("deletes everything on request, keeping the vault itself", async () => {
    await vault.deleteAll();
    expect((await vault.status()).fields).toEqual([]);
    expect(await readVaultFile()).not.toContain("MU-88881234");
    await vault.put("given_name", "小明");
    expect(await vault.reveal("given_name", { reason: "test" })).toBe("小明");
  });

  it("refuses an export nobody re-authenticated for", async () => {
    await expect(vault.exportAll({ reauthenticated: false })).rejects.toThrow(/re-authenticate/i);
  });

  it("exports every value once the OS has confirmed who is asking", async () => {
    expect(await vault.exportAll({ reauthenticated: true })).toEqual({
      loyalty_number: "MU-88881234",
      given_name: "小明",
    });
  });

  it("rotates the master key while leaving values readable", async () => {
    const before = JSON.parse(await readVaultFile()) as {
      masterKey: string;
      fields: Record<string, { dek: { ct: string }; value: { ct: string } }>;
    };
    await vault.rotate();
    const after = JSON.parse(await readVaultFile()) as typeof before;

    expect(after.masterKey).not.toBe(before.masterKey);
    // Data keys are rewrapped; the values themselves are untouched, which is the point of having
    // per-field keys at all.
    expect(after.fields["given_name"]!.dek.ct).not.toBe(before.fields["given_name"]!.dek.ct);
    expect(after.fields["given_name"]!.value.ct).toBe(before.fields["given_name"]!.value.ct);
    expect(await vault.reveal("given_name", { reason: "after rotate" })).toBe("小明");

    // And it survives a reopen: the new key really did reach the keychain.
    await vault.lock();
    const reopened = build();
    await reopened.unlock();
    expect(await reopened.reveal("loyalty_number", { reason: "after rotate" })).toBe("MU-88881234");
  });
});

describe("the audit trail it leaves", () => {
  it("records every operation by name, and no value anywhere", async () => {
    await vault.unlock();
    await vault.put("id_number", "310101199001011234");
    await vault.reveal("id_number", { reason: "secure fill", grantId: "g-1" });
    await vault.project(["given_name"]);
    await vault.deleteField("id_number");
    await vault.exportAll({ reauthenticated: true });
    await vault.lock();

    const raw = await fs.readFile(path.join(dir, "vault-audit.jsonl"), "utf8");
    expect(raw).not.toContain("310101199001011234");
    const events = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { event: string }).event);
    expect(events).toContain("unlock");
    expect(events).toContain("field_read");
    expect(events).toContain("delete");
    expect(events).toContain("export");
    expect(events.at(-1)).toBe("lock");
  });

  it("remembers the chain's tail, so deleting the log is detectable", async () => {
    await vault.unlock();
    await vault.put("given_name", "小明");
    const remembered = vault.auditTailMac();
    expect(remembered).toHaveLength(64);

    await fs.rm(path.join(dir, "vault-audit.jsonl"));
    const reopened = build();
    await reopened.unlock();
    // The fresh log verifies internally; only the remembered digest says something is missing.
    expect(reopened.auditLog()!.verify(remembered)).toMatchObject({ ok: false });
  });
});
