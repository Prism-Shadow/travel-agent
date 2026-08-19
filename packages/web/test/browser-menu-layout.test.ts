/**
 * The Browser menu is the one dropdown that must keep the native IAB page visible.
 *
 * Its parent shows a frozen full-size capture while the global occlusion path hides the live native
 * surface. The focused markup assertions protect the unchanged viewport and preview states without
 * needing Electron in this unit suite.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserPaneViewport } from "../src/features/chat/browser-pane";

function viewport(
  menuOpen: boolean,
  preview: {
    dataUrl: string;
    bounds: { x: number; y: number; width: number; height: number };
  } | null = null,
): string {
  return renderToStaticMarkup(
    createElement(BrowserPaneViewport, { measureRef: () => {}, menuOpen, preview }),
  );
}

describe("BrowserPaneViewport", () => {
  it("keeps the full native page rectangle in both menu states", () => {
    expect(viewport(false)).toContain('class="absolute inset-0"');
    expect(
      viewport(true, {
        dataUrl: "data:image/png;base64,AAAA",
        bounds: { x: 801, y: 178, width: 819, height: 1090 },
      }),
    ).toContain('class="absolute inset-0"');
  });

  it("keeps the frozen page through the native-view restore handoff", () => {
    const preview = {
      dataUrl: "data:image/png;base64,AAAA",
      bounds: { x: 801, y: 178, width: 819, height: 1090 },
    };
    expect(viewport(false, preview)).toContain('data-testid="iab-menu-preview"');
    expect(viewport(true, preview)).toContain('data-testid="iab-menu-preview"');
    expect(viewport(true, preview)).toContain('data-menu-preview="true"');
    expect(viewport(true, preview)).toContain("left:801px;top:178px;width:819px;height:1090px");
    expect(viewport(true, preview)).toContain("fixed z-40");
    expect(viewport(false)).not.toContain('data-testid="iab-menu-preview"');
  });
});
