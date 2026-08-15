/**
 * Splitter arithmetic (browser-pane-split.ts). Pure functions — no DOM, no pointer events.
 *
 * The rule worth testing is the clamping. A splitter that can be dragged until the composer is
 * unusable, or until the browser is a sliver, is worse than one that cannot move at all, and both
 * limits bind at different window widths: the fractions govern a large window, the pixel floors
 * take over on a small one.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANE_FRACTION,
  KEYBOARD_PAGE_STEP,
  KEYBOARD_STEP,
  MAX_PANE_FRACTION,
  MIN_CHAT_PX,
  MIN_PANE_FRACTION,
  MIN_PANE_PX,
  ariaValueNow,
  canSplit,
  clampPaneFraction,
  fractionFromKey,
  fractionFromPointer,
} from "../src/features/chat/browser-pane-split";

const WIDE = 1600;

describe("clampPaneFraction", () => {
  it("leaves a sensible fraction alone", () => {
    expect(clampPaneFraction(0.5, WIDE)).toBeCloseTo(0.5, 5);
  });

  it("clamps to the fraction range on a wide window", () => {
    expect(clampPaneFraction(0.95, WIDE)).toBeCloseTo(MAX_PANE_FRACTION, 5);
    expect(clampPaneFraction(0.02, WIDE)).toBeCloseTo(MIN_PANE_FRACTION, 5);
  });

  it("keeps the conversation column usable on a narrow window", () => {
    // At 900px, 75% would leave the chat 225px — below the composer's floor.
    const width = 900;
    const result = clampPaneFraction(MAX_PANE_FRACTION, width);
    expect(width * (1 - result)).toBeGreaterThanOrEqual(MIN_CHAT_PX - 1);
  });

  it("keeps the browser column usable on a narrow window", () => {
    const width = 900;
    const result = clampPaneFraction(MIN_PANE_FRACTION, width);
    expect(width * result).toBeGreaterThanOrEqual(MIN_PANE_PX - 1);
  });

  it("falls back to the default for a non-finite fraction", () => {
    expect(clampPaneFraction(Number.NaN, WIDE)).toBeCloseTo(DEFAULT_PANE_FRACTION, 5);
  });

  it("does not divide by a zero or missing width", () => {
    expect(clampPaneFraction(0.5, 0)).toBeCloseTo(0.5, 5);
    expect(Number.isFinite(clampPaneFraction(0.5, Number.NaN))).toBe(true);
  });

  it("returns something finite when the window is too small for both floors", () => {
    const result = clampPaneFraction(0.5, 400);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });
});

describe("canSplit", () => {
  it("allows a window that fits both minimums", () => {
    expect(canSplit(MIN_CHAT_PX + MIN_PANE_PX)).toBe(true);
  });

  it("refuses a window one pixel too narrow", () => {
    expect(canSplit(MIN_CHAT_PX + MIN_PANE_PX - 1)).toBe(false);
  });

  it("refuses a nonsense width", () => {
    expect(canSplit(Number.NaN)).toBe(false);
    expect(canSplit(0)).toBe(false);
  });
});

describe("fractionFromPointer", () => {
  it("maps the pointer to the space on its right", () => {
    // Container 0..1600, pointer at 960 → 640px of browser → 0.4.
    expect(fractionFromPointer(960, 0, WIDE)).toBeCloseTo(0.4, 5);
  });

  it("accounts for a container that does not start at the window edge", () => {
    expect(fractionFromPointer(1060, 100, WIDE)).toBeCloseTo(0.4, 5);
  });

  it("clamps a pointer dragged past either end", () => {
    expect(fractionFromPointer(-500, 0, WIDE)).toBeCloseTo(MAX_PANE_FRACTION, 5);
    expect(fractionFromPointer(5000, 0, WIDE)).toBeCloseTo(MIN_PANE_FRACTION, 5);
  });
});

describe("fractionFromKey", () => {
  it("grows the conversation with ArrowLeft and the browser with ArrowRight", () => {
    // The separator is vertical: left moves it left, which enlarges the browser side.
    expect(fractionFromKey("ArrowLeft", 0.5, WIDE)).toBeCloseTo(0.5 + KEYBOARD_STEP, 5);
    expect(fractionFromKey("ArrowRight", 0.5, WIDE)).toBeCloseTo(0.5 - KEYBOARD_STEP, 5);
  });

  it("moves further with Page keys", () => {
    expect(fractionFromKey("PageUp", 0.5, WIDE)).toBeCloseTo(0.5 + KEYBOARD_PAGE_STEP, 5);
    expect(fractionFromKey("PageDown", 0.5, WIDE)).toBeCloseTo(0.5 - KEYBOARD_PAGE_STEP, 5);
  });

  it("jumps to the ends with Home and End", () => {
    expect(fractionFromKey("Home", 0.5, WIDE)).toBeCloseTo(MIN_PANE_FRACTION, 5);
    expect(fractionFromKey("End", 0.5, WIDE)).toBeCloseTo(MAX_PANE_FRACTION, 5);
  });

  it("clamps rather than running past the limit", () => {
    expect(fractionFromKey("ArrowLeft", MAX_PANE_FRACTION, WIDE)).toBeCloseTo(MAX_PANE_FRACTION, 5);
  });

  it("returns null for keys it does not handle, so the caller can let them through", () => {
    // Swallowing every key on a focused separator would break tabbing away from it.
    expect(fractionFromKey("Tab", 0.5, WIDE)).toBeNull();
    expect(fractionFromKey("a", 0.5, WIDE)).toBeNull();
    expect(fractionFromKey("Enter", 0.5, WIDE)).toBeNull();
  });
});

describe("ariaValueNow", () => {
  it("reports an integer percentage", () => {
    expect(ariaValueNow(0.46)).toBe(46);
    expect(Number.isInteger(ariaValueNow(0.4567))).toBe(true);
  });
});
