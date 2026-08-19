/**
 * Where the in-app browser view sits inside the window.
 *
 * A `WebContentsView` is positioned by the main process in window coordinates, not by CSS, so the
 * renderer and the main process have to agree on one rectangle. They agree through *this* module:
 * the renderer measures the hole it left in its own layout and reports it, and these functions turn
 * that report into the bounds the view is given.
 *
 * Pure on purpose. Bounds arithmetic is where an off-by-one becomes a one-pixel seam or a view that
 * covers the composer, and neither is worth reproducing by hand in Electron to test. Everything
 * here takes numbers and returns numbers.
 */

/** A rectangle in window coordinates, matching Electron's `Rectangle`. */
export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the renderer measured: the content box of the placeholder element, in CSS pixels. */
export interface PaneMeasurement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowContentSize {
  width: number;
  height: number;
}

/**
 * Smallest view worth showing. Below this the page renders as a sliver that cannot be read or
 * clicked, and Chromium starts logging layout warnings; hiding is the honest response.
 */
export const MIN_PANE_WIDTH = 240;
export const MIN_PANE_HEIGHT = 160;

/** Rounds to whole device-independent pixels. Electron rejects fractional bounds on some platforms. */
function whole(value: number): number {
  return Math.round(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Intersects a measured rectangle with the window's content area.
 *
 * A real intersection, not a clamp of the origin. An earlier version moved a negative `x` up to 0
 * and kept the original width, so a rectangle starting 50px left of the window came back 50px wider
 * than the part actually on screen — and a `WebContentsView` placed at those bounds covered that
 * much extra conversation.
 *
 * The measurement can legitimately fall outside the window for a frame or two: during a resize,
 * while a panel animates, or when the pane scrolls under a toolbar. Rounding happens on the edges
 * rather than on width and height, so a rectangle keeps its screen alignment instead of drifting by
 * a pixel as it moves.
 */
export function clipToWindow(measurement: PaneMeasurement, content: WindowContentSize): PaneRect {
  const contentWidth = Math.max(0, whole(content.width));
  const contentHeight = Math.max(0, whole(content.height));

  const left = clamp(whole(measurement.x), 0, contentWidth);
  const top = clamp(whole(measurement.y), 0, contentHeight);
  const right = clamp(whole(measurement.x + measurement.width), 0, contentWidth);
  const bottom = clamp(whole(measurement.y + measurement.height), 0, contentHeight);

  // `right`/`bottom` land at or before `left`/`top` when the rectangle is entirely off one edge;
  // the max keeps that as an empty rectangle rather than a negative size.
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** Whether a rectangle is big enough to be worth showing at all. */
export function isPaneVisible(rect: PaneRect): boolean {
  return rect.width >= MIN_PANE_WIDTH && rect.height >= MIN_PANE_HEIGHT;
}

export interface PaneLayout {
  /** Where to put the view. Always safe to pass to `setBounds`, even when hidden. */
  bounds: PaneRect;
  /**
   * Whether the view should be attached and painting.
   *
   * False when the renderer says the pane is closed, when a modal is covering the area (a
   * `WebContentsView` renders above the DOM and cannot be overlaid), or when the measured
   * rectangle is too small to use.
   */
  visible: boolean;
}

export interface LayoutInput {
  /** The renderer's measurement, or null when it has not rendered a pane. */
  measurement: PaneMeasurement | null;
  content: WindowContentSize;
  /** The renderer's own intent: is the pane open? */
  requested: boolean;
  /**
   * Something is drawn over the pane area — a modal, a drawer — and the view has to get out of the
   * way. HTML cannot paint above a `WebContentsView`, so "hide it briefly" is the only answer
   * available.
   */
  occluded: boolean;
}

/**
 * The single decision point: given what the renderer measured and asked for, where does the view go
 * and should it be showing?
 */
export function computePaneLayout(input: LayoutInput): PaneLayout {
  const { measurement, content, requested, occluded } = input;
  if (!measurement || !requested || occluded) {
    return { bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false };
  }
  const bounds = clipToWindow(measurement, content);
  return { bounds, visible: isPaneVisible(bounds) };
}

/**
 * Whether two layouts differ enough to be worth pushing to Electron.
 *
 * `setBounds` on every mousemove of a splitter drag is both wasteful and visibly janky. Sub-pixel
 * churn is filtered here rather than in the caller so the throttling rule is testable.
 */
export function layoutChanged(previous: PaneLayout | null, next: PaneLayout): boolean {
  if (!previous) return true;
  if (previous.visible !== next.visible) return true;
  return (
    previous.bounds.x !== next.bounds.x ||
    previous.bounds.y !== next.bounds.y ||
    previous.bounds.width !== next.bounds.width ||
    previous.bounds.height !== next.bounds.height
  );
}
