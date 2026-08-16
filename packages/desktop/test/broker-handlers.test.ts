/**
 * Where the wire's claims meet main's own view of the page.
 *
 * The rows here are attack A4 of design/003 §12 at the layer that can actually answer it: a
 * well-formed call, correctly signed, whose `domain` or `targetId` is not where the agent really
 * is. The refusal has to come from comparing the claim against the page main reads for itself —
 * not from believing either side — and the mismatch has to reach the audit log, because a redirect
 * that was caught and not recorded is a redirect nobody will ever hear about.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commitmentFromConfirmation, planFromSummary } from "@travel-agent/transaction";
import type { PaymentSummary } from "@travel-agent/transaction";

import { createBrokerHandlers, type BrokerHandlerDeps } from "../src/vault/broker-handlers.js";
import { GrantRegistry, handleFor } from "../src/vault/grants.js";
import { PaymentAuthority } from "../src/vault/payment-authority.js";
import { SecureFiller, type FillPort } from "../src/vault/secure-fill.js";
import { SensitiveElementRegistry } from "../src/vault/sensitive-elements.js";
import { createProfileVault, type ProfileVault } from "../src/vault/store.js";
import type { SafeStoragePort } from "../src/vault/safe-storage.js";
import { openJournal } from "@travel-agent/transaction";

const SESSION = "session-2026-08-16-10-00-00-aaaa0001";
const TASK = "task-1755000000000-aaaa1111";
const NOW = new Date("2026-08-16T10:00:00.000Z");
const ID_NUMBER = "310101199001011234";

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

function summaryOf(): PaymentSummary {
  return {
    merchant: { name: "携程", domain: "ctrip.com" },
    item: "MU5137 2026-09-02 经济舱 1 成人",
    amount: { value: 1280, currency: "CNY" },
    cancellation: { summary: "起飞前 24 小时可退" },
    paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
    expiresAt: "2026-08-16T10:10:00.000Z",
    taskId: TASK,
  };
}

let dir: string;
let vault: ProfileVault;
let grants: GrantRegistry;
let filled: Array<{ selector: string; value: string }>;
let pages: Map<string, string>;
let deps: BrokerHandlerDeps;
let handlers: ReturnType<typeof createBrokerHandlers>;
let askForGrant: ReturnType<typeof vi.fn>;
let payments: PaymentAuthority;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "broker-handlers-"));
  vault = createProfileVault({
    filePath: path.join(dir, "profile-vault.json"),
    auditPath: path.join(dir, "vault-audit.jsonl"),
    safeStorage: fakeKeychain(),
    availability: { usable: true, reason: "ok", remedy: [] },
    now: () => NOW,
  });
  await vault.unlock();
  await vault.put("id_number", ID_NUMBER);
  await vault.put("given_name", "小明");
  await vault.put("payment_token", "tok_merchant_1P4kJ2");

  grants = new GrantRegistry({
    now: () => NOW,
    newId: () => "g-test001",
    // Wired the way the shell wires it: a closure rather than a reference, because the audit log
    // does not exist until the vault is unlocked and stops existing when it locks.
    audit: async (event, details) => {
      await vault.auditLog()?.append(event, details);
    },
  });
  filled = [];
  pages = new Map([["T-1", "https://ctrip.com/booking"]]);

  const port: FillPort = {
    fillField: vi.fn(async ({ selector, value }) => {
      filled.push({ selector, value });
      return { filled: true };
    }),
    readField: vi.fn(async () => ""),
    hasField: vi.fn(async () => true),
    currentUrl: vi.fn(async ({ targetId }) => pages.get(targetId) ?? null),
  };

  payments = new PaymentAuthority({
    vault,
    flags: { "payments.execute": true },
    journalFor: async () => openJournal(path.join(dir, "payments.jsonl")),
    port: { pay: async () => ({ orderId: "E123456" }) },
    audit: vault.auditLog(),
    now: () => NOW,
  });

  askForGrant = vi.fn(async () => ({ approved: true, fields: ["id_number", "given_name"] }));

  deps = {
    vault,
    grants,
    filler: new SecureFiller({
      vault,
      grants,
      sensitive: new SensitiveElementRegistry(),
      port,
      audit: vault.auditLog(),
    }),
    payments,
    audit: vault.auditLog(),
    currentTarget: async () => "T-1",
    pageDomain: async ({ targetId }) => {
      const url = pages.get(targetId);
      return url ? new URL(url).hostname : null;
    },
    askForGrant: askForGrant as unknown as BrokerHandlerDeps["askForGrant"],
  };
  handlers = createBrokerHandlers(deps);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

const base = { taskId: TASK, sessionId: SESSION, domain: "ctrip.com" } as const;

describe("asking for a grant", () => {
  it("asks the person and returns handles for what they approved", async () => {
    const response = await handlers.request_grant({
      op: "request_grant",
      ...base,
      purpose: "填写乘机人证件",
      fields: ["id_number", "given_name"],
      mode: "handle",
    });

    expect(response).toMatchObject({ ok: true });
    const result = (response as { result: Record<string, unknown> }).result;
    expect(result["handles"]).toEqual({ id_number: handleFor("g-test001", "id_number") });
    // An L1 field in a handle grant needs no handle; it is not secret, it is simply not projected
    // on this path.
    expect(result["projection"]).toEqual({});
    expect(askForGrant).toHaveBeenCalledWith(expect.objectContaining({ domain: "ctrip.com" }));
  });

  it("projects L1 values for a projection grant, and never an L2 one", async () => {
    const response = await handlers.request_grant({
      op: "request_grant",
      ...base,
      purpose: "填表",
      fields: ["given_name", "id_number"],
      mode: "projection",
    });
    const result = (response as { result: Record<string, unknown> }).result;
    expect(result["projection"]).toEqual({ given_name: "小明" });
    expect(JSON.stringify(result)).not.toContain(ID_NUMBER);
  });

  it("grants only what the person approved, and says what was declined", async () => {
    askForGrant.mockResolvedValueOnce({ approved: true, fields: ["given_name"] });
    const response = await handlers.request_grant({
      op: "request_grant",
      ...base,
      purpose: "填表",
      fields: ["given_name", "id_number", "passport_number"],
      mode: "projection",
    });
    const result = (response as { result: Record<string, unknown> }).result;
    expect(result["projection"]).toEqual({ given_name: "小明" });
    expect(result["declined"]).toEqual(["id_number", "passport_number"]);
  });

  it("refuses when the person says no, and records the refusal", async () => {
    askForGrant.mockResolvedValueOnce({ approved: false, reason: "我自己填" });
    const response = await handlers.request_grant({
      op: "request_grant",
      ...base,
      purpose: "填表",
      fields: ["id_number"],
      mode: "handle",
    });
    expect(response).toMatchObject({ ok: false, code: "refused" });
    const audit = await fs.readFile(path.join(dir, "vault-audit.jsonl"), "utf8");
    expect(audit).toContain("grant_denied");
  });

  it("refuses while the vault is locked, without asking the person anything", async () => {
    await vault.lock();
    const response = await handlers.request_grant({
      op: "request_grant",
      ...base,
      purpose: "填表",
      fields: ["id_number"],
      mode: "handle",
    });
    expect(response).toMatchObject({ ok: false });
    expect(askForGrant).not.toHaveBeenCalled();
  });
});

describe("the domain claim", () => {
  it("refuses a call whose claimed site is not the page main is looking at", async () => {
    // The redirect case. The agent believes it is on ctrip.com; the tab has moved.
    pages.set("T-1", "https://ctrip-pay.example.com/checkout");
    const response = await handlers.secure_fill({
      op: "secure_fill",
      ...base,
      handle: handleFor("g-test001", "id_number"),
      targetId: "T-1",
      selector: "#idNumber",
    });

    expect(response).toMatchObject({ ok: false, code: "refused" });
    expect((response as { message: string }).message).toMatch(/ctrip-pay\.example\.com/);
    expect(filled).toEqual([]);

    const audit = await fs.readFile(path.join(dir, "vault-audit.jsonl"), "utf8");
    expect(audit).toContain("domain_claim_mismatch");
  });

  it("refuses when the page cannot be read at all", async () => {
    pages.delete("T-1");
    const response = await handlers.secure_fill({
      op: "secure_fill",
      ...base,
      handle: handleFor("g-test001", "id_number"),
      targetId: "T-1",
      selector: "#idNumber",
    });
    expect(response).toMatchObject({ ok: false });
    expect((response as { message: string }).message).toMatch(/could not be read/);
  });

  it("refuses when the turn has no page open", async () => {
    deps.currentTarget = async () => null;
    const response = await handlers.execute_payment({
      op: "execute_payment",
      ...base,
      capabilityId: "cap-1",
      action: "ctrip.payFlightOrder",
      actualPlan: planFromSummary(summaryOf()),
    });
    expect(response).toMatchObject({ ok: false });
    expect((response as { message: string }).message).toMatch(/no page open/);
  });

  it("resolves 'current' to the tab the turn is working in", async () => {
    await handlers.request_grant({
      op: "request_grant",
      ...base,
      purpose: "填表",
      fields: ["id_number"],
      mode: "handle",
    });
    const response = await handlers.secure_fill({
      op: "secure_fill",
      ...base,
      handle: handleFor("g-test001", "id_number"),
      targetId: "current",
      selector: "#idNumber",
    });
    expect(response).toMatchObject({ ok: true, result: { filled: true, field: "id_number" } });
    expect(filled).toEqual([{ selector: "#idNumber", value: ID_NUMBER }]);
  });
});

describe("filling", () => {
  beforeEach(async () => {
    await handlers.request_grant({
      op: "request_grant",
      ...base,
      purpose: "填表",
      fields: ["id_number"],
      mode: "handle",
    });
  });

  it("says only that it worked, and for which field", async () => {
    const response = await handlers.secure_fill({
      op: "secure_fill",
      ...base,
      handle: handleFor("g-test001", "id_number"),
      targetId: "T-1",
      selector: "#idNumber",
    });
    expect(response).toEqual({ ok: true, result: { filled: true, field: "id_number" } });
    expect(JSON.stringify(response)).not.toContain(ID_NUMBER);
  });

  it("passes a grant refusal back with its reason", async () => {
    const response = await handlers.secure_fill({
      op: "secure_fill",
      ...base,
      handle: handleFor("g-test001", "passport_number"),
      targetId: "T-1",
      selector: "#passport",
    });
    expect(response).toMatchObject({ ok: false, code: "refused" });
    expect((response as { message: string }).message).toMatch(/field_not_granted/);
  });
});

describe("paying", () => {
  it("spends a capability and reports the outcome", async () => {
    const summary = summaryOf();
    const capability = await payments.issue({
      sessionId: SESSION,
      summary,
      commitment: commitmentFromConfirmation({
        summary,
        channel: "card",
        approvedAt: NOW.toISOString(),
      }),
      paymentMethodRef: "pv:g-test001:payment_token",
      approvedVia: "card",
    });

    const response = await handlers.execute_payment({
      op: "execute_payment",
      ...base,
      capabilityId: capability.capabilityId,
      action: "ctrip.payFlightOrder",
      actualPlan: planFromSummary(summary),
    });
    expect(response).toMatchObject({ ok: true, result: { paid: true, replayed: false } });
  });

  it("passes a refusal back by its reason, with the detail the person needs", async () => {
    const response = await handlers.execute_payment({
      op: "execute_payment",
      ...base,
      capabilityId: "cap-nobody-issued",
      action: "ctrip.payFlightOrder",
      actualPlan: planFromSummary(summaryOf()),
    });
    expect(response).toMatchObject({ ok: false, code: "refused", message: "unknown_capability" });
  });
});
