/**
 * The audit log's two claims, tested as the claims they are.
 *
 * "No values" is checked the way an incident review would check it — by grepping the file for the
 * secrets that passed through the operations being logged (003 §12's "审计 grep 无值" row). "Tamper
 * evident" is checked by doing the tampering: editing an entry, deleting one from the middle,
 * truncating the end, and swapping two — each must be *reported*, and the report must name where.
 * A9/A10 of the attack matrix live here.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateKey } from "../src/vault/crypto.js";
import { openVaultAudit, VaultAuditError, type VaultAudit } from "../src/vault/audit.js";

let dir: string;
let key: Buffer | null;
let audit: VaultAudit;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-audit-"));
  key = generateKey();
  audit = await openVaultAudit({ filePath: path.join(dir, "audit.jsonl"), key: () => key });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

async function lines(): Promise<string[]> {
  const raw = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
  return raw.split("\n").filter((line) => line.trim() !== "");
}

async function rewrite(entries: string[]): Promise<void> {
  await fs.writeFile(path.join(dir, "audit.jsonl"), `${entries.join("\n")}\n`);
}

async function reopen(): Promise<VaultAudit> {
  return openVaultAudit({ filePath: path.join(dir, "audit.jsonl"), key: () => key });
}

describe("what an entry may say", () => {
  it("records the event, the field name and the grant — and nothing else", async () => {
    const entry = await audit.append("field_read", {
      grantId: "g-7f2a",
      taskId: "task-1",
      domain: "ctrip.com",
      field: "id_number",
      purpose: "填写乘机人证件",
    });
    expect(entry).toMatchObject({ seq: 1, event: "field_read", field: "id_number" });
    expect(entry.mac).toHaveLength(64);
  });

  it("refuses a field the log has no place for", async () => {
    // The failure this prevents is somebody adding `detail` to debug a fill and shipping it.
    await expect(
      audit.append("fill_performed", { value: "310101199001011234" } as never),
    ).rejects.toThrow(VaultAuditError);
    await expect(audit.append("fill_performed", { note: "typed 4242" } as never)).rejects.toThrow(
      /no place for/,
    );
  });

  it("refuses a long string, which is usually a value pasted into a description", async () => {
    await expect(audit.append("fill_performed", { reason: "x".repeat(301) })).rejects.toThrow(
      /short by design/,
    );
  });

  it("holds nothing a grep would find, after a whole fill flow", async () => {
    // 003 §12: the audit file is grepped for the values that moved through the operations it
    // recorded. The number, the token and the code must appear nowhere.
    const secrets = ["310101199001011234", "tok_1P4kJ2abcdef", "482913", "13800005678"];
    await audit.append("grant_requested", { field: "id_number", domain: "ctrip.com" });
    await audit.append("grant_approved", { grantId: "g-1", fields: ["id_number", "phone_number"] });
    await audit.append("field_read", { grantId: "g-1", field: "id_number" });
    await audit.append("fill_performed", { grantId: "g-1", field: "id_number", targetId: "T-9" });
    await audit.append("secret_phase_enter", { field: "otp", targetId: "T-9" });
    await audit.append("secret_phase_exit", { field: "otp", outcome: "cleared" });
    await audit.append("capability_issued", { capabilityId: "cap-1", domain: "ctrip.com" });

    const raw = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
    for (const secret of secrets) expect(raw).not.toContain(secret);
    // Field *names* are the point of the log, and they are there.
    expect(raw).toContain("id_number");
    expect(raw).toContain("otp");
  });

  it("refuses to write while the vault is locked", async () => {
    key = null;
    await expect(audit.append("lock", {})).rejects.toThrow(/locked/);
  });
});

describe("the chain", () => {
  beforeEach(async () => {
    await audit.append("unlock", {});
    await audit.append("grant_approved", { grantId: "g-1", domain: "ctrip.com" });
    await audit.append("field_read", { grantId: "g-1", field: "id_number" });
    await audit.append("fill_performed", { grantId: "g-1", field: "id_number" });
  });

  it("verifies a log nobody touched", async () => {
    expect(audit.verify()).toMatchObject({ ok: true, entries: 4 });
    expect(audit.verify(audit.tailMac())).toMatchObject({ ok: true });
  });

  it("survives being reopened, and keeps numbering from where it stopped", async () => {
    const reopened = await reopen();
    expect(reopened.verify(audit.tailMac())).toMatchObject({ ok: true, entries: 4 });
    const next = await reopened.append("lock", {});
    expect(next.seq).toBe(5);
    expect(next.prevMac).toBe(audit.tailMac());
  });

  it("reports an edited entry, and says which one — attack A10", async () => {
    const rows = await lines();
    const tampered = JSON.parse(rows[2]!) as { field: string };
    tampered.field = "payment_token";
    rows[2] = JSON.stringify(tampered);
    await rewrite(rows);

    const verdict = (await reopen()).verify();
    expect(verdict).toMatchObject({ ok: false, atSeq: 3 });
    expect((verdict as { problem: string }).problem).toMatch(/edited/);
  });

  it("reports a line deleted from the middle — attack A10", async () => {
    const rows = await lines();
    rows.splice(1, 1);
    await rewrite(rows);

    const verdict = (await reopen()).verify();
    expect(verdict).toMatchObject({ ok: false });
    expect((verdict as { problem: string }).problem).toMatch(/missing/);
  });

  it("reports two entries swapped", async () => {
    const rows = await lines();
    [rows[1], rows[2]] = [rows[2]!, rows[1]!];
    await rewrite(rows);
    expect((await reopen()).verify()).toMatchObject({ ok: false });
  });

  it("reports a truncated log against the tail the vault remembers", async () => {
    // Internally consistent after truncation — this is exactly the case that needs the remembered
    // digest, and the reason 003 §5.3 keeps one outside the file.
    const remembered = audit.tailMac();
    const rows = await lines();
    await rewrite(rows.slice(0, 2));

    const reopened = await reopen();
    expect(reopened.verify()).toMatchObject({ ok: true, entries: 2 });
    const verdict = reopened.verify(remembered);
    expect(verdict).toMatchObject({ ok: false });
    expect((verdict as { problem: string }).problem).toMatch(/ends earlier/);
  });

  it("reports a log that was deleted outright", async () => {
    const remembered = audit.tailMac();
    await fs.rm(path.join(dir, "audit.jsonl"));
    const reopened = await reopen();
    expect(reopened.verify(remembered)).toMatchObject({ ok: false });
  });

  it("says it cannot judge while locked, rather than claiming the chain is fine", async () => {
    key = null;
    expect(audit.verify()).toMatchObject({ ok: false, problem: expect.stringMatching(/locked/) });
  });

  it("refuses to load a log whose middle line is unreadable", async () => {
    const rows = await lines();
    rows[1] = "{not json";
    await rewrite(rows);
    await expect(reopen()).rejects.toThrow(/not readable/);
  });

  it("drops a torn final line, which is a crash rather than tampering", async () => {
    const raw = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
    await fs.writeFile(path.join(dir, "audit.jsonl"), `${raw}{"seq":5,"prev`);
    const reopened = await reopen();
    expect(reopened.list()).toHaveLength(4);
    expect(reopened.verify()).toMatchObject({ ok: true });
  });
});
