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

/** Why a page is not showing what was asked for (Chromium's own network error). */
export interface DesktopTabFailure {
  code: number;
  description: string;
  url: string;
}

export interface DesktopTabState {
  /** The shell's own id, stable across a crash rebuild. */
  id: string;
  /** CDP target id; null until a debugger is attached. */
  targetId: string | null;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The task whose agent may write here; null once it has ended, or for a tab the user opened. */
  ownedByTask: string | null;
  /** The user asked to keep this page past the end of its task. */
  retain: boolean;
  failed: DesktopTabFailure | null;
}

export interface DesktopPaneState {
  present: boolean;
  visible: boolean;
  /**
   * Whether the pane should be showing.
   *
   * Main owns this. Either side may ask for the pane — the user by clicking the toggle, the agent
   * by opening a tab — but only main decides, so the renderer follows this rather than keeping its
   * own copy. That is what lets an agent-opened pane appear without the user touching anything.
   */
  requested: boolean;
  /** The tabs of the conversation on screen, in strip order. */
  tabs: DesktopTabState[];
  activeTabId: string | null;
  /** Which conversation those tabs belong to; lets the renderer spot a frame it has outrun. */
  sessionScope: string | null;
  backend: DesktopBackend;
  /** Whether that choice is held shut by a running task (design/002 §7.3: no mid-task switch). */
  backendLocked: boolean;
  /** False when this run's relay is not the one a Chrome extension can connect to. */
  extensionBackendAvailable: boolean;
  /** Whether clearing the browser data is held shut by a task running in any conversation. */
  profileResetLocked: boolean;
  /** Pages left behind by a run that did not shut down cleanly, awaiting the user's answer. */
  restorable: number;
}

export type DesktopBackend = "iab" | "extension";

/** How a task ended, as far as its tabs are concerned (design/002 §6.4). */
export type DesktopTaskOutcome = "read_only" | "committed" | "failed" | "unknown";

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The three ids that identify a conversation to main (it resolves paths from them itself). */
export interface DesktopSessionIds {
  sessionId: string;
  projectId: string;
  agentId: string;
}

export interface DesktopHandoff {
  url: string;
  sessionScope: string;
}

export interface DesktopBrowserBridge {
  /** False when the shell ran with the pane disabled; treated exactly like "no bridge at all". */
  available: boolean;
  setOpen(open: boolean): Promise<void>;
  /** `null` means the placeholder is gone: the pane closed, the window is too narrow, or it unmounted. */
  setBounds(rect: DesktopRect | null): Promise<void>;
  /**
   * Hides the native view **before returning**, and says whether main did it.
   *
   * Synchronous on purpose: it is called from a layout effect during the commit that changes the
   * conversation, and the guarantee it exists for — the previous conversation's page is not on
   * screen when the new conversation paints — cannot be made by a promise the effect does not wait
   * for. Everything else about the pane stays asynchronous.
   */
  hideNow(): boolean;
  setOccluded(occluded: boolean): Promise<void>;
  /**
   * Which conversation is on screen. `null` shows no tabs — every tab belongs to one conversation.
   *
   * Answers with the scope main is now showing, which is how the renderer tells a stale reply from
   * the current one when the route changed twice in a row.
   */
  setSession(sessionId: string | null): Promise<string | null>;
  setBackend(backend: DesktopBackend): Promise<void>;
  getState(): Promise<DesktopPaneState>;
  openTab(url?: string): Promise<string>;
  closeTab(tabId: string): Promise<void>;
  selectTab(tabId: string): Promise<void>;
  setRetain(tabId: string, retain: boolean): Promise<void>;
  navigate(tabId: string, url: string): Promise<void>;
  goBack(tabId: string): Promise<void>;
  goForward(tabId: string): Promise<void>;
  reload(tabId: string): Promise<void>;
  stop(tabId: string): Promise<void>;
  /**
   * A hint that a turn started or finished, so main asks the server sooner.
   *
   * Carries nothing on purpose: main owns which turns are running, and a renderer that could name
   * one could re-authorise a turn that had ended.
   */
  tasksChanged(): Promise<void>;
  restore(accept: boolean): Promise<void>;
  clearProfile(): Promise<void>;
  handoff(): Promise<DesktopHandoff | null>;
  handoffOpen(): Promise<boolean>;
  onState(listener: (state: DesktopPaneState) => void): () => void;
  onFocusAddress(listener: () => void): () => void;
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
