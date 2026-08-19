/**
 * The one bridge between the app's renderer and the main process.
 *
 * `main.ts` has held a strict line since it was written: the window is a plain browser, with no
 * preload and no IPC, and every capability arrives over the server's HTTP API. The in-app browser
 * is the first thing that cannot be built that way — a `WebContentsView` is positioned by the main
 * process, so the renderer has to be able to say where it goes.
 *
 * Breaking that line narrowly rather than generally is the whole design of this file (design/002
 * §5.1):
 *
 *   - **No generic `invoke(channel, ...args)`.** Each capability is its own named function. A
 *     renderer compromise cannot reach a channel that is not listed here.
 *   - **Every argument is validated in the main process**, not here. A preload runs alongside the
 *     renderer and must be treated as reachable; validation that lives here is decoration.
 *   - **This preload is attached to the app window only.** In-app browser views get no preload at
 *     all — see `session-partition.ts`, where that is stated as an explicit `undefined`.
 *
 * The surface is a browser's: place the pane, drive its tabs, and observe them. Note what is *not*
 * here — nothing takes a task id. Ownership of a tab is decided by the harness identity that
 * travels with the agent's own commands, never by something the renderer asserts.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IAB_ENABLED_SWITCH } from "./iab-switch.js";

/** Matches `TabFailure` in `browser-pane.ts`. Duplicated to keep the preload dependency-free. */
export interface BridgeTabFailure {
  code: number;
  description: string;
  url: string;
}

/** Matches `PaneTabState` in `browser-pane.ts`. */
export interface BridgeTabState {
  id: string;
  targetId: string | null;
  url: string;
  title: string;
  faviconUrl: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  ownedByTask: string | null;
  retain: boolean;
  failed: BridgeTabFailure | null;
}

/** Matches `PaneState` in `browser-pane.ts`. */
export interface BridgePaneState {
  present: boolean;
  visible: boolean;
  /** Whether the pane should be showing; main owns it, the renderer follows it. */
  requested: boolean;
  tabs: BridgeTabState[];
  activeTabId: string | null;
  sessionScope: string | null;
  backend: "iab" | "extension";
  backendLocked: boolean;
  extensionBackendAvailable: boolean;
  profileResetLocked: boolean;
  restorable: number;
}

export interface BridgeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A frozen page and the exact integer WebContentsView rectangle it replaces. */
export interface BridgePageCapture {
  dataUrl: string;
  bounds: BridgeRect;
}

/** The three ids that identify a conversation to main. */
export interface BridgeSessionIds {
  sessionId: string;
  projectId: string;
  agentId: string;
}

export interface BridgeHandoff {
  url: string;
  sessionScope: string;
}

/** Matches `TaskOutcome` in `tab-lifecycle.ts`. */
export type BridgeTaskOutcome = "read_only" | "committed" | "failed" | "unknown";

/** Matches `ImportKind` in `browser-import/chrome-profiles.ts`. */
export type BridgeImportKind = "passwords" | "cookies" | "history";

/** Matches `ImportSource`. Carries labels and counts — never a path. */
export interface BridgeImportSource {
  id: string;
  browserLabel: string;
  profileLabel: string | null;
  counts: Partial<Record<BridgeImportKind, number | null>>;
  available: BridgeImportKind[];
}

export interface BridgeImportSources {
  sources: BridgeImportSource[];
  /** Browsers that are running, so the dialog can ask for them to be closed first. */
  runningBrowsers: string[];
  /** False when this machine has no encrypted storage, so passwords cannot be offered. */
  credentialsAvailable: boolean;
}

export interface BridgeImportKindOutcome {
  kind: BridgeImportKind;
  imported: number;
  skipped: number;
  failure: string | null;
}

export interface BridgeImportOutcome {
  sourceId: string;
  results: BridgeImportKindOutcome[];
  anythingImported: boolean;
}

/** Matches `LoginOffer` in `browser-import/login-service.ts`. Never carries a password. */
export interface BridgeLoginOffer {
  id: string;
  username: string;
  origin: string;
}

export interface BridgeLoginOffers {
  /** Whether the page has a sign-in form at all. No form, no offers, whatever is stored. */
  formPresent: boolean;
  offers: BridgeLoginOffer[];
  /** Set when nothing can be offered for a reason worth showing. */
  unavailable: string | null;
}

export type BridgeLoginFillResult =
  { ok: true; username: string; wroteUsername: boolean } | { ok: false; reason: string };

/** Matches `HistoryEntry` in `browser-import/history-store.ts`. */
export interface BridgeHistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  lastVisitedAt: string | null;
}

