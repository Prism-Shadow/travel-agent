/**
 * Overlay occlusion for the in-app browser (src/lib/pane-occlusion.ts).
 *
 * A `WebContentsView` is a native surface composited above the page, so a dialog does not cover the
 * browser — the browser covers *it*, and clicks meant for the dialog land on a booking site. The
 * only remedy is to hide the view while something is on top of it, and these are the rules for
 * deciding when that is.
 *
 * Two properties matter and neither is obvious from the call sites: nesting (a select inside a
 * modal must not reveal the view when the select closes) and rectangles (a dropdown in the left
 * column must not blink the browser).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  computeOcclusion,
  intersects,
  notifyOcclusionChanged,
  occludePane,
  occlusionEntries,
  resetOcclusionForTests,
  subscribeToOcclusion,
} from "../src/lib/pane-occlusion";
import type { OcclusionRect } from "../src/lib/pane-occlusion";

const pane: OcclusionRect = { x: 800, y: 40, width: 700, height: 800 };

function rect(over: Partial<OcclusionRect>): OcclusionRect {
  return { x: 0, y: 0, width: 100, height: 100, ...over };
}

afterEach(() => {
  resetOcclusionForTests();
});

describe("intersects", () => {
  it("is true for overlapping rectangles", () => {
    expect(intersects(pane, rect({ x: 900, y: 100, width: 200, height: 200 }))).toBe(true);
  });

  it("is false for separated rectangles", () => {
    expect(intersects(pane, rect({ x: 0, y: 0, width: 200, height: 200 }))).toBe(false);
  });

  it("does not count a shared edge", () => {
    // Touching is not covering: a panel that ends exactly where the pane begins hides nothing, and
    // treating it as an overlap would blink the view for every menu opened beside it.
    expect(intersects(pane, rect({ x: 700, y: 40, width: 100, height: 100 }))).toBe(false);
  });

  it("is false for an empty rectangle inside the pane", () => {
    expect(intersects(pane, rect({ x: 900, y: 100, width: 0, height: 0 }))).toBe(false);
  });
});

describe("computeOcclusion", () => {
  it("is false with nothing open", () => {
    expect(computeOcclusion([], pane)).toBe(false);
  });

  it("is false when the pane is not on screen", () => {
    // An overlay opened while the pane is closed must not leave the view hidden once it reopens.
    expect(computeOcclusion([{ id: "modal", getRect: () => null }], null)).toBe(false);
  });

  it("treats a full-screen overlay as covering everything", () => {
    expect(computeOcclusion([{ id: "modal", getRect: () => null }], pane)).toBe(true);
  });

  it("ignores a panel that does not reach the pane", () => {
    const entries = [{ id: "menu", getRect: () => rect({ x: 20, y: 20 }) }];
    expect(computeOcclusion(entries, pane)).toBe(false);
  });

  it("occludes for a panel that does reach it", () => {
    const entries = [{ id: "menu", getRect: () => rect({ x: 820, y: 60 }) }];
    expect(computeOcclusion(entries, pane)).toBe(true);
  });

  it("occludes for a panel that has not measured itself yet", () => {
    // A panel mid-mount reports null. Assuming it covers everything is the safe direction: one
    // frame of a hidden view beats one frame of a native surface eating the click.
    const entries = [{ id: "menu", getRect: () => null }];
    expect(computeOcclusion(entries, pane)).toBe(true);
  });

  it("re-reads the rectangle each time, so a panel that moved is judged where it is now", () => {
    let position = 20;
    const entries = [{ id: "menu", getRect: () => rect({ x: position, y: 60 }) }];
    expect(computeOcclusion(entries, pane)).toBe(false);
    position = 820;
    expect(computeOcclusion(entries, pane)).toBe(true);
  });
});

describe("the registry", () => {
  it("counts nested overlays, so the inner one closing does not reveal the view", () => {
    // The regression a boolean would have: a select inside a modal closes, the flag flips to false,
    // and the browser paints over the dialog that is still up.
    const releaseOuter = occludePane(() => null);
    const releaseInner = occludePane(() => null);
    expect(computeOcclusion(occlusionEntries(), pane)).toBe(true);

    releaseInner();
    expect(computeOcclusion(occlusionEntries(), pane)).toBe(true);

    releaseOuter();
    expect(computeOcclusion(occlusionEntries(), pane)).toBe(false);
  });

  it("ignores a second release from the same overlay", () => {
    const release = occludePane(() => null);
    const other = occludePane(() => null);
    release();
    release();
    expect(occlusionEntries()).toHaveLength(1);
    other();
  });

  it("notifies subscribers when an already-open overlay changes shape", () => {
    // A toast stack gaining a second toast: no entry is added or removed, but the rectangle it
    // reports is now a different one, and the verdict has to be taken again.
    let notifications = 0;
    const unsubscribe = subscribeToOcclusion(() => {
      notifications += 1;
    });
    const release = occludePane(() => rect({ x: 20, y: 20 }));
    const before = notifications;
    notifyOcclusionChanged();
    expect(notifications).toBe(before + 1);
    release();
    unsubscribe();
  });

  it("notifies subscribers when the set changes", () => {
    let notifications = 0;
    const unsubscribe = subscribeToOcclusion(() => {
      notifications += 1;
    });
    const release = occludePane(() => null);
    expect(notifications).toBe(1);
    release();
    expect(notifications).toBe(2);
    unsubscribe();
    occludePane(() => null)();
    expect(notifications).toBe(2);
  });
});
