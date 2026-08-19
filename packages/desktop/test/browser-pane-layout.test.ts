/**
 * Pane layout arithmetic (src/browser-pane-layout.ts). Pure functions — no Electron, no window.
 *
 * The cases that matter are the ones where the renderer's measurement is *wrong*: stale from before
 * a resize, negative because an element scrolled above the viewport, or enormous because a layout
 * pass caught the element mid-animation. Electron will happily place a view off-screen, so clipping
 * is the only thing standing between a bad measurement and a view painted somewhere it should not be.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  clipToWindow,
  computePaneLayout,
  isPaneVisible,
  layoutChanged,
} from "../src/browser-pane-layout.js";

const CONTENT = { width: 1280, height: 800 };

describe("clipToWindow", () => {
  it("passes a rectangle that already fits through unchanged", () => {
    expect(clipToWindow({ x: 640, y: 48, width: 600, height: 700 }, CONTENT)).toEqual({
      x: 640,
      y: 48,
      width: 600,
      height: 700,
    });
  });

  it("rounds fractional measurements to whole pixels", () => {
    // A flex layout at a fractional zoom produces these constantly, and Electron rejects them.
    expect(clipToWindow({ x: 640.4, y: 47.6, width: 599.5, height: 700.2 }, CONTENT)).toEqual({
      x: 640,
      y: 48,
      width: 600,
      height: 700,
    });
  });

  it("shrinks a rectangle that starts off the left and top edges", () => {
    // The regression: clamping the origin to 0 while keeping the original width returned a
    // rectangle 50px wider than the part actually on screen, and a WebContentsView placed there
    // covered that much extra conversation.
    expect(clipToWindow({ x: -50, y: -20, width: 400, height: 300 }, CONTENT)).toEqual({
      x: 0,
      y: 0,
      width: 350,
      height: 280,
    });
  });

  it("collapses a rectangle entirely off the left edge", () => {
    expect(clipToWindow({ x: -500, y: 10, width: 400, height: 300 }, CONTENT)).toMatchObject({
      x: 0,
      width: 0,
    });
  });

  it("collapses a rectangle entirely off the top edge", () => {
    expect(clipToWindow({ x: 10, y: -400, width: 400, height: 300 }, CONTENT)).toMatchObject({
      y: 0,
      height: 0,
    });
  });

  it("keeps a rectangle wider than the window to the window", () => {
    expect(clipToWindow({ x: -100, y: -100, width: 5000, height: 5000 }, CONTENT)).toEqual({
      x: 0,
      y: 0,
      width: CONTENT.width,
      height: CONTENT.height,
    });
  });

  it("intersects on both axes at once", () => {
    expect(clipToWindow({ x: -40, y: 700, width: 200, height: 400 }, CONTENT)).toEqual({
      x: 0,
      y: 700,
      width: 160,
      height: 100,
    });
  });

  it("truncates a rectangle that runs off the right edge", () => {
    const rect = clipToWindow({ x: 1000, y: 0, width: 900, height: 400 }, CONTENT);
    expect(rect.x).toBe(1000);
    expect(rect.width).toBe(280);
  });

  it("truncates a rectangle that runs off the bottom edge", () => {
    const rect = clipToWindow({ x: 0, y: 700, width: 400, height: 400 }, CONTENT);
    expect(rect.height).toBe(100);
  });

  it("collapses to zero when the origin is past the content box", () => {
    const rect = clipToWindow({ x: 2000, y: 2000, width: 400, height: 400 }, CONTENT);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });

  it("never returns a negative size for a zero-sized window", () => {
    const rect = clipToWindow({ x: 10, y: 10, width: 100, height: 100 }, { width: 0, height: 0 });
    expect(rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("treats a negative content size as empty rather than inverted", () => {
    const rect = clipToWindow({ x: 0, y: 0, width: 100, height: 100 }, { width: -10, height: -10 });
    expect(rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("never reports more area than the window has", () => {
    const cases = [
      { x: -50, y: -20, width: 400, height: 300 },
      { x: 1000, y: 700, width: 900, height: 400 },
      { x: -1000, y: -1000, width: 4000, height: 4000 },
      { x: 640.4, y: 47.6, width: 599.5, height: 700.2 },
    ];
    for (const measurement of cases) {
      const rect = clipToWindow(measurement, CONTENT);
      expect(rect.x + rect.width).toBeLessThanOrEqual(CONTENT.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(CONTENT.height);
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("isPaneVisible", () => {
  it("accepts a rectangle at the minimum size", () => {
    expect(isPaneVisible({ x: 0, y: 0, width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT })).toBe(
      true,
    );
  });

  it("rejects a sliver too narrow to read or click", () => {
    expect(isPaneVisible({ x: 0, y: 0, width: MIN_PANE_WIDTH - 1, height: 600 })).toBe(false);
  });

  it("rejects a rectangle too short to be usable", () => {
    expect(isPaneVisible({ x: 0, y: 0, width: 800, height: MIN_PANE_HEIGHT - 1 })).toBe(false);
  });
});

describe("computePaneLayout", () => {
  const measurement = { x: 640, y: 48, width: 600, height: 700 };

  it("places and shows a requested pane", () => {
    const layout = computePaneLayout({
      measurement,
      content: CONTENT,
      requested: true,
      occluded: false,
    });
    expect(layout.visible).toBe(true);
    expect(layout.bounds).toEqual(measurement);
  });

  it("hides the view when the renderer has not asked for the pane", () => {
    const layout = computePaneLayout({
      measurement,
      content: CONTENT,
      requested: false,
      occluded: false,
    });
    expect(layout.visible).toBe(false);
  });

  it("hides the view while something in the DOM covers it", () => {
    // A WebContentsView paints above the DOM, so a modal cannot be drawn over it — the view has to
    // step aside instead.
    const layout = computePaneLayout({
      measurement,
      content: CONTENT,
      requested: true,
      occluded: true,
    });
    expect(layout.visible).toBe(false);
  });

  it("hides the view when the renderer has measured nothing yet", () => {
    const layout = computePaneLayout({
      measurement: null,
      content: CONTENT,
      requested: true,
      occluded: false,
    });
    expect(layout.visible).toBe(false);
  });

  it("hides the view when the window has been resized down to a sliver", () => {
    const layout = computePaneLayout({
      measurement,
      content: { width: 700, height: 800 },
      requested: true,
      occluded: false,
    });
    // 700 - 640 leaves 60px, below the readable minimum.
    expect(layout.bounds.width).toBe(60);
    expect(layout.visible).toBe(false);
  });

  it("returns a zero rectangle whenever it is hidden, never a stale one", () => {
    const layout = computePaneLayout({
      measurement,
      content: CONTENT,
      requested: false,
      occluded: false,
    });
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("layoutChanged", () => {
  const base = { bounds: { x: 1, y: 2, width: 3, height: 4 }, visible: true };

  it("treats the first layout as a change", () => {
    expect(layoutChanged(null, base)).toBe(true);
  });

  it("reports no change for an identical layout", () => {
    expect(layoutChanged(base, { bounds: { ...base.bounds }, visible: true })).toBe(false);
  });

  it("reports a change when visibility flips", () => {
    expect(layoutChanged(base, { bounds: { ...base.bounds }, visible: false })).toBe(true);
  });

  it.each(["x", "y", "width", "height"] as const)("reports a change when %s moves", (field) => {
    const next = { bounds: { ...base.bounds, [field]: base.bounds[field] + 1 }, visible: true };
    expect(layoutChanged(base, next)).toBe(true);
  });
});
