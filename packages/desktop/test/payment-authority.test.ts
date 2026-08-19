/**
 * The execute path, from the outside: what has to be true before money moves, and what happens when
 * the process dies in the middle.
 *
 * This is the payment (P4) rejection matrix at the layer that actually spends: the capability checks are
 * exercised again here (they run in two places on purpose — against main's own view of the domain,
 * and inside the guarded booking path), plus the two rows that only exist here — the flag gate, and
 * a payment interrupted between the journal's intent and its result. That last one is the whole
 * reason the journal exists, and its assertion is a count of side effects, not a status string.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  commitmentFromConfirmation,
  openJournal,
  planFromSummary,
  type Journal,
  type PaymentSummary,
} from "@travel-agent/transaction";

import { PaymentAuthority, type PaymentPort } from "../src/vault/payment-authority.js";
import { createProfileVault, type ProfileVault } from "../src/vault/store.js";
import type { SafeStoragePort, StorageAvailability } from "../src/vault/safe-storage.js";

const TASK = "task-1755000000000-aaaa1111";
const SESSION = "session-2026-08-16-10-00-00-aaaa0001";
const NOW = new Date("2026-08-16T10:00:00.000Z");
const TOKEN = "tok_merchant_1P4kJ2abcdef";
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

function summaryOf(overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    merchant: { name: "携程", domain: "ctrip.com" },
    item: "MU5137 2026-09-02 经济舱 1 成人",
    amount: { value: 1280, currency: "CNY" },
    cancellation: { summary: "起飞前 24 小时可退" },
    paymentMethod: { alias: "常用信用卡", brand: "Visa", last4: "4242" },
    expiresAt: "2026-08-16T10:10:00.000Z",
    taskId: TASK,
    ...overrides,
  };
}

let dir: string;
let vault: ProfileVault;
let journal: Journal;
let paid: Array<{ credential: string | null; amount: unknown }>;
let port: PaymentPort;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pay-authority-"));
  vault = createProfileVault({
    filePath: path.join(dir, "profile-vault.json"),
    auditPath: path.join(dir, "vault-audit.jsonl"),
    safeStorage: fakeKeychain(),
    availability: USABLE,
    now: () => NOW,
  });
  await vault.unlock();
  await vault.put("payment_token", TOKEN);
  journal = await openJournal(path.join(dir, "payments.jsonl"));
  paid = [];
  port = {
    pay: vi.fn(async ({ credential, actualPlan }) => {
      paid.push({ credential, amount: actualPlan["amount"] });
      return { orderId: "E123456" };
    }),
  };
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function authorityWith(options: { execute?: boolean; port?: PaymentPort; journal?: Journal } = {}) {
  return new PaymentAuthority({
    vault,
    flags: { "payments.execute": options.execute !== false },
    journalFor: async () => options.journal ?? journal,
    port: options.port ?? port,
    audit: vault.auditLog(),
    now: () => NOW,
  });
}

async function issued(
  authority: PaymentAuthority,
  input: { summary?: PaymentSummary; tolerance?: number; methodRef?: string } = {},
) {
  const summary = input.summary ?? summaryOf();
  const approvedTolerance = input.tolerance ? { amountIncrease: input.tolerance } : undefined;
  return authority.issue({
    sessionId: SESSION,
    summary,
    commitment: commitmentFromConfirmation({
      summary,
      ...(approvedTolerance ? { approvedTolerance } : {}),
      channel: "card",
      approvedAt: NOW.toISOString(),
    }),
    paymentMethodRef: input.methodRef ?? "pv:g-test001:payment_token",
    approvedVia: "card",
    ...(approvedTolerance ? { approvedTolerance } : {}),
  });
}

const page = () => planFromSummary(summaryOf());

describe("issuing", () => {
  it("records the issuance and hands back an id, not a permission", async () => {
    const authority = authorityWith();
    const capability = await issued(authority);

    expect(capability.capabilityId).toMatch(/^cap-/);
    expect(capability.auditRef).toMatch(/^audit:\d+$/);
    const audit = await fs.readFile(path.join(dir, "vault-audit.jsonl"), "utf8");
    expect(audit).toContain("capability_issued");
    // The credential is a reference; nothing here could charge anything on its own.
    expect(JSON.stringify(capability)).not.toContain(TOKEN);
  });

  it("forgets a turn's capabilities when the turn ends", async () => {
    const authority = authorityWith();
    const capability = await issued(authority);
    expect(authority.forgetTask(TASK)).toBe(1);
    expect(authority.get(capability.capabilityId)).toBeUndefined();
  });
});

describe("the flag gate", () => {
  it("refuses to pay at all while payments.execute is off — the shipped default", async () => {
    const authority = authorityWith({ execute: false });
    const capability = await issued(authority);
    const result = await authority.execute({
      capabilityId: capability.capabilityId,
      taskId: TASK,
      sessionId: SESSION,
      domain: "ctrip.com",
      action: "ctrip.payFlightOrder",
      actualPlan: page(),
    });

    expect(result).toMatchObject({ status: "refused", reason: "payments_disabled" });
    expect(port.pay).not.toHaveBeenCalled();
    expect(journal.inspect()).toEqual([]);
  });

  it("refuses when no executor is wired, without journalling an attempt it cannot make", async () => {
    // What this build actually ships: the machinery is complete and the last mile is deliberately
    // absent, which is the same statement the flag makes.
    const authority = new PaymentAuthority({
      vault,
      flags: { "payments.execute": true },
      journalFor: async () => journal,
      audit: vault.auditLog(),
      now: () => NOW,
    });
    const capability = await issued(authority);
    await expect(
      authority.execute({
        capabilityId: capability.capabilityId,
        taskId: TASK,
        sessionId: SESSION,
        domain: "ctrip.com",
        action: "ctrip.payFlightOrder",
        actualPlan: page(),
      }),
    ).rejects.toThrow(/no payment executor/);
  });
});

describe("spending a capability", () => {
  it("pays once, resolves the credential itself, and marks the capability used", async () => {
    const authority = authorityWith();
    const capability = await issued(authority);
    const result = await authority.execute({
      capabilityId: capability.capabilityId,
      taskId: TASK,
      sessionId: SESSION,
      domain: "ctrip.com",
      action: "ctrip.payFlightOrder",
      actualPlan: page(),
    });

    expect(result).toMatchObject({ status: "paid", outcome: { orderId: "E123456" } });
    // The credential reached the merchant call and nothing else.
    expect(paid).toEqual([{ credential: TOKEN, amount: 1280 }]);
    expect(authority.get(capability.capabilityId)?.usedAt).toBe(NOW.toISOString());

    const audit = await fs.readFile(path.join(dir, "vault-audit.jsonl"), "utf8");
    expect(audit).toContain("capability_consumed");
    expect(audit).not.toContain(TOKEN);
  });

  it("refuses a second attempt on a spent capability", async () => {
    const authority = authorityWith();
    const capability = await issued(authority);
    const call = {
      capabilityId: capability.capabilityId,
      taskId: TASK,
      sessionId: SESSION,
      domain: "ctrip.com",
      action: "ctrip.payFlightOrder",
      actualPlan: page(),
    };
    await authority.execute(call);
    expect(await authority.execute(call)).toMatchObject({
      status: "refused",
      reason: "capability_used",
    });
    expect(port.pay).toHaveBeenCalledTimes(1);
  });

  it("refuses an id nobody issued", async () => {
    const authority = authorityWith();
    expect(
      await authority.execute({
        capabilityId: "cap-made-up",
        taskId: TASK,
        sessionId: SESSION,
        domain: "ctrip.com",
        action: "ctrip.payFlightOrder",
        actualPlan: page(),
      }),
    ).toMatchObject({ status: "refused", reason: "unknown_capability" });
  });

  it("judges the domain by what main sees, not by what the caller claims", async () => {
    // The agent supplies `actualPlan`; it does not get to supply the merchant. Even a plan whose
    // merchantDomain looks right is refused when the page main is looking at is elsewhere.
    const authority = authorityWith();
    const capability = await issued(authority);
    const result = await authority.execute({
      capabilityId: capability.capabilityId,
      taskId: TASK,
      sessionId: SESSION,
      domain: "ctrip-pay.example.com",
      action: "ctrip.payFlightOrder",
      actualPlan: page(),
    });
    expect(result).toMatchObject({ status: "refused", reason: "merchant_mismatch" });
    expect(port.pay).not.toHaveBeenCalled();
  });

  it("refuses a price nobody approved slack for", async () => {
    const authority = authorityWith();
    const capability = await issued(authority);
    expect(
      await authority.execute({
        capabilityId: capability.capabilityId,
        taskId: TASK,
        sessionId: SESSION,
        domain: "ctrip.com",
        action: "ctrip.payFlightOrder",
        actualPlan: { ...page(), amount: 1340 },
      }),
    ).toMatchObject({ status: "refused", reason: "tolerance_not_approved" });
    expect(port.pay).not.toHaveBeenCalled();
  });

  it("refuses when the stored credential is gone", async () => {
    const authority = authorityWith();
    const capability = await issued(authority);
    await vault.deleteField("payment_token");
    expect(
      await authority.execute({
        capabilityId: capability.capabilityId,
        taskId: TASK,
        sessionId: SESSION,
        domain: "ctrip.com",
        action: "ctrip.payFlightOrder",
        actualPlan: page(),
      }),
    ).toMatchObject({ status: "refused", reason: "credential_unavailable" });
  });

  it("needs no vault at all for a wallet reference", async () => {
    const authority = authorityWith();
    const capability = await issued(authority, { methodRef: "wallet:Apple Pay" });
    const result = await authority.execute({
      capabilityId: capability.capabilityId,
      taskId: TASK,
      sessionId: SESSION,
      domain: "ctrip.com",
      action: "ctrip.payFlightOrder",
      actualPlan: page(),
    });
    expect(result).toMatchObject({ status: "paid" });
    expect(paid[0]?.credential).toBeNull();
  });

  it("records every refusal with its reason", async () => {
    const authority = authorityWith();
    const capability = await issued(authority);
    await authority.execute({
      capabilityId: capability.capabilityId,
      taskId: TASK,
      sessionId: SESSION,
      domain: "elsewhere.example",
      action: "ctrip.payFlightOrder",
      actualPlan: page(),
    });
    const audit = await fs.readFile(path.join(dir, "vault-audit.jsonl"), "utf8");
    expect(audit).toContain("capability_refused");
    expect(audit).toContain("merchant_mismatch");
  });
});

describe("a payment interrupted mid-flight", () => {
  it("leaves one side effect, refuses to retry, and settles by asking the merchant", async () => {
    // The SIGKILL row of the P4 matrix. The intent is fsynced before the merchant call, so a
    // process that dies inside it leaves a dangling intent — and the count that matters is how
    // many times the outside world was touched.
    let sideEffects = 0;
    const dying: PaymentPort = {
      pay: vi.fn(async () => {
        sideEffects += 1;
        throw new Error("SIGKILL");
      }),
    };
    const authority = authorityWith({ port: dying });
    const capability = await issued(authority);
    const call = {
      capabilityId: capability.capabilityId,
      taskId: TASK,
      sessionId: SESSION,
      domain: "ctrip.com",
      action: "ctrip.payFlightOrder",
      actualPlan: page(),
    };

    await expect(authority.execute(call)).rejects.toThrow("SIGKILL");
    expect(sideEffects).toBe(1);

    // A new life of the process reads the same journal file.
    const reopened = await openJournal(journal.filePath);
    expect(reopened.danglingIntents()).toHaveLength(1);

    const retrying: PaymentPort = {
      pay: vi.fn(async () => {
        sideEffects += 1;
        return { orderId: "DOUBLE-CHARGE" };
      }),
    };
    const afterCrash = authorityWith({ port: retrying, journal: reopened });
    const recovered = await issued(afterCrash);
    await expect(
      afterCrash.execute({ ...call, capabilityId: recovered.capabilityId }),
    ).rejects.toThrow(/DanglingIntent|do not retry/i);
    expect(retrying.pay).not.toHaveBeenCalled();
    expect(sideEffects).toBe(1);

    // With a reconcile path, the answer comes from the merchant and is recorded as the outcome.
    const asking: PaymentPort = {
      pay: vi.fn(async () => {
        sideEffects += 1;
        return { orderId: "DOUBLE-CHARGE" };
      }),
      reconcile: vi.fn(async () => ({ orderId: "E123456", reconciled: true })),
    };
    const settling = authorityWith({ port: asking, journal: reopened });
    const settled = await settling.execute({
      ...call,
      capabilityId: (await issued(settling)).capabilityId,
    });
    expect(settled).toMatchObject({ status: "paid", outcome: { orderId: "E123456" } });
    expect(asking.pay).not.toHaveBeenCalled();
    expect(sideEffects).toBe(1);
  });
});
