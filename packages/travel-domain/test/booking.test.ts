/**
 * Guarded-booking tests.
 *
 * The property being pinned down is that the irreversible act is unreachable except through all
 * four checks — so most of these assert that `submit` was **not** called.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openJournal, type Commitment, type Journal } from "@travel-agent/transaction";
import { submitBooking } from "../src/index.js";

let root: string;
let journal: Journal;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "booking-"));
  journal = await openJournal(path.join(root, "journal.jsonl"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const APPROVED = { hotel: "上海外滩茂悦大酒店", room: "高级大床房", price: 780 };

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    approved: { ...APPROVED },
    tolerance: { price: 50 },
    ceiling: "submit_order",
    approvedAt: "2026-08-12T10:00:00Z",
    channel: "feishu-card",
    ...overrides,
  };
}

describe("submitBooking", () => {
  it("submits when authority and plan both hold", async () => {
    const submit = vi.fn(async () => ({ orderId: "ORD-1" }));
    const result = await submitBooking({
      journal,
      commitment: commitment(),
      actualPlan: { ...APPROVED },
      requiredCeiling: "submit_order",
      action: "ctrip.submitHotelOrder",
      submit,
    });
    expect(result).toMatchObject({ status: "submitted", outcome: { orderId: "ORD-1" } });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("refuses when the commitment stops short of what this step needs", async () => {
    const submit = vi.fn(async () => "should not run");
    const result = await submitBooking({
      journal,
      commitment: commitment({ ceiling: "fill_form" }),
      actualPlan: { ...APPROVED },
      requiredCeiling: "submit_order",
      action: "ctrip.submitHotelOrder",
      submit,
    });
    expect(result).toMatchObject({ status: "refused", reason: "ceiling_too_low" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("absorbs drift inside the tolerance the human gave", async () => {
    const submit = vi.fn(async () => "ok");
    const result = await submitBooking({
      journal,
      commitment: commitment(),
      actualPlan: { ...APPROVED, price: 820 },
      requiredCeiling: "submit_order",
      action: "ctrip.submitHotelOrder",
      submit,
    });
    expect(result.status).toBe("submitted");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  // Silence is not consent: with no way to ask, drift refuses.
  it("refuses drift outright when there is no way to ask", async () => {
    const submit = vi.fn(async () => "ok");
    const result = await submitBooking({
      journal,
      commitment: commitment(),
      actualPlan: { ...APPROVED, price: 900 },
      requiredCeiling: "submit_order",
      action: "ctrip.submitHotelOrder",
      submit,
    });
    expect(result).toMatchObject({ status: "refused", reason: "plan_drifted" });
    expect(result.status === "refused" && result.detail[0]).toContain("900");
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits drifted plans the human approves, and refuses the ones they do not", async () => {
    const submit = vi.fn(async () => "ok");
    const approved = await submitBooking({
      journal,
      commitment: commitment(),
      actualPlan: { ...APPROVED, price: 900 },
      requiredCeiling: "submit_order",
      action: "a",
      submit,
      confirmDrift: async () => true,
    });
    expect(approved.status).toBe("submitted");

    const declined = await submitBooking({
      journal,
      commitment: commitment(),
      actualPlan: { ...APPROVED, price: 900 },
      requiredCeiling: "submit_order",
      action: "b",
      submit,
      confirmDrift: async () => false,
    });
    expect(declined).toMatchObject({ status: "refused", reason: "escalation_declined" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("shows the human what moved, not just that something did", async () => {
    const seen: string[][] = [];
    await submitBooking({
      journal,
      commitment: commitment(),
      actualPlan: { ...APPROVED, price: 900, room: "标准双床房" },
      requiredCeiling: "submit_order",
      action: "a",
      submit: async () => "ok",
      confirmDrift: async (drifts) => {
        seen.push(drifts);
        return false;
      },
    });
    expect(seen[0]!.join(" ")).toContain("900");
    expect(seen[0]!.join(" ")).toContain("标准双床房");
  });

  // The reason the journal is inside this function rather than beside it.
  it("never runs the action twice, even when called again with the same commitment", async () => {
    const submit = vi.fn(async () => ({ orderId: "ORD-1" }));
    const options = {
      journal,
      commitment: commitment(),
      actualPlan: { ...APPROVED },
      requiredCeiling: "submit_order" as const,
      action: "ctrip.submitHotelOrder",
      submit,
    };
    const first = await submitBooking(options);
    const second = await submitBooking(options);
    expect(first).toMatchObject({ status: "submitted", replayed: false });
    expect(second).toMatchObject({ status: "submitted", outcome: { orderId: "ORD-1" } });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("surfaces a dangling intent instead of quietly resubmitting", async () => {
    const options = {
      journal,
      commitment: commitment(),
      actualPlan: { ...APPROVED },
      requiredCeiling: "submit_order" as const,
      action: "ctrip.submitHotelOrder",
    };
    await expect(
      submitBooking({
        ...options,
        submit: async () => {
          throw new Error("connection dropped mid-submit");
        },
      }),
    ).rejects.toThrow("connection dropped");

    const submit = vi.fn(async () => "second attempt");
    await expect(submitBooking({ ...options, submit })).rejects.toThrow(/DanglingIntent|intent/i);
    expect(submit).not.toHaveBeenCalled();
  });

  it("continues from a reconciled outcome without re-running the action", async () => {
    const options = {
      journal,
      commitment: commitment(),
      actualPlan: { ...APPROVED },
      requiredCeiling: "submit_order" as const,
      action: "ctrip.submitHotelOrder",
    };
    await expect(
      submitBooking({
        ...options,
        submit: async () => {
          throw new Error("dropped");
        },
      }),
    ).rejects.toThrow();

    const submit = vi.fn(async () => "must not run");
    const result = await submitBooking({
      ...options,
      submit,
      reconcile: async () => ({ orderId: "ORD-FOUND", reconciled: true }),
    });
    expect(result).toMatchObject({
      status: "submitted",
      replayed: true,
      outcome: { orderId: "ORD-FOUND" },
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("checks authority before the journal, so a forbidden step is never even recorded", async () => {
    await submitBooking({
      journal,
      commitment: commitment({ ceiling: "read_only" }),
      actualPlan: { ...APPROVED, price: 9999 },
      requiredCeiling: "pay",
      action: "ctrip.pay",
      submit: async () => "no",
    });
    expect(journal.inspect()).toEqual([]);
  });
});
