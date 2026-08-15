/**
 * The in-app browser pane: one `WebContentsView` living inside the app window.
 *
 * This is the piece that makes the workspace real rather than a picture of one. The view is
 * Chromium rendering an actual page — the user can click it, type into it with their own input
 * method, and the agent drives the same pixels over CDP. Nothing is mirrored, screenshotted or
 * proxied.
 *
 * Phase 1 is deliberately **one** view. Tab strips, restore and ownership belong to Phase 2, and
 * building their state machine before the single-view path works end to end would be guessing.
 *
 * Two constraints shape the API:
 *
 * 1. **Layout lives in the main process.** A `WebContentsView` is not in the DOM, so the renderer
 *    cannot place it with CSS. It measures a placeholder and reports the rectangle; the arithmetic
 *    and clipping happen in `browser-pane-layout.ts`, which is pure and tested.
 * 2. **The view renders above the DOM.** Nothing in HTML can paint over it, so a modal in the
 *    renderer has to ask for the view to be hidden. That is what `setOccluded` is for.
 */
import { WebContentsView } from "electron";
import type { BrowserWindow, WebContents } from "electron";
import { computePaneLayout, layoutChanged } from "./browser-pane-layout.js";
import type { PaneLayout, PaneMeasurement } from "./browser-pane-layout.js";
import { iabWebPreferences } from "./session-partition.js";

/** Where a new pane starts when the agent has not navigated it yet. */
const BLANK_URL = "about:blank";

/** What the renderer needs to draw its chrome: the state of the one view. */
export interface PaneState {
  /** Whether a view exists at all. */
  present: boolean;
  visible: boolean;
  url: string;
  title: string;
  loading: boolean;
  /**
   * Whether the pane should be showing.
   *
   * Main owns this, and the renderer follows it. Either side can *ask* for the pane — the user by
   * clicking the toggle, the agent by opening a tab — but only one of them decides, so there is no
   * loop: the renderer never sets `open` from its own state, it renders whatever arrives here and
   * reports the resulting rectangle back.
   */
  requested: boolean;
}

export interface BrowserPaneOptions {
  window: BrowserWindow;
  /** Called whenever state the renderer cares about changes. */
  onState: (state: PaneState) => void;
  log?: (message: string) => void;
}

export class BrowserPane {
  private view: WebContentsView | null = null;
  private measurement: PaneMeasurement | null = null;
  private requested = false;
  private occluded = false;
  private lastLayout: PaneLayout | null = null;
  /** Notified when a view is created, so the transport can attach its debugger. */
  private onViewCreated: ((contents: WebContents) => void) | null = null;

  constructor(private readonly options: BrowserPaneOptions) {
    // The window can change size without the renderer re-measuring (a maximise, a display change),
    // so recompute from the last measurement rather than waiting to be told.
    options.window.on("resize", () => this.applyLayout());
  }

  /** Registers the transport's attach hook. Called once during wiring. */
  setViewCreatedHandler(handler: (contents: WebContents) => void): void {
    this.onViewCreated = handler;
    if (this.view) handler(this.view.webContents);
  }

  /** Every live view, for the transport to (re)attach after a reconnect. */
  liveContents(): WebContents[] {
    const contents = this.view?.webContents;
    return contents && !contents.isDestroyed() ? [contents] : [];
  }

  private log(message: string): void {
    this.options.log?.(`[pane] ${message}\n`);
  }

  /**
   * Creates the view if it does not exist yet.
   *
   * Called both by the renderer opening the pane and by the agent asking for a tab, because either
   * can come first: a task may start before the user has ever opened the panel.
   */
  ensureView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;

    const view = new WebContentsView({ webPreferences: iabWebPreferences() });
    this.view = view;
    // A new view has no bounds yet, so the previous view's layout must not be treated as already
    // applied — otherwise an identical rectangle is skipped as "unchanged" and the fresh view is
    // never positioned or shown.
    this.lastLayout = null;
    this.options.window.contentView.addChildView(view);

    const contents = view.webContents;

    // A booking flow opens results in new windows constantly. Phase 1 has one view, so a popup
    // navigates it rather than spawning something the pane cannot show. Crucially it never reaches
    // the system browser, which would take the user out of the workspace mid-task.
    contents.setWindowOpenHandler(({ url }) => {
      if (isNavigableUrl(url)) void contents.loadURL(url);
      return { action: "deny" };
    });

    contents.on("will-navigate", (event, url) => {
      if (!isNavigableUrl(url)) {
        this.log(`blocked navigation to ${url}`);
        event.preventDefault();
      }
    });

