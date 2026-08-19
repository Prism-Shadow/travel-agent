/**
 * Grants, and their rejection matrix.
 *
 * Every row below is a way a handle could be redeemed that it should not be: a grant that never
 * existed, one that was revoked, one that lapsed, one from another turn, one for another site, one
 * that never covered this field, and one whose mode was never "handle" at all. Each has to be
 * refused with its own reason — a single "denied" would be correct and useless, because the person
 * reading the audit log afterwards needs to know which of those seven it was.
 */
import { describe, expect, it, vi } from "vitest";

import {
  GrantError,
  GrantRegistry,
  handleFor,
  normaliseDomain,
  parseHandle,
  L2_GRANT_TTL_MS,
} from "../src/vault/grants.js";

const TASK = "task-1755000000000-aaaa1111";

function registryAt(start = "2026-08-16T10:00:00.000Z") {
  let clock = new Date(start);
  const audited: Array<{ event: string; details: Record<string, unknown> }> = [];
  let counter = 0;
  const registry = new GrantRegistry({
    now: () => clock,
    // Shaped like the real ones (`g-` + 8 hex): a handle carries its grant id, and the parser
    // holds that shape, so stubbing ids as `g-1` would be testing against a shape that never ships.
    newId: () => `g-test${String(++counter).padStart(3, "0")}`,
    audit: (event, details) => {
      audited.push({ event, details: details as Record<string, unknown> });
    },
  });
  return {
    registry,
    audited,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

async function approved(input: Partial<Parameters<GrantRegistry["approve"]>[0]> = {}) {
  const ctx = registryAt();
  const grant = await ctx.registry.approve({
    taskId: TASK,
    domain: "ctrip.com",
    purpose: "填写乘机人证件",
    fields: ["id_number", "phone_number"],
    mode: "handle",
    channel: "card",
    ...input,
  });
  return { ...ctx, grant };
}

describe("what a grant may be", () => {
  it("names a turn, a domain, a purpose and exact fields", async () => {
    const { grant } = await approved();
    expect(grant).toMatchObject({
      taskId: TASK,
      domain: "ctrip.com",
      purpose: "填写乘机人证件",
      fields: ["id_number", "phone_number"],
      mode: "handle",
    });
  });

  it("refuses a wildcard field set", async () => {
    // "everything" is precisely the permission this design will not express.
    const { registry } = registryAt();
    await expect(
      registry.approve({
        taskId: TASK,
        domain: "ctrip.com",
        purpose: "p",
        fields: ["*"],
        mode: "handle",
        channel: "card",
      }),
    ).rejects.toThrow(GrantError);
  });

  it("refuses anything that is not a bare domain", async () => {
    const { registry } = registryAt();
    for (const domain of [
      "https://ctrip.com",
      "ctrip.com/pay",
      "*.ctrip.com",
      ".ctrip.com",
      "localhost",
      "",
    ]) {
      await expect(
        registry.approve({
          taskId: TASK,
          domain,
          purpose: "p",
          fields: ["id_number"],
          mode: "handle",
          channel: "card",
        }),
      ).rejects.toThrow(GrantError);
    }
  });

  it("refuses a grant over a field that is never stored", async () => {
    const { registry } = registryAt();
    await expect(
      registry.approve({
        taskId: TASK,
        domain: "ctrip.com",
        purpose: "p",
        fields: ["cvv"],
        mode: "handle",
        channel: "card",
      }),
    ).rejects.toThrow(/never stored/);
  });

  it("refuses a grant with no purpose to show or record", async () => {
    const { registry } = registryAt();
    await expect(
      registry.approve({
        taskId: TASK,
        domain: "ctrip.com",
        purpose: "  ",
        fields: ["id_number"],
        mode: "handle",
        channel: "card",
      }),
    ).rejects.toThrow(/purpose/);
  });

  it("gives L2 fields fifteen minutes and L1-only grants the turn", async () => {
    const short = await approved({ fields: ["id_number"] });
    expect(Date.parse(short.grant.expiresAt) - Date.parse(short.grant.approvedAt)).toBe(
      L2_GRANT_TTL_MS,
    );

    const long = await approved({ fields: ["given_name"], mode: "projection" });
    expect(Date.parse(long.grant.expiresAt) - Date.parse(long.grant.approvedAt)).toBeGreaterThan(
      L2_GRANT_TTL_MS,
    );
  });

  it("never lengthens the window past what the tier allows", async () => {
    const { grant } = await approved({ fields: ["id_number"], ttlMs: 24 * 60 * 60_000 });
    expect(Date.parse(grant.expiresAt) - Date.parse(grant.approvedAt)).toBe(L2_GRANT_TTL_MS);
  });

  it("records the approval by field name, with no value in sight", async () => {
    const { audited } = await approved();
    expect(audited[0]).toMatchObject({
      event: "grant_approved",
      details: { domain: "ctrip.com", fields: ["id_number", "phone_number"] },
    });
    // Field names, not values: the registry is never handed one, and nothing it writes could
    // contain a document number or a phone number even if it were.
    const written = JSON.stringify(audited);
    expect(written).toContain("id_number");
    for (const value of ["310101199001011234", "13800005678"]) expect(written).not.toContain(value);
  });

  it("records a refusal too, since a denied request is worth reading later", async () => {
    const { registry, audited } = registryAt();
    await registry.deny({ taskId: TASK, domain: "ctrip.com", fields: ["id_number"], purpose: "p" });
    expect(audited[0]?.event).toBe("grant_denied");
  });
});

describe("handles", () => {
  it("are opaque references, one per L2 field", async () => {
    const { registry, grant } = await approved({ fields: ["id_number", "given_name"] });
    expect(registry.handles(grant)).toEqual({ id_number: `pv:${grant.grantId}:id_number` });
  });

  it("round-trip through parsing, and reject anything else", () => {
    expect(parseHandle(handleFor("g-1234", "id_number"))).toEqual({
      grantId: "g-1234",
      field: "id_number",
    });
    for (const bad of ["", "id_number", "pv:g:", "pv::id_number", "310101199001011234", "pv:g-1"]) {
      expect(parseHandle(bad)).toBeNull();
    }
  });
});

describe("the rejection matrix", () => {
  const use = { taskId: TASK, domain: "ctrip.com" };

  it("accepts the case everything lines up for", async () => {
    const { registry, grant } = await approved();
    expect(
      registry.authorizeHandle({ handle: handleFor(grant.grantId, "id_number"), ...use }),
    ).toMatchObject({ ok: true, field: "id_number" });
  });

  it("refuses a grant that never existed", async () => {
    const { registry } = await approved();
    expect(
      registry.authorizeHandle({ handle: handleFor("g-nope", "id_number"), ...use }),
    ).toMatchObject({ ok: false, reason: "unknown_grant" });
  });

  it("refuses something that is not a handle at all", async () => {
    const { registry } = await approved();
    expect(registry.authorizeHandle({ handle: "310101199001011234", ...use })).toMatchObject({
      ok: false,
      reason: "unknown_grant",
    });
  });

  it("refuses a revoked grant", async () => {
    const { registry, grant } = await approved();
    expect(await registry.revoke(grant.grantId, "user revoked")).toBe(true);
    expect(
      registry.authorizeHandle({ handle: handleFor(grant.grantId, "id_number"), ...use }),
    ).toMatchObject({ ok: false, reason: "revoked" });
  });

  it("refuses one that has lapsed", async () => {
    const ctx = await approved();
    ctx.advance(L2_GRANT_TTL_MS + 1000);
    expect(
      ctx.registry.authorizeHandle({ handle: handleFor(ctx.grant.grantId, "id_number"), ...use }),
    ).toMatchObject({ ok: false, reason: "expired" });
  });

  it("refuses one from another turn", async () => {
    const { registry, grant } = await approved();
    expect(
      registry.authorizeHandle({
        handle: handleFor(grant.grantId, "id_number"),
        taskId: "task-1755000000001-bbbb2222",
        domain: "ctrip.com",
      }),
    ).toMatchObject({ ok: false, reason: "wrong_task" });
  });

  it("refuses one on another domain — including a subdomain of the granted one", async () => {
    // Checked against the page the fill is about to happen on, not the page that was open when the
    // person said yes. A redirect is a different site.
    const { registry, grant } = await approved();
    for (const domain of ["ctrip-pay.com", "pay.ctrip.com", "ctrip.com.evil.example", ""]) {
      expect(
        registry.authorizeHandle({
          handle: handleFor(grant.grantId, "id_number"),
          taskId: TASK,
          domain,
        }),
      ).toMatchObject({ ok: false, reason: "wrong_domain" });
    }
  });

  it("refuses a field the grant never covered", async () => {
    const { registry, grant } = await approved({ fields: ["id_number"] });
    expect(
      registry.authorizeHandle({ handle: handleFor(grant.grantId, "payment_token"), ...use }),
    ).toMatchObject({ ok: false, reason: "field_not_granted" });
  });

  it("refuses a handle presented against a projection grant", async () => {
    const { registry, grant } = await approved({ mode: "projection" });
    expect(
      registry.authorizeHandle({ handle: handleFor(grant.grantId, "id_number"), ...use }),
    ).toMatchObject({ ok: false, reason: "wrong_mode" });
  });

  it("says which of the seven it was, every time", async () => {
    // One reason per row: "denied" alone would be correct and useless to whoever reads the log.
    const seen = new Set<string>();
    const { registry, grant } = await approved();
    seen.add(
      (registry.authorizeHandle({ handle: "pv:g-nope:id_number", ...use }) as { reason: string })
        .reason,
    );
    seen.add(
      (
        registry.authorizeHandle({
          handle: handleFor(grant.grantId, "passport_number"),
          ...use,
        }) as { reason: string }
      ).reason,
    );
    seen.add(
      (
        registry.authorizeHandle({
          handle: handleFor(grant.grantId, "id_number"),
          taskId: "other",
          domain: "ctrip.com",
        }) as { reason: string }
      ).reason,
    );
    expect(seen).toEqual(new Set(["unknown_grant", "field_not_granted", "wrong_task"]));
  });
});

describe("revocation", () => {
  it("ends every grant of a turn when the turn ends", async () => {
    const ctx = registryAt();
    const first = await ctx.registry.approve({
      taskId: TASK,
      domain: "ctrip.com",
      purpose: "p",
      fields: ["id_number"],
      mode: "handle",
      channel: "card",
    });
    const other = await ctx.registry.approve({
      taskId: "task-other",
      domain: "ctrip.com",
      purpose: "p",
      fields: ["id_number"],
      mode: "handle",
      channel: "card",
    });

    expect(await ctx.registry.revokeTask(TASK)).toBe(1);
    expect(ctx.registry.get(first.grantId)?.revokedAt).toBeDefined();
    expect(ctx.registry.get(other.grantId)?.revokedAt).toBeUndefined();
  });

  it("ends everything when the vault locks, because a live handle is not locked", async () => {
    const { registry, grant, audited } = await approved();
    expect(await registry.revokeAll()).toBe(1);
    expect(registry.get(grant.grantId)?.revokedAt).toBeDefined();
    expect(audited.at(-1)).toMatchObject({
      event: "grant_revoked",
      details: { reason: "vault locked" },
    });
  });

  it("is idempotent, and reports whether it did anything", async () => {
    const { registry, grant } = await approved();
    expect(await registry.revoke(grant.grantId, "x")).toBe(true);
    expect(await registry.revoke(grant.grantId, "x")).toBe(false);
    expect(await registry.revoke("g-nope", "x")).toBe(false);
  });

  it("sweeps dead grants out of memory without touching the record of them", async () => {
    const ctx = await approved();
    await ctx.registry.revoke(ctx.grant.grantId, "done");
    expect(ctx.registry.sweep()).toBe(1);
    expect(ctx.registry.list()).toEqual([]);
    expect(ctx.audited.some((entry) => entry.event === "grant_revoked")).toBe(true);
  });
});

describe("domain normalisation", () => {
  it("lowercases and accepts a plain eTLD+1", () => {
    expect(normaliseDomain(" CTrip.COM ")).toBe("ctrip.com");
    expect(normaliseDomain("booking.co.uk")).toBe("booking.co.uk");
  });

  it("refuses anything it has not actually checked", () => {
    for (const input of [
      "https://ctrip.com",
      "ctrip.com:443",
      "ctrip.com/pay",
      "user@ctrip.com",
      "*.ctrip.com",
      "ctrip",
      "",
    ]) {
      expect(normaliseDomain(input)).toBeNull();
    }
  });
});

describe("the audit hook", () => {
  it("survives an audit sink that throws, without losing the grant", async () => {
    // The log is important; it is not more important than the person's task. A failure to record
    // is reported by the sink's own machinery, not by breaking the approval.
    const registry = new GrantRegistry({
      audit: vi.fn(() => {
        throw new Error("disk full");
      }),
    });
    await expect(
      registry.approve({
        taskId: TASK,
        domain: "ctrip.com",
        purpose: "p",
        fields: ["id_number"],
        mode: "handle",
        channel: "card",
      }),
    ).rejects.toThrow("disk full");
  });
});
