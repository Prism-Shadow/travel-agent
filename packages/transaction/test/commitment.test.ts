/**
 * Commitment tests: does what I am about to do still match what the human agreed to?
 *
 * The cases below are written from the booking failures they exist to prevent — a price that
 * crept up, a room type that silently changed, a fee that appeared after confirmation.
 */
import { describe, expect, it } from "vitest";
import { ANY, checkDrift, describeDrift, permits, type Commitment } from "../src/commitment.js";

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    approved: {
      hotel: "上海外滩茂悦",
      room: "高级大床房",
      checkin: "2026-08-20",
      nights: 1,
      price: 780,
    },
    tolerance: { price: 50 },
    ceiling: "fill_form",
    approvedAt: "2026-08-12T10:00:00Z",
    channel: "feishu-card",
    ...overrides,
  };
}

describe("checkDrift", () => {
  it("passes an identical plan", () => {
    const result = checkDrift(commitment(), { ...commitment().approved });
    expect(result.withinCommitment).toBe(true);
    expect(result.drifts).toEqual([]);
  });

  it("absorbs a price rise inside the tolerance the human gave in context", () => {
    const result = checkDrift(commitment(), { ...commitment().approved, price: 820 });
    expect(result.withinCommitment).toBe(true);
  });

  it("flags a price rise past tolerance, with the numbers needed to explain it", () => {
    const result = checkDrift(commitment(), { ...commitment().approved, price: 900 });
    expect(result.withinCommitment).toBe(false);
    expect(result.drifts).toEqual([
      {
        path: "price",
        approved: 780,
        actual: 900,
        delta: 120,
        allowed: 50,
        reason: "over_tolerance",
      },
    ]);
  });

  // Direction is stated, never inferred. A bare number is an allowed *rise*, so a drop is still
  // drift unless the caller says otherwise — which is what keeps "2 nights became 1" a breach.
  it("treats an unexplained price drop as drift when only a rise was allowed", () => {
    const result = checkDrift(commitment(), { ...commitment().approved, price: 600 });
    expect(result.withinCommitment).toBe(false);
    expect(result.drifts[0]).toMatchObject({
      path: "price",
      delta: -180,
      reason: "over_tolerance",
    });
  });

  it("accepts any drop once the caller declares drops harmless", () => {
    const cheapOk = commitment({ tolerance: { price: { increase: 50, decrease: ANY } } });
    expect(checkDrift(cheapOk, { ...commitment().approved, price: 600 }).withinCommitment).toBe(
      true,
    );
    // The rise half of the same entry still binds.
    expect(checkDrift(cheapOk, { ...commitment().approved, price: 900 }).withinCommitment).toBe(
      false,
    );
  });

  it("a shrinking count is drift even though the number got smaller", () => {
    const result = checkDrift(commitment(), { ...commitment().approved, nights: 0 });
    expect(result.withinCommitment).toBe(false);
    expect(result.drifts[0]).toMatchObject({ path: "nights", reason: "over_tolerance" });
  });

  it("flags a changed non-numeric field regardless of tolerance", () => {
    const result = checkDrift(commitment(), { ...commitment().approved, room: "标准双床房" });
    expect(result.withinCommitment).toBe(false);
    expect(result.drifts[0]).toMatchObject({ path: "room", reason: "changed" });
  });

  // The fee that appears between confirming and paying is exactly what this catches.
  it("flags a field that appeared after confirmation", () => {
    const result = checkDrift(commitment(), { ...commitment().approved, serviceFee: 60 });
    expect(result.withinCommitment).toBe(false);
    expect(result.drifts[0]).toMatchObject({ path: "serviceFee", actual: 60, reason: "added" });
  });

  it("flags a confirmed field that vanished", () => {
    const actual = { ...commitment().approved };
    delete (actual as Record<string, unknown>).room;
    const result = checkDrift(commitment(), actual);
    expect(result.drifts[0]).toMatchObject({ path: "room", reason: "missing" });
  });

  it("walks nested plans and reports dotted paths", () => {
    const nested = commitment({
      approved: { outbound: { flight: "MU5137", price: 1280 } },
      tolerance: { "outbound.price": 100 },
    });
    expect(
      checkDrift(nested, { outbound: { flight: "MU5137", price: 1350 } }).withinCommitment,
    ).toBe(true);
    const breach = checkDrift(nested, { outbound: { flight: "MU5137", price: 1500 } });
    expect(breach.drifts[0]).toMatchObject({ path: "outbound.price", reason: "over_tolerance" });
  });

  it("describes drift in lines a confirmation card can show", () => {
    const result = checkDrift(commitment(), { ...commitment().approved, price: 900 });
    expect(describeDrift(result.drifts)[0]).toContain("780");
    expect(describeDrift(result.drifts)[0]).toContain("900");
  });
});

describe("permits", () => {
  it("authorises at or below the ceiling and refuses above it", () => {
    const filling = commitment({ ceiling: "fill_form" });
    expect(permits(filling, "read_only")).toBe(true);
    expect(permits(filling, "fill_form")).toBe(true);
    expect(permits(filling, "submit_order")).toBe(false);
    expect(permits(filling, "pay")).toBe(false);
  });

  it("a pay-level commitment authorises everything below it", () => {
    const paying = commitment({ ceiling: "pay" });
    expect(permits(paying, "submit_order")).toBe(true);
    expect(permits(paying, "pay")).toBe(true);
  });
});
