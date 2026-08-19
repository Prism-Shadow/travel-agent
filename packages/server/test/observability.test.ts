/**
 * The observability rates, tested for the two things a design signal must get right:
 * the arithmetic, and refusing to state a rate off a denominator too small to mean anything.
 */
import { describe, expect, it } from "vitest";

import { MIN_RATE_SAMPLE, ObservabilityMetrics } from "../src/metrics/observability.js";

function metricsAt(iso = "2026-08-16T10:00:00.000Z") {
  return new ObservabilityMetrics({ now: () => new Date(iso) });
}

describe("interaction rates", () => {
  it("reports each rate against the total interactions", () => {
    const m = metricsAt();
    // 8 interactions: 1 takeover, 1 secret_entry, the rest ordinary.
    m.recordInteraction("browser_takeover");
    m.recordInteraction("secret_entry");
    for (let i = 0; i < 6; i += 1) m.recordInteraction("info_request");

    const snap = m.snapshot();
    expect(snap.interactions.browser_takeover).toBe(1);
    expect(snap.takeover).toMatchObject({ numerator: 1, denominator: 8 });
    expect(snap.takeover.rate).toBeCloseTo(1 / 8);
    expect(snap.secretPhase.rate).toBeCloseTo(1 / 8);
  });

  it("withholds a rate until the denominator is worth trusting", () => {
    const m = metricsAt();
    m.recordInteraction("browser_takeover"); // denominator 1 — one takeover is not "100%"
    expect(m.snapshot().takeover.rate).toBeNull();
    expect(m.snapshot().takeover.numerator).toBe(1);

    for (let i = 0; i < MIN_RATE_SAMPLE - 1; i += 1) m.recordInteraction("info_request");
    expect(m.snapshot().takeover.rate).not.toBeNull();
  });

  it("ignores an unknown interaction kind rather than miscounting the denominator", () => {
    const m = metricsAt();
    m.recordInteraction("something_new");
    for (let i = 0; i < 5; i += 1) m.recordInteraction("selection");
    expect(m.snapshot().takeover.denominator).toBe(5);
  });
});

describe("the card-fallback rate", () => {
  it("counts fallbacks over attempts, not over cards shown", () => {
    const m = metricsAt();
    // 5 spoken confirmations judged, 2 fell back to the card.
    m.recordConfirmationJudged(true);
    m.recordConfirmationJudged(true);
    m.recordConfirmationJudged(false);
    m.recordConfirmationJudged(false);
    m.recordConfirmationJudged(false);
    expect(m.snapshot().cardFallback).toMatchObject({ numerator: 2, denominator: 5 });
    expect(m.snapshot().cardFallback.rate).toBeCloseTo(0.4);
  });

  it("has its own denominator, independent of the interaction count", () => {
    const m = metricsAt();
    m.recordConfirmationJudged(true);
    expect(m.snapshot().cardFallback.rate).toBeNull(); // denominator 1
    expect(m.snapshot().takeover.denominator).toBe(0);
  });
});

describe("freshness", () => {
  it("is null before anything is recorded, then stamps the last touch", () => {
    const m = metricsAt("2026-08-16T12:00:00.000Z");
    expect(m.snapshot().updatedAt).toBeNull();
    m.recordInteraction("selection");
    expect(m.snapshot().updatedAt).toBe("2026-08-16T12:00:00.000Z");
  });
});
