/**
 * Typed access to the desktop shell's in-app browser bridge.
 *
 * The web app runs in two places. In the desktop shell a preload injects
 * `window.travelAgentBrowser`; in a browser tab — `pnpm dev:web`, or a server someone points a
 * browser at — nothing injects anything, because there is no main process to place a
 * `WebContentsView` and no view to place.
 *
 * So the bridge is optional by construction, and every caller gets `null` rather than a stub that
 * throws. The pane is then simply not rendered, which is the correct degradation: a browser tab
 * cannot host the in-app browser, and pretending otherwise would leave an empty column.
 */

export interface DesktopPaneState {
  present: boolean;
  visible: boolean;
  url: string;
  title: string;
  loading: boolean;
  /**
   * Whether the pane should be showing.
   *
   * Main owns this. Either side may ask for the pane — the user by clicking the toggle, the agent
   * by opening a tab — but only main decides, so the renderer follows this rather than keeping its
   * own copy. That is what lets an agent-opened pane appear without the user touching anything.
   */
  requested: boolean;
}

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopBrowserBridge {
  /** False when the shell ran with the pane disabled; treated exactly like "no bridge at all". */
  available: boolean;
  setOpen(open: boolean): Promise<void>;
  /** `null` means the placeholder is gone: the pane closed, the window is too narrow, or it unmounted. */
  setBounds(rect: DesktopRect | null): Promise<void>;
  setOccluded(occluded: boolean): Promise<void>;
  getState(): Promise<DesktopPaneState>;
  onState(listener: (state: DesktopPaneState) => void): () => void;
}

declare global {
  interface Window {
    travelAgentBrowser?: DesktopBrowserBridge;
  }
}

/**
 * The bridge, or null when this build is not running inside the desktop shell.
 *
 * Reads `window` each call rather than caching at module load: the module may be imported before
 * the preload has finished exposing its object, and a cached `null` would disable the pane for the
 * lifetime of the tab.
 */
export function desktopBrowserBridge(): DesktopBrowserBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.travelAgentBrowser;
  return bridge?.available === true ? bridge : null;
}

/** Whether the in-app browser pane can exist at all here. */
export function hasDesktopBrowser(): boolean {
  return desktopBrowserBridge() !== null;
}