    const publish = (): void => this.publishState();
    contents.on("did-start-loading", publish);
    contents.on("did-stop-loading", publish);
    contents.on("did-navigate", publish);
    contents.on("did-navigate-in-page", publish);
    contents.on("page-title-updated", publish);
    contents.on("did-fail-load", publish);
    contents.on("destroyed", () => {
      if (this.view?.webContents === contents) {
        this.view = null;
        this.lastLayout = null;
      }
      this.publishState();
    });

    void contents.loadURL(BLANK_URL);
    this.onViewCreated?.(contents);
    this.applyLayout();
    this.log("created the in-app browser view");
    return view;
  }

  /**
   * Creates a view for the agent and returns its CDP target id.
   *
   * The target id is the contract with the relay: Playwright identifies pages by it, and the
   * executor waits for the matching page to appear. Reading it requires the debugger, which the
   * transport attaches through `setViewCreatedHandler` before this resolves.
   */
  async openTabForAgent(url?: string): Promise<string> {
    // Only `undefined` means "leave it blank". A URL that was supplied and cannot be navigated is
    // an error the caller must see: silently ignoring it would return a target id for a page that
    // is not where the agent believes it is, and every later assertion would be about the wrong
    // document.
    if (url !== undefined && !isNavigableUrl(url)) {
      throw new Error(
        `The in-app browser will not navigate to ${url}: only http and https are allowed`,
      );
    }

    const view = this.ensureView();
    // Show the pane before navigating: the agent is about to do something, and the user should be
    // watching it rather than discovering it later.
    this.requestForAgent();
    const contents = view.webContents;
    if (url !== undefined) await contents.loadURL(url);

    const info = (await contents.debugger.sendCommand("Target.getTargetInfo")) as {
      targetInfo?: { targetId?: string };
    };
    const targetId = info?.targetInfo?.targetId;
    if (!targetId) throw new Error("Could not read the in-app browser view's target id");
    return targetId;
  }

  /** The renderer's measurement of the hole it left for the pane. */
  setMeasurement(measurement: PaneMeasurement | null): void {
    this.measurement = measurement;
    this.applyLayout();
  }

  /**
   * Opens the pane because the agent needs it.
   *
   * An agent that starts driving a browser the user cannot see is the failure this prevents: the
   * whole point of the workspace is that the work is visible. Called from the view-creation path so
   * it covers both `tabs.open()` and a navigation into a lazily created view.
   */
  private requestForAgent(): void {
    if (this.requested) return;
    this.requested = true;
    this.log("opened the pane because the agent asked for a tab");
    this.applyLayout();
    this.publishState();
  }

  /** The renderer's intent: is the pane open? Opening creates the view lazily. */
  setRequested(requested: boolean): void {
    this.requested = requested;
    if (requested) this.ensureView();
    this.applyLayout();
    this.publishState();
  }

  /** Something in the DOM needs to cover the pane area; hide the view until it is gone. */
  setOccluded(occluded: boolean): void {
    this.occluded = occluded;
    this.applyLayout();
  }

  private applyLayout(): void {
    const view = this.view;
    if (!view || view.webContents.isDestroyed()) return;

    const [width = 0, height = 0] = this.options.window.getContentSize();
    const layout = computePaneLayout({
      measurement: this.measurement,
      content: { width, height },
      requested: this.requested,
      occluded: this.occluded,
    });
    if (!layoutChanged(this.lastLayout, layout)) return;
    this.lastLayout = layout;

    view.setVisible(layout.visible);
    if (layout.visible) view.setBounds(layout.bounds);
    this.publishState();
  }

  private publishState(): void {
    const contents = this.view?.webContents;
    const present = Boolean(contents && !contents.isDestroyed());
    this.options.onState({
      present,
      visible: present ? (this.lastLayout?.visible ?? false) : false,
      url: present ? contents!.getURL() : "",
      title: present ? contents!.getTitle() : "",
      loading: present ? contents!.isLoading() : false,
      requested: this.requested,
    });
  }

  /** Current state, for a renderer that just connected and needs to catch up. */
  state(): PaneState {
    const contents = this.view?.webContents;
    const present = Boolean(contents && !contents.isDestroyed());
    return {
      present,
      visible: present ? (this.lastLayout?.visible ?? false) : false,
      url: present ? contents!.getURL() : "",
      title: present ? contents!.getTitle() : "",
      loading: present ? contents!.isLoading() : false,
      requested: this.requested,
    };
  }

  destroy(): void {
    const view = this.view;
    this.view = null;
    this.lastLayout = null;
    if (!view) return;
    try {
      this.options.window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    } catch {
      // The window may already be tearing down; nothing left to clean up.
    }
  }
}

/**
 * Whether the pane may navigate to a URL.
 *
 * An allowlist rather than a blocklist: `file:` would read the user's disk, and custom schemes can
 * reach other applications. Only the two schemes a web page legitimately uses get through.
 */
export function isNavigableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
