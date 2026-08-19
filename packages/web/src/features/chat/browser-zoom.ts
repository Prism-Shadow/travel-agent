/** Chrome-like page scales exposed by the compact Browser menu. */
export const BROWSER_ZOOM_LEVELS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export function formatBrowserZoom(factor: number): string {
  return `${Math.round(factor * 100)}%`;
}

/**
 * Moves to the next named scale even when Chromium reports a value between two menu steps.
 * At either boundary it returns the boundary, which lets the matching control disable itself.
 */
export function stepBrowserZoom(factor: number, direction: -1 | 1): number {
  if (direction > 0) {
    return BROWSER_ZOOM_LEVELS.find((level) => level > factor + Number.EPSILON) ?? 2;
  }
  return [...BROWSER_ZOOM_LEVELS].reverse().find((level) => level < factor - Number.EPSILON) ?? 0.5;
}
