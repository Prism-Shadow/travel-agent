/**
 * Filling a form field with something the agent never sees, and every refusal on the way there.
 *
 * The interesting assertions are about *where the value is*: never in the arguments the agent sent,
 * never in the audit log, never in what the relay is told for redaction — only in the one call that
 * writes it into the page. The dummy values below are fixtures, not real data (004 Phase 4).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GrantRegistry, handleFor } from "../src/vault/grants.js";
import { SecureFiller, type FillPort } from "../src/vault/secure-fill.js";
import { SensitiveElementRegistry } from "../src/vault/sensitive-elements.js";
import { createProfileVault, type ProfileVault } from "../src/vault/store.js";
import type { SafeStoragePort, StorageAvailability } from "../src/vault/safe-storage.js";

const TASK = "task-1755000000000-aaaa1111";
const ID_NUMBER = "310101199001011234";
const USABLE: StorageAvailability = { usable: true, reason: "ok", remedy: [] };

function fakeKeychain(): SafeStoragePort {
  return {
    async encryptString(plaintext) {
      return Buffer.from(`kc:${Buffer.from(plaintext, "utf8").toString("hex")}`, "utf8");
    },
    async decryptString(ciphertext) {
      return Buffer.from(ciphertext.toString("utf8").slice(3), "hex").toString("utf8");
    },
  };
}

/** A page that records what was written to it, so a test can look for the value in the wrong places. */
function fakePage(overrides: Partial<FillPort> = {}) {
  const written: Array<{ selector: string; value: string }> = [];
  const port: FillPort = {
    fillField: vi.fn(async ({ selector, value }) => {
      written.push({ selector, value });
      return { filled: true, box: { x: 10, y: 20, width: 200, height: 32 } };
    }),
    readField: vi.fn(async () => ""),
    hasField: vi.fn(async () => true),
    currentUrl: vi.fn(async () => "https://ctrip.com/booking"),
    ...overrides,
  };
  return { port, written };
}

let dir: string;
let vault: ProfileVault;
let grants: GrantRegistry;
let sensitive: SensitiveElementRegistry;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "secure-fill-"));
  vault = createProfileVault({
    filePath: path.join(dir, "profile-vault.json"),
    auditPath: path.join(dir, "vault-audit.jsonl"),
    safeStorage: fakeKeychain(),
    availability: USABLE,
  });
  await vault.unlock();
  await vault.put("id_number", ID_NUMBER);
  grants = new GrantRegistry({ newId: () => "g-test001" });
  sensitive = new SensitiveElementRegistry();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

async function grantFor(fields = ["id_number"], domain = "ctrip.com") {
  return grants.approve({
    taskId: TASK,
    domain,
    purpose: "填写乘机人证件",
    fields,
    mode: "handle",
    channel: "card",
  });
}

function fillerWith(port: FillPort): SecureFiller {
  return new SecureFiller({ vault, grants, sensitive, port, audit: vault.auditLog() });
}

const target = { targetId: "T-1", selector: "#idNumber", domain: "ctrip.com" };

describe("filling by handle", () => {
  it("writes the value into the page and nowhere else", async () => {
    const grant = await grantFor();
    const page = fakePage();
    const result = await fillerWith(page.port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target,
    });

    expect(result).toMatchObject({ ok: true, field: "id_number" });
    expect(page.written).toEqual([{ selector: "#idNumber", value: ID_NUMBER }]);

    // Not in the audit log…
    const audit = await fs.readFile(path.join(dir, "vault-audit.jsonl"), "utf8");
    expect(audit).not.toContain(ID_NUMBER);
    expect(audit).toContain("fill_performed");
    // …and not in what the relay is told, which is fingerprints and shapes.
    expect(JSON.stringify(sensitive.publish("T-1"))).not.toContain(ID_NUMBER);
  });

  it("registers the element so a screenshot can cover it", async () => {
    const grant = await grantFor();
    await fillerWith(fakePage().port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target,
    });
    const plan = sensitive.maskPlan("T-1");
    expect(plan.boxes).toEqual([{ x: 10, y: 20, width: 200, height: 32 }]);
    expect(plan.unlocated).toEqual([]);
  });

  it("publishes a fingerprint that matches the value and nothing else", async () => {
    const grant = await grantFor();
    await fillerWith(fakePage().port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target,
    });
    const [published] = sensitive.publish("T-1");
    expect(published).toBeDefined();
    expect(sensitive.matches(published!, ID_NUMBER)).toBe(true);
    expect(sensitive.matches(published!, "310101199001011235")).toBe(false);
    expect(published!.length).toBe(18);
    expect(published!.shape).toBe("d".repeat(18));
  });
});

