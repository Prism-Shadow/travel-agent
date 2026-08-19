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
};

function emptyState(scopeSettled: boolean): BrowserPaneState {
  return {
    supported: true,
    tabs: [],
    activeTabId: null,
    activeTab: null,
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
    dragPreview: null,
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

});
