import { describe, expect, it } from "vitest";
import { formatBrowserZoom, stepBrowserZoom } from "../src/features/chat/browser-zoom";

describe("browser page zoom", () => {
  it("uses familiar named steps in both directions", () => {
    expect(stepBrowserZoom(1, -1)).toBe(0.9);
    expect(stepBrowserZoom(1, 1)).toBe(1.1);
    expect(stepBrowserZoom(1.1, 1)).toBe(1.25);
  });

  it("moves away from an in-between value instead of snapping the wrong way", () => {
    expect(stepBrowserZoom(1.04, -1)).toBe(1);
    expect(stepBrowserZoom(1.04, 1)).toBe(1.1);
  });

  it("stops at the safe menu bounds", () => {
    expect(stepBrowserZoom(0.5, -1)).toBe(0.5);
    expect(stepBrowserZoom(2, 1)).toBe(2);
  });

  it("formats the scale as a whole percentage", () => {
    expect(formatBrowserZoom(0.67)).toBe("67%");
    expect(formatBrowserZoom(1.25)).toBe("125%");
  });
});