describe("what a fill refuses", () => {
  it("refuses a handle for a grant that does not cover this field", async () => {
    const grant = await grantFor(["phone_number"]);
    const page = fakePage();
    const result = await fillerWith(page.port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target,
    });
    expect(result).toMatchObject({ ok: false, reason: "field_not_granted" });
    expect(page.written).toEqual([]);
  });

  it("refuses when the page has moved to another domain since the grant", async () => {
    // The check that matters: against the page the fill is about to happen on.
    const grant = await grantFor();
    const page = fakePage();
    const result = await fillerWith(page.port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target: { ...target, domain: "ctrip-pay.example.com" },
    });
    expect(result).toMatchObject({ ok: false, reason: "wrong_domain" });
    expect(page.written).toEqual([]);
  });

  it("refuses a handle from another turn", async () => {
    const grant = await grantFor();
    const result = await fillerWith(fakePage().port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: "task-1755000000001-bbbb2222",
      target,
    });
    expect(result).toMatchObject({ ok: false, reason: "wrong_task" });
  });

  it("refuses after the grant was revoked, including by a vault lock", async () => {
    const grant = await grantFor();
    await grants.revokeAll();
    const result = await fillerWith(fakePage().port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target,
    });
    expect(result).toMatchObject({ ok: false, reason: "revoked" });
  });

  it("never fills a payment password or a passkey, even with a grant", async () => {
    // The grant registry will not issue one for L3, so this is the belt-and-braces path: a
    // hand-built handle naming a never-filled field.
    const grant = await grantFor(["payment_token"]);
    const result = await fillerWith(fakePage().port).fill({
      handle: handleFor(grant.grantId, "payment_password"),
      taskId: TASK,
      target,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses when nothing is stored for the field", async () => {
    const grant = await grantFor(["passport_number"]);
    const result = await fillerWith(fakePage().port).fill({
      handle: handleFor(grant.grantId, "passport_number"),
      taskId: TASK,
      target,
    });
    expect(result).toMatchObject({ ok: false, reason: "not_stored" });
  });

  it("refuses when the vault is locked", async () => {
    const grant = await grantFor();
    await vault.lock();
    const result = await fillerWith(fakePage().port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target,
    });
    expect(result).toMatchObject({ ok: false, reason: "vault_locked" });
  });

  it("refuses when the element is gone, without decrypting anything", async () => {
    const grant = await grantFor();
    const page = fakePage({ hasField: vi.fn(async () => false) });
    const result = await fillerWith(page.port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target,
    });
    expect(result).toMatchObject({ ok: false, reason: "element_missing" });
    expect(page.port.fillField).not.toHaveBeenCalled();
  });

  it("reports a control that ignored the write, rather than claiming success", async () => {
    // Known-fragile part: a framework-controlled input often ignores a direct value assignment.
    const grant = await grantFor();
    const page = fakePage({ fillField: vi.fn(async () => ({ filled: false })) });
    const result = await fillerWith(page.port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target,
    });
    expect(result).toMatchObject({ ok: false, reason: "fill_failed" });
    expect(sensitive.live()).toEqual([]);
  });

  it("records every refusal by reason, with no value anywhere", async () => {
    const grant = await grantFor(["phone_number"]);
    await fillerWith(fakePage().port).fill({
      handle: handleFor(grant.grantId, "id_number"),
      taskId: TASK,
      target,
    });
    const audit = await fs.readFile(path.join(dir, "vault-audit.jsonl"), "utf8");
    expect(audit).toContain("fill_rejected");
    expect(audit).toContain("field_not_granted");
    expect(audit).not.toContain(ID_NUMBER);
  });
});
