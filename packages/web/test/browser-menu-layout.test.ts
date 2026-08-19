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

type Capture = {
  dataUrl: string;
  bounds: { x: number; y: number; width: number; height: number };
};

function viewport(
  menuOpen: boolean,
  preview: Capture | null = null,
  dragPreview: Capture | null = null,
): string {
  return renderToStaticMarkup(
    createElement(BrowserPaneViewport, { measureRef: () => {}, menuOpen, preview, dragPreview }),
  );
}

describe("BrowserPaneViewport", () => {
  it("keeps the full native page rectangle in both menu states", () => {
    expect(viewport(false)).toContain('class="absolute inset-0 overflow-hidden"');
    expect(
      viewport(true, {
        dataUrl: "data:image/png;base64,AAAA",
        bounds: { x: 801, y: 178, width: 819, height: 1090 },
      }),
    ).toContain('class="absolute inset-0 overflow-hidden"');
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

  it("pins the splitter-drag frozen frame to the hole at its captured pixel size", () => {
    const capture = {
      dataUrl: "data:image/png;base64,BBBB",
      bounds: { x: 640, y: 120, width: 1024, height: 900 },
    };
    const markup = viewport(false, null, capture);
    // Inside the hole and anchored to its origin — not fixed page coordinates like the menu
    // preview: the hole itself moves and resizes for the whole drag.
    expect(markup).toContain('data-testid="iab-drag-preview"');
    expect(markup).toContain('data-drag-preview="true"');
    expect(markup).toContain("width:1024px;height:900px");
    expect(markup).not.toContain("left:640px");
    expect(markup).toContain("max-w-none");
  });

  it("renders no drag frame outside a drag", () => {
    expect(viewport(false)).toContain('data-drag-preview="false"');
    expect(viewport(false)).not.toContain('data-testid="iab-drag-preview"');
  });
});