/**
 * Whether the shell actually wired a pane this run.
 *
 * Passed down as an `additionalArguments` switch rather than assumed, because the capability is
 * behind the `iab.enabled` feature flag (design/004 §5). A preload always runs; what it may
 * *offer* depends on what main decided, so the flag is read here rather than re-derived.
 */
const enabled = process.argv.includes(IAB_ENABLED_SWITCH);

const api = {
  /** False when the pane is switched off, so the web app hides the column exactly as it does in a browser tab. */
  available: enabled,

  // —— panel ——

  /** Open or close the pane. */
  setOpen: (open: boolean): Promise<void> => ipcRenderer.invoke("iab:set-open", open),

  /**
   * Report where the placeholder element is, in CSS pixels relative to the window.
   *
   * `null` means "there is no hole any more" — the pane closed, the window became too narrow to
   * split, or the component unmounted. Main hides the view rather than leaving it at the last
   * rectangle it was told about, which would otherwise sit on top of the conversation.
   */
  setBounds: (rect: BridgeRect | null): Promise<void> => ipcRenderer.invoke("iab:set-bounds", rect),

  /**
   * Hide the native view **before this call returns**.
   *
   * The one synchronous channel in this file, and it exists because the asynchronous one cannot
   * state the guarantee that matters. When the route changes, React commits the new conversation's
   * frame and the browser paints it; the `WebContentsView` is a surface composited *above* that
   * frame, and it goes on showing the previous conversation's page until main is told to hide it.
   * An `invoke` from a layout effect only *starts* that conversation — the effect returns, the
   * paint happens, and whether the view was hidden first is a race with the IPC.
   *
   * `sendSync` blocks the renderer until main has answered, so the frame the user sees cannot be
   * the one with the wrong page on it. It is deliberately the narrowest thing that can be: it takes
   * no arguments, it can only *hide*, and showing again goes back through the ordinary async path
   * once the new conversation's own bounds are measured. Returns whether main confirmed it.
   */
  hideNow: (): boolean => ipcRenderer.sendSync("iab:hide-now") === true,

  /** Hide the view while something in the DOM covers its area, then show it again. */
  setOccluded: (occluded: boolean): Promise<void> =>
    ipcRenderer.invoke("iab:set-occluded", occluded),

  /** Frozen pixels used only while the DOM-owned Browser menu covers the native view. */
  captureActivePage: (): Promise<BridgePageCapture | null> =>
    ipcRenderer.invoke("iab:capture-active-page"),

  /**
   * Which browser scope the user is looking at (a conversation or a pre-send draft).
   *
   * Decides which tabs the strip shows. `null` shows none — a tab belongs to the scope it was opened
   * in, and no other one may display it. For a real Session, main resolves download ownership from
   * the server; a draft scope is only an opaque local tab owner.
   *
   * Answers with the scope main is now showing, so a renderer that changed route twice in quick
   * succession can tell which switch this reply belongs to.
   */
  setSession: (sessionId: string | null): Promise<string | null> =>
    ipcRenderer.invoke("iab:set-session", sessionId),

  /** Promote the active draft's browser strip to its newly-created Session (or roll it back). */
  reassignSession: (sessionId: string): Promise<string> =>
    ipcRenderer.invoke("iab:reassign-session", sessionId),

  /** Which browser the next agent session should use (002 §6.1). */
  setBackend: (backend: "iab" | "extension"): Promise<void> =>
    ipcRenderer.invoke("iab:set-backend", backend),

  /** Current state, for a renderer that has just mounted. */
  getState: (): Promise<BridgePaneState> => ipcRenderer.invoke("iab:get-state"),

  // —— tabs ——

  openTab: (url?: string): Promise<string> => ipcRenderer.invoke("iab:open-tab", { url }),
  closeTab: (tabId: string): Promise<void> => ipcRenderer.invoke("iab:close-tab", tabId),
  selectTab: (tabId: string): Promise<void> => ipcRenderer.invoke("iab:select-tab", tabId),
  /** The user's "keep this page past the end of the task" mark. */
  setRetain: (tabId: string, retain: boolean): Promise<void> =>
    ipcRenderer.invoke("iab:set-retain", { tabId, retain }),
  /** Scale one IAB page while leaving the app UI unchanged. */
  setZoom: (tabId: string, factor: number): Promise<void> =>
    ipcRenderer.invoke("iab:set-zoom", { tabId, factor }),
  navigate: (tabId: string, url: string): Promise<void> =>
    ipcRenderer.invoke("iab:navigate", { tabId, url }),
  goBack: (tabId: string): Promise<void> => ipcRenderer.invoke("iab:go-back", tabId),
  goForward: (tabId: string): Promise<void> => ipcRenderer.invoke("iab:go-forward", tabId),
  reload: (tabId: string): Promise<void> => ipcRenderer.invoke("iab:reload", tabId),
  stop: (tabId: string): Promise<void> => ipcRenderer.invoke("iab:stop", tabId),

  // —— lifecycle ——

  /**
   * Something about the running turns changed — one started, one finished.
   *
   * A **hint**, carrying nothing. Main owns which turns are running: it asks the server directly,
   * because the chat page's stream is disposed on every route change and a reload takes any
   * renderer bookkeeping with it. All this does is bring main's next question forward.
   *
   * Deliberately argument-free. Anything it named would be a fact the renderer had asserted, and a
   * stale frame asserting a finished turn is exactly the authority a leftover background command is
   * trying to reuse.
   */
  tasksChanged: (): Promise<void> => ipcRenderer.invoke("iab:tasks-changed"),


  /** Sign out of everything: clear the pane's cookies and storage, and close its tabs. */
  clearProfile: (): Promise<void> => ipcRenderer.invoke("iab:clear-profile"),

  // —— importing from another browser ——

  /**
   * Which browser profiles this machine has, and whether one of them is running.
   *
   * Reads names and counts only. Nothing here decrypts anything, so opening the dialog never
   * provokes the macOS keychain prompt — that happens on Import, for the kinds that were ticked.
   */
  importSources: (): Promise<BridgeImportSources> => ipcRenderer.invoke("iab:import-sources"),

  /**
   * Bring the selected data over from one profile.
   *
   * Takes the **id of a source main itself listed**, never a path. Answers with what each kind did,
   * including what it could not read, so a partial import can be shown as partial.
   */
  importFromBrowser: (request: {
    sourceId: string;
    kinds: BridgeImportKind[];
  }): Promise<BridgeImportOutcome> => ipcRenderer.invoke("iab:import-run", request),

  /**
   * Address-bar completion from what has been visited and imported.
   *
   * Answers an empty list rather than failing when there is no history: a completion that cannot be
   * produced is not an error worth showing while somebody is typing.
   */
  historySuggest: (query: string): Promise<BridgeHistoryEntry[]> =>
    ipcRenderer.invoke("iab:history-suggest", query),

  // —— saved logins ——
  //
  // Both take a tab id and nothing else. Main asks the pane what URL that tab is on, so the origin
  // a password is chosen for is never one this side named. There is deliberately no agent-facing
  // equivalent of either — see `browser-import/login-service.ts`.

  /** Which saved logins apply to the sign-in form on this tab, if it has one. Never a password. */
  loginOffers: (tabId: string): Promise<BridgeLoginOffers> =>
    ipcRenderer.invoke("iab:login-offers", tabId),

  /** Type one saved login into this tab's sign-in form. Does not submit it. */
  loginFill: (request: { tabId: string; credentialId: string }): Promise<BridgeLoginFillResult> =>
    ipcRenderer.invoke("iab:login-fill", request),

  /** What would move to the user's own browser (002 §7.2). Null when there is no page to hand over. */
  handoff: (): Promise<BridgeHandoff | null> => ipcRenderer.invoke("iab:handoff"),

  /**
   * Open the active tab in the user's own browser.
   *
   * Takes no URL on purpose: main re-derives it from the tab. A channel that accepted one would be
   * a "launch any URL in the OS" primitive wearing a browser's name.
   */
  handoffOpen: (): Promise<boolean> => ipcRenderer.invoke("iab:handoff-open"),

  // —— events ——

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   *
   * The listener is wrapped so the renderer never receives Electron's `IpcRendererEvent`, which
   * carries a `sender` it has no business holding.
   */
  onState: (listener: (state: BridgePaneState) => void): (() => void) => {
    const wrapped = (_event: unknown, state: BridgePaneState): void => listener(state);
    ipcRenderer.on("iab:state", wrapped);
    return () => ipcRenderer.removeListener("iab:state", wrapped);
  },

  /**
   * Cmd/Ctrl+L arrived while the pane had the keyboard.
   *
   * The shortcut table lives in main because keyboard focus can be inside a page, where the
   * renderer sees nothing; focusing the address bar is the one action main cannot carry out
   * itself, so it comes back here.
   */
  onFocusAddress: (listener: () => void): (() => void) => {
    const wrapped = (): void => listener();
    ipcRenderer.on("iab:focus-address", wrapped);
    return () => ipcRenderer.removeListener("iab:focus-address", wrapped);
  },
};

export type TravelAgentBrowserBridge = typeof api;

contextBridge.exposeInMainWorld("travelAgentBrowser", api);
