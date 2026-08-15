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
 * The surface is Phase 1's: place the pane, open and close it, hide it while a modal is up, and
 * observe the one view's state.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IAB_ENABLED_SWITCH } from "./iab-switch.js";

/** Matches `PaneState` in `browser-pane.ts`. Duplicated to keep the preload dependency-free. */
export interface BridgePaneState {
  present: boolean;
  visible: boolean;
  url: string;
  title: string;
  loading: boolean;
  /** Whether the pane should be showing; main owns it, the renderer follows it. */
  requested: boolean;
}

export interface BridgeRect {
  x: number;
  y: number;
  width: number;
  height: number;
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

  /** Open or close the pane. Opening creates the view if it does not exist yet. */
  setOpen: (open: boolean): Promise<void> => ipcRenderer.invoke("iab:set-open", open),

  /**
   * Report where the placeholder element is, in CSS pixels relative to the window.
   *
   * `null` means "there is no hole any more" — the pane closed, the window became too narrow to
   * split, or the component unmounted. Main hides the view rather than leaving it at the last
   * rectangle it was told about, which would otherwise sit on top of the conversation.
   */
  setBounds: (rect: BridgeRect | null): Promise<void> => ipcRenderer.invoke("iab:set-bounds", rect),

  /** Hide the view while something in the DOM covers its area, then show it again. */
  setOccluded: (occluded: boolean): Promise<void> =>
    ipcRenderer.invoke("iab:set-occluded", occluded),

  /** Current state, for a renderer that has just mounted. */
  getState: (): Promise<BridgePaneState> => ipcRenderer.invoke("iab:get-state"),

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
};

export type TravelAgentBrowserBridge = typeof api;

contextBridge.exposeInMainWorld("travelAgentBrowser", api);
