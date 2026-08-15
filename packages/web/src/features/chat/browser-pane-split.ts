/**
 * Where the splitter sits between the conversation and the in-app browser.
 *
 * Kept as arithmetic on plain numbers, separate from the component that renders the handle, because
 * the interesting behaviour is entirely in the clamping: a splitter that can be dragged until the
 * composer is unusable, or until the browser is a sliver, is worse than one that cannot be dragged
 * at all. Testing that against a real pointer would be testing jsdom, not the rule.
 */

/** Fraction of the split area given to the browser. */
export const MIN_PANE_FRACTION = 0.25;
export const MAX_PANE_FRACTION = 0.75;
export const DEFAULT_PANE_FRACTION = 0.46;

/** Smallest usable conversation column, in CSS pixels. Below this the composer starts wrapping badly. */
export const MIN_CHAT_PX = 380;
/** Smallest browser worth showing. Matches the main process's own minimum. */
export const MIN_PANE_PX = 320;

/** One arrow-key press. Coarse enough to be useful, fine enough to land where the user wants. */
export const KEYBOARD_STEP = 0.02;
/** Page Up/Down, for crossing the range quickly. */
export const KEYBOARD_PAGE_STEP = 0.1;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Clamps a requested fraction against both the fixed range and the pixel minimums.
 *
 * Two limits rather than one because they bind at different widths: the fractions keep the split
 * sane on a large window, and the pixel floors take over on a small one, where 25% of the width
 * would be too narrow to use. When the container is too small to satisfy both floors the fraction
 * is left at the midpoint of what is possible — the caller is expected to hide the pane entirely at
 * that size, and returning a nonsense value here would make that decision harder to see.
 */
export function clampPaneFraction(fraction: number, containerWidth: number): number {
  const bounded = clamp(
    Number.isFinite(fraction) ? fraction : DEFAULT_PANE_FRACTION,
    MIN_PANE_FRACTION,
    MAX_PANE_FRACTION,
  );
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return bounded;

  const maxByChat = (containerWidth - MIN_CHAT_PX) / containerWidth;
  const minByPane = MIN_PANE_PX / containerWidth;
  if (minByPane > maxByChat) return clamp((minByPane + maxByChat) / 2, 0, 1);
  return clamp(bounded, minByPane, maxByChat);
}

/** Whether the container is wide enough to show both columns at their minimums. */
export function canSplit(containerWidth: number): boolean {
  return Number.isFinite(containerWidth) && containerWidth >= MIN_CHAT_PX + MIN_PANE_PX;
}

/**
 * Fraction implied by a pointer position.
 *
 * The pointer sits on the divider, so everything to its right is the browser. Taking the raw
 * clientX and the container's own left edge keeps this independent of scroll position and of where
 * the app is on screen.
 */
export function fractionFromPointer(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return DEFAULT_PANE_FRACTION;
  return clampPaneFraction(
    (containerLeft + containerWidth - clientX) / containerWidth,
    containerWidth,
  );
}

/**
 * Next fraction for a key press, or null when the key is not one this handles.
 *
 * Returning null rather than the current value lets the caller tell "no change" from "not mine",
 * which is what decides whether to call `preventDefault` — swallowing every key on a focused
 * separator would break tabbing away from it.
 */
export function fractionFromKey(
  key: string,
  current: number,
  containerWidth: number,
): number | null {
  // Left grows the conversation (shrinks the browser); right does the opposite. The separator is
  // vertical, so this matches what the user sees rather than the underlying number.
  switch (key) {
    case "ArrowLeft":
      return clampPaneFraction(current + KEYBOARD_STEP, containerWidth);
    case "ArrowRight":
      return clampPaneFraction(current - KEYBOARD_STEP, containerWidth);
    case "PageUp":
      return clampPaneFraction(current + KEYBOARD_PAGE_STEP, containerWidth);
    case "PageDown":
      return clampPaneFraction(current - KEYBOARD_PAGE_STEP, containerWidth);
    case "Home":
      return clampPaneFraction(MIN_PANE_FRACTION, containerWidth);
    case "End":
      return clampPaneFraction(MAX_PANE_FRACTION, containerWidth);
    default:
      return null;
  }
}

/** Percentage for `aria-valuenow`, which wants an integer in the reported range. */
export function ariaValueNow(fraction: number): number {
  return Math.round(fraction * 100);
}
