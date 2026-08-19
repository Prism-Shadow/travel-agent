/**
 * Address-bar availability in an empty browser strip.
 *
 * A conversation may legitimately have no tabs yet. The address bar must still accept the first
 * URL in that state; only an unsettled conversation switch should disable it, because main may
 * still be scoped to the conversation the user just left.
 */
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserPanePanel } from "../src/features/chat/browser-pane";
import type { BrowserPaneState } from "../src/features/chat/use-browser-pane";
import type { DesktopPaneState } from "../src/lib/desktop-bridge";

const pane: DesktopPaneState = {
  present: false,
  visible: false,
  requested: true,
  tabs: [],
  activeTabId: null,
  sessionScope: "session-1",
  backend: "iab",
  backendLocked: false,
  extensionBackendAvailable: true,
  profileResetLocked: false,
  restorable: 0,
};

function emptyState(scopeSettled: boolean): BrowserPaneState {
  return {
    supported: true,
    tabs: [],
    activeTabId: null,
    activeTab: null,
    restorable: 0,
    backend: "iab",
    backendLocked: false,
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
      restore: async () => {},
      clearProfile: async () => {},
      setBackend: async () => {},
      openInDefaultBrowser: async () => false,
    },
    addressRef: createRef<HTMLInputElement>(),
    scopeSettled,
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
    pane,
  };
}

function renderedAddress(scopeSettled: boolean): string {
  const markup = renderToStaticMarkup(
    createElement(BrowserPanePanel, { state: emptyState(scopeSettled) }),
  );
  const address = markup.match(/<input[^>]*data-testid="iab-address"[^>]*>/)?.[0];
  expect(address).toBeDefined();
  return address!;
}

describe("BrowserPanePanel address bar", () => {
  it("is editable before the conversation has opened its first tab", () => {
    expect(renderedAddress(true)).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });

  it("stays disabled until main confirms the conversation scope", () => {
    expect(renderedAddress(false)).toMatch(/\sdisabled(?:=|\s|>)/);
  });

  it("gives a startup restore decision the whole pane instead of drawing empty browser chrome", () => {
    const state = emptyState(true);
    state.restorable = 2;
    state.pane = { ...state.pane, restorable: 2 };
    const markup = renderToStaticMarkup(createElement(BrowserPanePanel, { state }));

    expect(markup).toContain('data-testid="iab-restore"');
    expect(markup).not.toContain('data-testid="iab-viewport"');
    expect(markup).not.toContain('data-testid="iab-address"');
  });
});
