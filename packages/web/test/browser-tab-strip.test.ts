/**
 * The browser strip is product chrome, not page content. These assertions keep its compact Codex
 * shape and real-site identity from regressing back to text glyphs and a heavy active underline.
 */
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserTabStrip } from "../src/features/chat/browser-pane";
import type { BrowserPaneState } from "../src/features/chat/use-browser-pane";
import type { DesktopPaneState, DesktopTabState } from "../src/lib/desktop-bridge";

function tab(overrides: Partial<DesktopTabState> = {}): DesktopTabState {
  return {
    id: "tab-1",
    targetId: "target-1",
    url: "https://hotels.ctrip.com/",
    title: "携程酒店",
    faviconUrl: "https://hotels.ctrip.com/favicon.ico",
    loading: false,
    canGoBack: true,
    canGoForward: false,
    zoomFactor: 1,
    ownedByTask: null,
    retain: false,
    failed: null,
    ...overrides,
  };
}

function state(tabs: DesktopTabState[]): BrowserPaneState {
  const pane: DesktopPaneState = {
    present: true,
    visible: true,
    requested: true,
    tabs,
    activeTabId: tabs[0]?.id ?? null,
    sessionScope: "session-1",
    backend: "iab",
    backendLocked: false,
    extensionBackendAvailable: true,
    profileResetLocked: false,
  };
  return {
    supported: true,
    tabs,
    activeTabId: pane.activeTabId,
    activeTab: tabs[0] ?? null,
    backend: "iab",
    backendLocked: false,
    backendChanging: false,
    extensionBackendAvailable: true,
    profileResetLocked: false,
    actions: {
      reassignSession: async () => {},
      openTab: async () => {},
      closeTab: async () => {},
      selectTab: async () => {},
      setRetain: () => {},
      setZoom: async () => {},
      captureActivePage: async () => null,
      navigate: async () => {},
      goBack: () => {},
      goForward: () => {},
      reload: () => {},
      stop: () => {},
      clearProfile: async () => {},
      setBackend: async () => {},
      openInDefaultBrowser: async () => false,
    },
    addressRef: createRef<HTMLInputElement>(),
    scopeSettled: true,
    open: true,
    setOpen: () => {},
    splittable: true,
    fullscreen: false,
    fraction: 0.5,
    containerRef: () => {},
    measureRef: () => {},
    onSplitterPointerDown: () => {},
    onSplitterKeyDown: () => {},
    dragging: false,
    dragPreview: null,
    occlusionPreview: null,
    pane,
  };
}

describe("BrowserTabStrip", () => {
  it("renders a rounded active tab with the page favicon and native-quality controls", () => {
    const markup = renderToStaticMarkup(createElement(BrowserTabStrip, { state: state([tab()]) }));
    const tablist = markup.match(/<div role="tablist"[^>]*>/)?.[0];

    expect(markup).toContain('data-active="true"');
    expect(markup).toContain("rounded-xl");
    expect(markup).toContain("bg-gray-100");
    expect(markup).toContain('src="https://hotels.ctrip.com/favicon.ico"');
    expect(markup).not.toContain("border-b-2");
    expect(markup).not.toContain("★");
    expect(markup).not.toContain("✕");
    expect(markup).not.toContain("＋");
    expect(tablist).toContain("shrink");
    expect(tablist).not.toContain("flex-1");
  });

  it("uses a quiet spinner instead of a stale site icon while the page is loading", () => {
    const markup = renderToStaticMarkup(
      createElement(BrowserTabStrip, { state: state([tab({ loading: true })]) }),
    );

    expect(markup).toContain("animate-spin");
    expect(markup).not.toContain('src="https://hotels.ctrip.com/favicon.ico"');
  });
});
