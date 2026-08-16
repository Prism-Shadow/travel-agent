/**
 * The in-app browser pane: a set of `WebContentsView`s living inside the app window.
 *
 * This is the piece that makes the workspace real rather than a picture of one. Each view is
 * Chromium rendering an actual page — the user can click it, type into it with their own input
 * method, and the agent drives the same pixels over CDP. Nothing is mirrored, screenshotted or
 * proxied.
 *
 * Three constraints shape the API:
 *
 * 1. **Layout lives in the main process.** A `WebContentsView` is not in the DOM, so the renderer
 *    cannot place it with CSS. It measures a placeholder and reports the rectangle; the arithmetic
 *    and clipping happen in `browser-pane-layout.ts`, which is pure and tested.
 * 2. **The view renders above the DOM.** Nothing in HTML can paint over it, so a modal in the
 *    renderer has to ask for the view to be hidden. That is what `setOccluded` is for.
 * 3. **Only one view is on screen at a time.** The other tabs stay alive and keep their pages, but
 *    they are positioned nowhere and hidden — a tab strip is a stack of views, not of windows.
 *
 * ## Three identities, none of them interchangeable
 *
 * A conversation (a harness *Session*) contains many *Tasks* — one per turn the agent runs. Both
 * appear here, and they answer different questions:
 *
 *   - `sessionScope` (required, never cleared) — **which conversation's tab strip shows this tab.**
 *     A tab whose scope is not the conversation on screen is not shown, full stop. It is never
 *     dropped, because a tab that appears in no strip is a tab the user cannot close.
 *   - `ownedByTask` (nullable) — **which task's agent may write to this tab.** Dropped when the
 *     task ends and the tab is retained; the tab survives, visible in the same strip as before,
 *     now the user's.
 *
 * `tabRegistry` in the relay is the third, orthogonal one: it stops two concurrent agent sessions
 * from writing to the same page. Nothing here touches it. Design/002 §6.4 is explicit that these
 * layers must not be merged, and each of the three answers a question the others cannot.
 */
import { WebContentsView } from "electron";
import type { BrowserWindow, WebContents } from "electron";
import { computePaneLayout, layoutChanged } from "./browser-pane-layout.js";
import type { PaneLayout, PaneMeasurement } from "./browser-pane-layout.js";
import {
  clearIabSession,
  iabWebPreferences,
  setDownloadDirectoryResolver,
} from "./session-partition.js";
import type { DownloadTarget } from "./session-partition.js";
import {
  TabCheckpointStore,
  buildCheckpoint,
  mergeCheckpoints,
  pendingRestoreCount,
  planCrashRecovery,
  planTaskEnd,
} from "./tab-lifecycle.js";
import type { RenderProcessGoneReason, TabCheckpoint, TaskOutcome } from "./tab-lifecycle.js";
import { reconcileTasks } from "./task-supervisor.js";
import type { SessionTaskState } from "./task-supervisor.js";

/** Where a new tab starts when nobody has navigated it yet. */
const BLANK_URL = "about:blank";

/** Off-screen and hidden: what every tab that is not the active one gets. */
const HIDDEN_LAYOUT: PaneLayout = { bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false };

/**
 * How long to wait before writing the checkpoint after something changes.
 *
 * Navigation events arrive in bursts — a redirect chain is half a dozen — and each one changes a
 * URL worth recording. Coalescing them keeps a page load from becoming a page load plus six writes.
 */
const CHECKPOINT_DEBOUNCE_MS = 500;

/**
 * Attempts at reading a new view's CDP target id, and the gaps between them.
 *
 * The first attempt normally succeeds: the transport attaches the debugger synchronously from the
 * view-created hook, before this runs. The ladder covers the case where it does not — the socket is
 * still connecting, so no attach happened yet — because a tab with no target id is a tab no agent
 * can address, and failing silently would leave that invisible until a command mysteriously missed.
 */
const TARGET_ID_RETRY_DELAYS_MS = [0, 100, 300, 800];

/** How many undelivered task-outcome declarations are kept. Far above any real backlog. */
const MAX_DECLARED_OUTCOMES = 64;

/**
 * The `TabFailure.code` for a view that could not be built.
 *
 * Chromium's own network errors are negative, and this has to be distinguishable from all of them:
 * nothing was ever loaded, so retrying means building the view again rather than reloading a page.
 */
const REBUILD_FAILED_CODE = -1000;

/** How many not-yet-known conversations stay in the supervisor's query; see `noteInterest`. */
const MAX_ASKED_ABOUT = 32;

/** How many finished task ids are remembered, so a stale process cannot reuse one. */
const MAX_ENDED_TASKS = 256;

/** How many conversations' download directories are remembered. */
const MAX_DOWNLOAD_DIRS = 200;

/** Which browser is driving this conversation (002 §6.1). */
export type PaneBackend = "iab" | "extension";

/** Why a page is not showing what the user asked for. */
export interface TabFailure {
  /** Chromium's network error code, e.g. -105 for NAME_NOT_RESOLVED. */
  code: number;
  description: string;
  url: string;
}

/** One tab, as the renderer draws it. */
export interface PaneTabState {
  /** Ours, stable for the life of the tab — survives a crash rebuild, which mints a new target id. */
  id: string;
  /** CDP target id, the handle the relay and `tabRegistry` know this page by. Null until attached. */
  targetId: string | null;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The task allowed to write here, or null for a tab the user owns. */
  ownedByTask: string | null;
  /** The user asked to keep this tab past the end of its task. */
  retain: boolean;
  failed: TabFailure | null;
}

/**
 * What the renderer needs to draw the pane.
 *
 * Design/002 §6.3 also lists `control: ControlMode`. That is the control-handover state machine
 * (§6.5), which is Phase 3's subject and has no producer here; adding the field now with a constant
 * value would be a promise the code does not keep. `backend` is included because it is real in this
 * phase — the user picks it, and it decides which browser the next session gets.
 */
export interface PaneState {
  /** Whether there is a tab to show in the current scope. */
  present: boolean;
  /** Whether the active view is actually painting. */
  visible: boolean;
  /**
   * Whether the pane should be showing.
   *
   * Main owns this, and the renderer follows it. Either side can *ask* for the pane — the user by
   * clicking the toggle, the agent by opening a tab — but only one of them decides, so there is no
   * loop: the renderer never sets `open` from its own state, it renders whatever arrives here and
   * reports the resulting rectangle back.
   */
  requested: boolean;
  /** The tabs of the conversation on screen, in strip order. */
  tabs: PaneTabState[];
  activeTabId: string | null;
  /** The conversation those tabs belong to, echoed back so the renderer can detect a stale frame. */
  sessionScope: string | null;
  /** The browser this conversation's next agent session will use. */
  backend: PaneBackend;
  /** Whether that choice is currently held shut by a running task (002 §7.3: no mid-task switch). */
  backendLocked: boolean;
  /** Whether the Chrome extension backend is reachable at all this run (see the option of the same name). */
  extensionBackendAvailable: boolean;
  /** Whether clearing the browser data is held shut by a task running in *any* conversation. */
  profileResetLocked: boolean;
  /** Pages left behind by a run that did not shut down cleanly, awaiting the user's decision. */
  restorable: number;
}

/**
 * What is known about a tab at the moment the user closes it.
 *
 * A plain record rather than the `WebContents`: the view is destroyed immediately afterwards, and a
 * handle to a dead object is no use to whoever needs to explain the closure later.
 */
export interface ClosedTabNotice {
  tabId: string;
  targetId: string | null;
  sessionScope: string;
  ownedByTask: string | null;
}

export interface BrowserPaneOptions {
  window: BrowserWindow;
  /** Called whenever state the renderer cares about changes. */
  onState: (state: PaneState) => void;
  /** Where the tab checkpoint is kept. Omitted in tests that do not exercise restore. */
  checkpointPath?: string;
  /**
   * The user closed a tab an agent was using.
   *
   * Wired to the transport so the agent's next call gets a structured "that tab is gone" rather
   * than a bare CDP failure. The pane cannot produce that error itself: by the time the agent's
   * command arrives the view no longer exists, and only the transport knows which CDP session it
   * belonged to.
   */
  onTabClosedByUser?: (notice: ClosedTabNotice) => void;
  /**
   * Asks the supervisor to reconcile with the server now, resolving when it has.
   *
   * Used on the one path where a race is real: an agent's first command in a turn can arrive before
   * the poll that would have learned the turn started.
   */
  refreshTaskState?: () => Promise<void>;
  /**
   * The server's own answer for which Agent a conversation belongs to.
   *
   * Arrives with the task state, so the shell never has to take the renderer's word for the
   * relationship when it places that Session's downloads in its scratchpad.
   */
  onSessionResolved?: (ids: { sessionId: string; projectId: string; agentId: string }) => void;
  /**
   * The user picked a different browser backend for a conversation.
   *
   * Persisted outside the pane because the reader is a different process: the CLI consults it when
   * the agent asks for an in-app browser session. Kept as a callback so this module stays free of
   * the CLI's file format.
   */
  onBackendChange?: (sessionId: string, backend: PaneBackend) => void;
  /** Backends chosen previously, by conversation. Anything absent defaults to the in-app browser. */
  initialBackends?: Record<string, PaneBackend>;
  /**
   * Whether the Chrome extension backend can be reached at all in this run.
   *
   * False when the shell had to bind an ephemeral relay port because something else already owned
   * the conventional one. The extension's port is fixed at build time, so it connects to that other
   * relay — and every command this app runs resolves *this* one. Offering the choice anyway would
   * produce a conversation whose sessions cannot be created at all.
   */
  extensionBackendAvailable?: boolean;
  /**
   * Tells the relay something its own registries need to know.
   *
   * Three notifications, all of them keeping the two ownership layers in step: a tab was opened for
   * a task (claim it), a tab was closed (forget it), a task ended (release its claims). Optional so
   * a test can build a pane without a relay.
   */
  onNotifyRelay?: (method: string, params: Record<string, unknown>) => void;
  log?: (message: string) => void;
}

interface Tab {
  id: string;
  /**
   * The Chromium side, or **null when this tab has none**.
   *
   * Null is a real state, not a transient one: a crash whose rebuild failed leaves a tab in the
   * strip with its URL and a retryable failure, and nothing behind it. Modelling that as "a view
   * object that reports itself destroyed" was wrong twice over — a `WebContents` that has been
   * detached from the window does not necessarily say it is destroyed, and every caller then has to
   * remember to ask. Nullable makes the compiler ask instead.
   */
  view: WebContentsView | null;
  targetId: string | null;
  /** The conversation whose strip shows this tab. Required, and never cleared. */
  sessionScope: string;
  /** The task whose agent may write here. Null once the task has ended or the user opened it. */
  ownedByTask: string | null;
  /**
   * The relay session holding this tab's concurrency claim, as the relay knows it.
   *
   * Carried so the shell can *tell* the relay who owns what, rather than the relay having to infer
   * it from a task id — a task can create more than one browser session, and guessing which one
   * would claim the tab under the wrong owner. Announced with every target on every reconnect,
   * which is what makes the two registries converge after a dropped message.
   */
  relaySession: string | null;
  retain: boolean;
  failed: TabFailure | null;
  /**
   * We are destroying this view ourselves.
   *
   * Read by the crash handler: a `render-process-gone` that arrives during our own teardown is not
   * a crash, and rebuilding there would resurrect the tab the user just closed. Nothing else may
   * suppress a rebuild — `killed` in particular is what an OOM killer reports, and that is a crash.
   */
  closing: boolean;
  /** Last URL worth restoring. Kept separately because a dead view answers `getURL()` with "". */
  lastUrl: string;
  lastLayout: PaneLayout | null;
  dispose: () => void;
}

/** Waits without holding the process open, so a pending retry never delays quit. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class BrowserPane {
  private readonly tabs = new Map<string, Tab>();
  private nextTabOrdinal = 1;
  private measurement: PaneMeasurement | null = null;
  private requested = false;
  private occluded = false;
  /** The conversation the renderer is showing. Null means no conversation is open. */
  private activeSession: string | null = null;
  /** Backend per conversation. Two chats can legitimately want different browsers (002 §6.1). */
  private readonly backendBySession = new Map<string, PaneBackend>();
  /**
   * The turns the **server** says are running, by task id, mapped to their conversation.
   *
   * Applied only by `applyTaskState`, from the main-process supervisor's poll — never from the
   * renderer, which has no way to name a task at all. This is the authority for two different
   * things: which turn may open or drive a tab, and whether the backend switch is held shut
   * (changing browsers discards the page state a running turn is built on, so it is a decision
   * taken between turns and never during one — 002 §7.3).
   */
  private readonly runningTasks = new Map<string, string>();
  /** Outcomes the agent has declared, awaiting the authoritative end-of-task boundary. */
  private readonly declaredOutcomes = new Map<string, TaskOutcome>();
  /**
   * Tasks that have ended.
   *
   * **Not the authority** — `runningTasks` is, and this only chooses which refusal a caller gets.
   * An id that has fallen out of this bounded set, or that predates a rebuilt pane, is still
   * refused; it simply gets the generic "no record of this turn running" rather than the specific
   * "that turn is over".
   */
  private readonly endedTasks = new Set<string>();
  private readonly askedAbout = new Set<string>();
  private readonly extensionBackendAvailable: boolean;
  /** Download directory per conversation, resolved by main from its own data root. */
  private readonly downloadDirs = new Map<string, DownloadTarget>();
  /** Remembered selection, keyed by the tab's own session scope — never by the viewed one. */
  private readonly activeByScope = new Map<string, string>();
  /** The live checkpoint: what is open right now, rewritten as tabs change. */
  private readonly checkpoints: TabCheckpointStore | null;
  /**
   * The crash snapshot: what a previous run left behind, waiting for the user's answer.
   *
   * A second file, and that separation is the point. The live checkpoint is overwritten constantly —
   * the first tab opened after launch would erase the very pages the prompt is offering — and it is
   * cleared on a clean shutdown, which would silently discard an unanswered prompt. This one is
   * written once, at startup, and removed only when the user answers.
   */
  private readonly pendingCheckpoints: TabCheckpointStore | null;
  private restorable = 0;
  /** The crash snapshot for this run, held in memory so a failed copy still offers its pages. */
  private pendingCheckpoint: TabCheckpoint | null = null;
  /**
   * Live checkpointing is off because the crash snapshot could not be copied aside.
   *
   * Writing would overwrite the crashed run's file, which is at that moment the only copy of those
   * pages. Lifted once the user answers the prompt, which is when that file stops mattering.
   */
  private liveCheckpointsSuspended = false;
  private checkpointTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private readonly onWindowResize: () => void;
  /** Notified when a view is created, so the transport can attach its debugger. */
  private onViewCreated: ((contents: WebContents) => void) | null = null;

  constructor(private readonly options: BrowserPaneOptions) {
    // The window can change size without the renderer re-measuring (a maximise, a display change),
    // so recompute from the last measurement rather than waiting to be told. Held as a field so
    // `destroy` can take it off again: the window outlives the pane on macOS, and a listener left
    // behind would keep a destroyed pane's layout running on every resize.
    this.onWindowResize = () => this.applyLayout();
    options.window.on("resize", this.onWindowResize);
    this.extensionBackendAvailable = options.extensionBackendAvailable ?? true;
    // A download belongs to the conversation whose tab started it, and lands in that Session's own
    // scratchpad (design/002 §5.2). The session cannot work either out on its own — it is shared by
    // every tab — so the tab model answers, and main supplies the directory it resolved.
    setDownloadDirectoryResolver((contents: WebContents) => {
      const scope = this.tabForContents(contents)?.sessionScope;
      return scope ? (this.downloadDirs.get(scope) ?? null) : null;
    });
    for (const [sessionId, backend] of Object.entries(options.initialBackends ?? {})) {
      // A stored choice for a backend that cannot be reached this run is not honoured. The
      // conversation falls back to the in-app browser rather than being unable to start a session
      // at all, and the menu says why the other option is unavailable.
      if (backend === "extension" && !this.extensionBackendAvailable) continue;
      this.backendBySession.set(sessionId, backend);
    }

    this.checkpoints = options.checkpointPath
      ? new TabCheckpointStore(options.checkpointPath)
      : null;
    this.pendingCheckpoints = options.checkpointPath
      ? new TabCheckpointStore(`${options.checkpointPath}.pending`)
      : null;
    this.restorable = pendingRestoreCount(this.promoteCrashedCheckpoint());
  }

  /** Registers the transport's attach hook. Called once during wiring. */
  setViewCreatedHandler(handler: (contents: WebContents) => void): void {
    this.onViewCreated = handler;
    for (const tab of this.tabs.values()) {
      const contents = this.contentsOf(tab);
      if (!contents) continue;
      // One tab at a time: a transport that cannot attach to *this* view — it is going away, its
      // debugger refuses — must not stop the remaining tabs from being attached at all. Each is an
      // independent handshake, and the retry lives in the transport.
      try {
        handler(contents);
      } catch (error) {
        this.log(`could not attach to ${tab.id}: ${(error as Error).message}`);
      }
    }
  }

  /** Every live view, for the transport to (re)attach after a reconnect. */
  liveContents(): WebContents[] {
    const live: WebContents[] = [];
    for (const tab of this.tabs.values()) {
      const contents = this.contentsOf(tab);
      if (contents) live.push(contents);
    }
    return live;
  }

  /**
   * The view a browser-scoped command should land on.
   *
   * The transport routes per-target commands by session id; this answers the ones that carry no
   * usable session — those should reach the page the user is looking at, not whichever tab happens
   * to be first in the map.
   */
  activeContents(): WebContents | null {
    const tab = this.activeTab();
    return tab ? this.contentsOf(tab) : null;
  }

  /**
   * Says what happened, and can never be the reason something else fails.
   *
   * The logger is injected — a stream that can be closed, a sink somebody else wrote — and several
   * of its callers run inside Chromium event listeners where a throw is an uncaught exception in
   * the main process. Losing a line of diagnostics is not worth the app going down, and a `log`
   * that can throw quietly undoes every "this path never throws" guarantee that depends on it.
   */
  private log(message: string): void {
    try {
      this.options.log?.(`[pane] ${message}\n`);
    } catch {
      // Nothing to report it to: the thing that reports is what failed.
    }
  }

  /**
   * Tells the relay something, and never lets that failure become the caller's.
   *
   * Two of these run inside Chromium event listeners — a tab destroyed from outside, a renderer
   * that died — where an exception is an uncaught exception in the main process. The relay is a
   * socket that may be reconnecting or gone, and the announcements it misses are restated on the
   * next reconnect by design, so a lost one costs nothing.
   */
  private notifyRelay(method: string, params: Record<string, unknown>): void {
    try {
      this.options.onNotifyRelay?.(method, params);
    } catch (error) {
      this.log(`could not tell the relay about ${method}: ${(error as Error).message}`);
    }
  }

  /**
   * The `WebContents` behind a tab, if there is one that can still be driven.
   *
   * One predicate for a question with two ways of being false: a tab whose view was never built (or
   * whose rebuild failed) has no view at all, and a tab whose renderer died has one that reports
   * itself destroyed. Asking only the second question — as every call site used to — treats the
   * first as a live view and dereferences nothing.
   */
  private contentsOf(tab: Tab): WebContents | null {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed()) return null;
    return contents;
  }

  // --- tab creation ---------------------------------------------------------

  /**
   * Creates a tab for the agent and returns its CDP target id.
   *
   * Both identities are required and neither is inferred. `sessionId` decides which conversation
   * sees the tab and must be the harness session the agent is running under — taking "whatever the
   * user is looking at" instead would put a background task's pages into a stranger's strip.
   * `taskId` decides who may write to it; without one the tab would be owned by nobody and the
   * end-of-task rules would never apply to it, so a missing one is an error rather than a null.
   *
   * Every call mints a genuinely new view. Phase 1 answered with the single view it had, which made
   * `tabs.open()` idempotent by accident; an agent that opens a results page and a detail page now
   * gets two tabs, as it asked for and as `tabRegistry` assumes.
   */
  async openTabForAgent(options: {
    url?: string;
    sessionId: string;
    taskId: string;
    /** The relay session asking, so the relay's own registry can be told exactly who holds it. */
    relaySessionId?: string;
  }): Promise<string> {
    const { url } = options;
    const sessionId = requireIdentity(options.sessionId, "sessionId");
    const taskId = requireIdentity(options.taskId, "taskId");
    await this.requireTaskLive(sessionId, taskId);

    // The work has to be visible. Phase 1's guarantee was that an agent cannot drive a browser the
    // user has not got open; with per-conversation strips, "open" is not enough — a tab created for
    // conversation A while the user is reading conversation B appears in no strip at all, and the
    // agent would be working somewhere nobody can see or close.
    //
    // Refused rather than resolved by switching the user's view: yanking someone into another
    // conversation because a background task started browsing is a worse answer than telling the
    // agent it cannot start. A task already working keeps its tabs when the user navigates away —
    // they are still in that conversation's strip, and going back shows them — but *starting*
    // hidden is the thing that must not happen.
    if (this.activeSession !== sessionId) {
      throw new Error(
        `IAB_SESSION_NOT_VISIBLE: the in-app browser will not open a tab for a conversation the ` +
          `user is not looking at (asked for ${sessionId}, showing ` +
          `${this.activeSession ?? "no conversation"}). Ask the user to open this conversation.`,
      );
    }

    // Only `undefined` means "leave it blank". A URL that was supplied and cannot be navigated is
    // an error the caller must see: silently ignoring it would return a target id for a page that
    // is not where the agent believes it is, and every later assertion would be about the wrong
    // document.
    if (url !== undefined && !isNavigableUrl(url)) {
      throw new Error(
        `The in-app browser will not navigate to ${url}: only http and https are allowed`,
      );
    }

    const tab = this.createTab({
      url,
      sessionScope: sessionId,
      ownedByTask: taskId,
      relaySession: options.relaySessionId ?? null,
    });

    // Show the pane before the caller gets its id: the agent is about to do something, and the user
    // should be watching it rather than discovering it later.
    this.requestForAgent();

    const targetId = await this.ensureTargetId(tab);
    if (!targetId) {
      // Rolls back **this tab only**. The turn is still running — the server said so, and this
      // failure is about a view whose debugger never answered — so ending it here would revoke a
      // live task's authority and turn the retry the error asks for into `IAB_TASK_NOT_LIVE`.
      this.destroyTab(tab);
      this.publishState();
      throw new Error(
        `The in-app browser could not read a CDP target id for ${tab.id}. The view was created but ` +
          "no debugger attached to it, so an agent cannot drive it; the tab has been discarded.",
      );
    }
    return targetId;
  }

  /**
   * Creates a tab because the user asked for one (the ⊕ button, Cmd+T).
   *
   * Scoped to the conversation on screen, and refused when there is none: a tab with no session
   * scope could not be shown in any strip.
   */
  openTabForUser(url?: string): string {
    const sessionScope = this.requireActiveSession();
    const tab = this.createTab({
      url: url !== undefined && isNavigableUrl(url) ? url : undefined,
      sessionScope,
      ownedByTask: null,
    });
    this.requestForAgent();
    return tab.id;
  }

  private createTab(options: {
    url?: string;
    sessionScope: string;
    ownedByTask: string | null;
    relaySession?: string | null;
    id?: string;
    retain?: boolean;
    /** False only for a restore, which rebuilds a whole strip and sets the selection itself. */
    activate?: boolean;
    /** An adopted popup: Chromium navigates it, so this must not load anything into it. */
    adopted?: boolean;
  }): Tab {
    const id = options.id ?? `tab-${this.nextTabOrdinal++}`;
    const tab: Tab = {
      id,
      view: null,
      targetId: null,
      sessionScope: options.sessionScope,
      ownedByTask: options.ownedByTask,
      relaySession: options.relaySession ?? null,
      retain: options.retain ?? false,
      failed: null,
      closing: false,
      lastUrl: options.url ?? "",
      lastLayout: null,
      dispose: () => {},
    };
    this.tabs.set(id, tab);
    try {
      this.buildView(tab, options.url, options.adopted === true);
    } catch (error) {
      // A view that could not be built leaves a tab with no Chromium side behind it — in the strip,
      // in the checkpoint, and fatal to anything that later reaches for its `webContents`. The one
      // place that registered it is the one place that can take it back out.
      this.tabs.delete(id);
      throw error;
    }
    // Keyed by the tab's own scope, not the viewed one. A background task opening a tab must not
    // change which tab the user is looking at in a different conversation.
    if (options.activate !== false) this.activeByScope.set(tab.sessionScope, id);
    this.applyLayout();
    this.publishState();
    this.scheduleCheckpoint();
    this.log(`opened ${id} in session ${tab.sessionScope}`);
    return tab;
  }

  /**
   * Builds (or rebuilds) the `WebContentsView` behind a tab.
   *
   * Separate from `createTab` because crash recovery reuses it: the tab keeps its id, its position
   * in the strip and its ownership, and only the Chromium side is replaced.
   */
  private buildView(tab: Tab, url?: string, adopted = false): void {
    // **All or nothing.** Every step below can fail on a real machine — no GPU process, an
    // exhausted handle table, a window torn down underneath — and a half-built view is worse than
    // none: a `WebContentsView` that was constructed and attached but never adopted by a tab is a
    // native child of the window that nothing will ever position, hide or destroy. So the new view
    // is only *committed* to the tab once it is whole, and a failure leaves the tab exactly as it
    // was, with the view it could not use already taken apart.
    const previousView = tab.view;
    const previousDispose = tab.dispose;
    const view = new WebContentsView({ webPreferences: iabWebPreferences() });
    let attached = false;
    let detachListeners: (() => void) | null = null;
    try {
      this.options.window.contentView.addChildView(view);
      attached = true;

      const contents = view.webContents;

      // A booking flow opens results in new windows constantly (`target=_blank` on every result
      // link, and `window.open()` then `location =` on many search forms). Those become tabs of ours
      // rather than windows — and, crucially, never reach the system browser, which would take the
      // user out of the workspace mid-task.
      //
      // `createWindow` is what makes that faithful rather than approximate. Electron calls it instead
      // of constructing a `BrowserWindow` and adopts whatever `WebContents` it returns as the real
      // child, so the popup keeps everything a re-navigation would have lost: its opener
      // relationship, `window.name`, the referrer, and a form POST's body. Returning a view we built
      // ourselves is how the child ends up inside the pane with the same isolation as every other
      // tab — the alternative, denying the popup and loading its URL into a fresh view, silently
      // breaks the `window.open()`-then-assign flow because the opener's handle points at nothing.
      contents.setWindowOpenHandler((details) => {
        const target = details.url;
        // `about:blank` is legitimate here — it is the first half of the open-then-assign flow — so
        // the check is for schemes we refuse to render, not for a URL being present.
        if (target && target !== BLANK_URL && !isNavigableUrl(target)) {
          this.log(`refused a popup to ${target}`);
          return { action: "deny" };
        }
        // A view that cannot be built is a popup that does not open — never an exception out of
        // this handler. Chromium calls it while it is deciding what to do with `window.open`, so a
        // throw here is an uncaught exception in the main process, and the page that asked for a
        // second tab would take the whole app with it.
        //
        // Built here rather than inside `createWindow` because that callback has no way to say no:
        // Chromium expects a `WebContents` back and there is nothing safe to return instead. The
        // trade is that a handler answering "allow" whose `createWindow` Chromium then never calls
        // would leave a blank tab in the strip — a tab the user can close, against a crash they
        // cannot do anything about.
        let opened: Tab;
        try {
          opened = this.createTab({
            sessionScope: tab.sessionScope,
            ownedByTask: tab.ownedByTask,
            // Same relay session as the page that opened it, so the concurrency claim lands on the
            // session already driving this flow rather than being guessed from the task.
            relaySession: tab.relaySession,
            // Chromium drives the child's first navigation itself. Loading anything here would race
            // it, and would be the very re-navigation this path exists to avoid.
            adopted: true,
          });
        } catch (error) {
          this.log(`could not adopt a popup to ${target}: ${(error as Error).message}`);
          return { action: "deny" };
        }
        return {
          action: "allow",
          // Built above, so this only hands Chromium the view it already has: the tab exists by
          // now, and a failure has already become a refusal rather than an exception.
          createWindow: () => opened.view!.webContents,
        };
      });

      contents.on("will-navigate", (event, target) => {
        if (!isNavigableUrl(target)) {
          this.log(`blocked navigation to ${target}`);
          event.preventDefault();
        }
      });

      const publish = (): void => {
        const current = contents.isDestroyed() ? "" : contents.getURL();
        if (isNavigableUrl(current)) tab.lastUrl = current;
        this.publishState();
        this.scheduleCheckpoint();
      };
      contents.on("did-start-loading", () => {
        // A new attempt clears the previous failure: the error strip must not outlive the error.
        tab.failed = null;
        publish();
      });
      contents.on("did-stop-loading", publish);
      contents.on("did-navigate", publish);
      contents.on("did-navigate-in-page", publish);
      contents.on("page-title-updated", publish);

      const onFailLoad = (
        _event: unknown,
        code: number,
        description: string,
        validatedUrl: string,
        isMainFrame: boolean,
      ): void => {
        // Subframes fail constantly on ad-heavy pages and say nothing about whether the user got
        // their page. `-3` is ERR_ABORTED, which is what a navigation the user or the site replaced
        // reports — neither is a failure worth showing.
        if (!isMainFrame || code === -3) return;
        tab.failed = { code, description, url: validatedUrl };
        this.log(`${tab.id} failed to load ${validatedUrl}: ${description} (${code})`);
        this.publishState();
      };
      contents.on("did-fail-load", onFailLoad);

      const onRenderGone = (_event: unknown, details: { reason: string }): void => {
        this.recoverFromCrash(tab, details.reason as RenderProcessGoneReason);
      };
      contents.on("render-process-gone", onRenderGone);

      const onDestroyed = (): void => {
        // Only meaningful if this view is still the tab's: a rebuild destroys the old one on the way
        // past, and that must not remove the tab that now has a live replacement.
        if (tab.view?.webContents !== contents) return;
        // A view can go away without us closing it — the page called `window.close()`, or something
        // destroyed the WebContents — and everything a close normally does still has to happen.
        // Handling it as "delete from the map and publish" left the relay holding a claim on a dead
        // target, a selection pointing at a tab that is gone, and a checkpoint describing pages that
        // no longer exist.
        this.forgetTab(tab);
      };
      contents.on("destroyed", onDestroyed);

      detachListeners = () => {
        try {
          contents.off("did-fail-load", onFailLoad);
          contents.off("render-process-gone", onRenderGone);
          contents.off("destroyed", onDestroyed);
        } catch {
          // A destroyed WebContents rejects listener removal; the listeners died with it.
        }
      };
      tab.dispose = detachListeners;

      // The commit. Everything above can be undone; from here the tab owns this view.
      tab.view = view;
      // A new view has no bounds yet, so the previous view's layout must not be treated as already
      // applied — otherwise an identical rectangle is skipped as "unchanged" and the fresh view is
      // never positioned or shown.
      tab.lastLayout = null;
      tab.targetId = null;
      tab.closing = false;
      tab.failed = null;

      // The debugger has to be attached before the target id can be read, and both have to happen
      // for *every* view — a popup and a crash rebuild are as much an agent's working surface as
      // the tab it asked for. Attach first, then read, so the handshake is the same on all four
      // paths.
      this.onViewCreated?.(contents);
      // An adopted popup is navigated by Chromium as part of the `window.open` it came from,
      // carrying its own POST body, referrer and opener. Anything loaded here would race that.
      if (!adopted) {
        void contents.loadURL(url ?? BLANK_URL).catch((error: unknown) => {
          // A rejected load is an ordinary outcome — an unreachable host, a redirect to a scheme
          // `will-navigate` refuses — and `did-fail-load` has already recorded what the user sees.
          // An unhandled rejection here would be an Electron-level crash for a page that merely
          // failed.
          this.log(`${tab.id} could not load ${url ?? BLANK_URL}: ${String(error)}`);
        });
      }
      void this.ensureTargetId(tab);
    } catch (error) {
      tab.view = previousView;
      tab.dispose = previousDispose;
      detachListeners?.();
      this.discardView(view, attached);
      throw error;
    }
  }

  /**
   * Takes apart a view the tab never accepted.
   *
   * Detaching comes first: a `WebContentsView` left in `contentView` after its `WebContents` is
   * closed is a child of the window with nothing behind it. Both steps are best-effort, because
   * this runs on a path where something has already gone wrong and throwing here would replace a
   * failed tab with a failed process.
   */
  private discardView(view: WebContentsView, attached: boolean): void {
    try {
      if (attached) this.options.window.contentView.removeChildView(view);
    } catch {
      // The window may be tearing down; the view goes with it.
    }
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    } catch {
      // Already gone.
    }
  }

  /**
   * Asks the view for its CDP target id, caching the answer.
   *
   * Retried, because the debugger may not be attached on the first pass: the transport attaches
   * from the hook above, but only once its socket is up. A tab with no target id is a tab no agent
   * can address, so this keeps asking for a few hundred milliseconds rather than leaving that to be
   * discovered later as a command that missed.
   */
  private async ensureTargetId(tab: Tab): Promise<string | null> {
    if (tab.targetId) return tab.targetId;
    const view = tab.view;

    for (const wait of TARGET_ID_RETRY_DELAYS_MS) {
      if (wait > 0) await delay(wait);
      // Everything can have moved on during the wait: the pane may be gone, the tab closed, or the
      // view replaced by a crash rebuild that is running its own handshake.
      if (this.disposed || this.tabs.get(tab.id) !== tab || tab.view !== view) return null;
      if (tab.targetId) return tab.targetId;
      const contents = this.contentsOf(tab);
      if (!contents) return null;

      try {
        const info = (await contents.debugger.sendCommand("Target.getTargetInfo")) as {
          targetInfo?: { targetId?: string };
        };
        const targetId = info?.targetInfo?.targetId;
        if (targetId) {
          tab.targetId = targetId;
          this.publishState();
          return targetId;
        }
      } catch {
        // Almost always "debugger is not attached"; the next pass is the answer.
      }
    }

    this.log(`no CDP target id for ${tab.id} after ${TARGET_ID_RETRY_DELAYS_MS.length} attempts`);
    return null;
  }

  // --- crash recovery -------------------------------------------------------

  /**
   * One tab's renderer died.
   *
   * Rebuilds that tab and nothing else. The window's own `render-process-gone` handler reloads the
   * whole application; an IAB view must never reach it, and it cannot — `main.ts` registers that on
   * the window's `webContents`, and these are separate ones.
   */
  private recoverFromCrash(tab: Tab, reason: RenderProcessGoneReason): void {
    const plan = planCrashRecovery({ reason, lastUrl: tab.lastUrl, deliberate: tab.closing });
    if (!plan.rebuild) return;
    if (this.disposed || this.tabs.get(tab.id) !== tab) return;

    this.log(`${tab.id} lost its renderer (${reason}); rebuilding it`);
    // The replacement gets a new CDP target id, so the old one's claim would sit in the relay's
    // registry forever, held by a session for a page that no longer exists. Dropped before the
    // rebuild, and the new view announces its own ownership when it attaches.
    if (tab.targetId) this.notifyRelay("iab-tab-closed", { targetId: tab.targetId });
    // Forgotten here rather than in the rebuild: if the rebuild fails, a stale id would still match
    // this tab in `contentsFor`, handing a command a page that no longer exists.
    tab.targetId = null;
    const dead = tab.view;
    // Listeners first, then the view: `destroyed` on the old contents would otherwise delete the
    // tab that is about to get a working replacement.
    tab.dispose();
    // And the tab has no view from this point. Not "a view that reports itself destroyed" — a
    // detached `WebContents` does not always say so — so the model says it plainly, and a rebuild
    // that fails leaves it that way rather than leaving a driveable handle to a page nobody can see.
    tab.view = null;
    if (dead) this.discardView(dead, true);
    // **Never throws.** This runs inside Chromium's `render-process-gone` listener, so an exception
    // escaping it is an uncaught exception in the main process: the app would go down because one
    // tab could not be rebuilt, which is precisely the failure crash recovery exists to avoid. A
    // rebuild that fails leaves the tab in the strip, still holding its URL, with a failure the
    // user can retry — `reload` on a dead view builds the view again.
    try {
      this.buildView(tab, plan.url);
    } catch (error) {
      tab.failed = {
        code: REBUILD_FAILED_CODE,
        description: (error as Error).message,
        url: plan.url ?? tab.lastUrl,
      };
      this.log(`${tab.id} could not be rebuilt: ${(error as Error).message}`);
    }
    this.applyLayout();
    this.publishState();
    // The checkpoint still describes this tab and its URL, so the page survives a restart even if
    // this run never manages to rebuild it.
    this.scheduleCheckpoint();
  }

  // --- tab operations (renderer-facing: scoped) -----------------------------

  /**
   * Resolves a tab id the renderer sent.
   *
   * Scoped deliberately. Tab ids are sequential and therefore guessable, and every operation below
   * is destructive or navigational; a renderer bug — or a compromised one — must not be able to
   * close a tab belonging to a conversation that is not even on screen. Agent-driven work does not
   * come through here: it arrives over CDP, addressed by target id, and is gated by ownership.
   */
  private requireVisibleTab(tabId: string): Tab {
    const tab = this.tabs.get(tabId);
    if (!tab || !this.inScope(tab)) {
      throw new Error(`No such tab in the current conversation: ${tabId}`);
    }
    return tab;
  }

  private requireActiveSession(): string {
    if (this.activeSession === null) {
      throw new Error("The in-app browser has no conversation selected, so it has no tab strip");
    }
    return this.activeSession;
  }

  /** Brings a tab to the front of its strip. */
  selectTab(tabId: string): void {
    const tab = this.requireVisibleTab(tabId);
    this.activeByScope.set(tab.sessionScope, tab.id);
    this.applyLayout();
    this.publishState();
    this.scheduleCheckpoint();
  }

  /**
   * Closes a tab the user is looking at.
   *
   * A tab the user closed out from under a working agent has to produce a structured error on that
   * agent's next write, rather than a bare CDP failure it cannot act on (002 §6.4 四). The agent
   * replans; nothing reopens the tab behind the user's back.
   */
  closeTab(tabId: string): void {
    const tab = this.requireVisibleTab(tabId);
    if (tab.ownedByTask) {
      this.options.onTabClosedByUser?.({
        tabId: tab.id,
        targetId: tab.targetId,
        sessionScope: tab.sessionScope,
        ownedByTask: tab.ownedByTask,
      });
    }
    this.destroyTab(tab);
  }

  /** The user's "keep this page" mark. Outranks every automatic cleanup rule. */
  setRetain(tabId: string, retain: boolean): void {
    const tab = this.requireVisibleTab(tabId);
    tab.retain = retain;
    this.publishState();
    this.scheduleCheckpoint();
  }

  /** Sends a tab to a URL. Used by the address bar; the agent navigates over CDP instead. */
  async navigate(tabId: string, url: string): Promise<void> {
    const tab = this.requireVisibleTab(tabId);
    if (!isNavigableUrl(url)) {
      throw new Error(
        `The in-app browser will not navigate to ${url}: only http and https allowed`,
      );
    }
    // A tab whose view could not be rebuilt after a crash still has an address bar. Typing a URL
    // into it is a retry with a destination, so the view is built pointing there rather than the
    // call failing on a `WebContents` that is not there.
    const contents = this.contentsOf(tab);
    if (!contents) {
      if (!this.rebuildMissingView(tab, url)) {
        throw new Error(
          `IAB_REBUILD_FAILED: ${tab.failed?.description ?? "the view could not be built"}`,
        );
      }
      return;
    }
    tab.failed = null;
    await contents.loadURL(url);
  }

  /** Back / forward / reload / stop, for the navigation controls and their shortcuts. */
  goBack(tabId: string): void {
    const contents = this.liveContentsFor(tabId);
    if (contents?.navigationHistory?.canGoBack()) contents.navigationHistory.goBack();
  }

  goForward(tabId: string): void {
    const contents = this.liveContentsFor(tabId);
    if (contents?.navigationHistory?.canGoForward()) contents.navigationHistory.goForward();
  }

  reload(tabId: string): void {
    const tab = this.requireVisibleTab(tabId);
    const contents = this.contentsOf(tab);
    // No view is the crash-rebuild case: there is nothing to reload, and the retry the user is
    // asking for is the rebuild itself. Doing nothing here is what made a failed rebuild permanent.
    if (!contents) {
      this.rebuildMissingView(tab);
      return;
    }
    tab.failed = null;
    contents.reload();
  }

  /**
   * Builds a view for a tab that has none, as the retry behind a failed crash rebuild.
   *
   * Reports a second failure the same way as the first rather than throwing: the button the user
   * just pressed is the one they will press again, and it has to keep meaning the same thing.
   *
   * The remembered URL is updated only when the build **succeeds**. A retry that fails must leave
   * the tab pointing at the page it lost, because that is what the strip shows and what the
   * checkpoint would restore.
   */
  private rebuildMissingView(tab: Tab, url?: string): boolean {
    const target = url ?? tab.lastUrl ?? "";
    try {
      this.buildView(tab, target || BLANK_URL);
      if (url) tab.lastUrl = url;
      this.log(`${tab.id} rebuilt on request`);
    } catch (error) {
      tab.failed = {
        code: REBUILD_FAILED_CODE,
        description: (error as Error).message,
        url: tab.lastUrl,
      };
      this.log(`${tab.id} could not be rebuilt on request: ${(error as Error).message}`);
      this.applyLayout();
      this.publishState();
      return false;
    }
    this.applyLayout();
    this.publishState();
    this.scheduleCheckpoint();
    return true;
  }

  stop(tabId: string): void {
    this.liveContentsFor(tabId)?.stop();
  }

  private liveContentsFor(tabId: string): WebContents | null {
    return this.contentsOf(this.requireVisibleTab(tabId));
  }

  /** Destroys a tab's view and forgets it. The path taken when *we* close a tab. */
  private destroyTab(tab: Tab): void {
    const contents = tab.view?.webContents ?? null;
    // Marked before anything is destroyed: the teardown below can raise `render-process-gone`, and
    // the crash handler has to be able to tell that apart from a real crash.
    tab.closing = true;
    // Listeners first, so the `destroyed` this provokes does not re-enter through the observed path
    // while we are still here. `forgetTab` is idempotent either way.
    tab.dispose();
    if (contents && !contents.isDestroyed()) {
      try {
        contents.close();
      } catch {
        // The window may already be tearing down.
      }
    }
    this.forgetTab(tab);
  }

  /**
   * Drops a tab from the model and cleans up everything that referred to it.
   *
   * Shared by the close we perform and the destruction we merely observe — a page calling
   * `window.close()`, a `WebContents` destroyed from outside. Idempotent, because both can happen
   * for the same tab: our own close destroys the view, which raises `destroyed`.
   */
  private forgetTab(tab: Tab): void {
    if (!this.tabs.delete(tab.id)) return;

    // The native side too, and on *both* paths. A view whose WebContents was destroyed from outside
    // — a page calling `window.close()`, a renderer taken down — leaves its `WebContentsView` in the
    // window's child list, and one accumulates per closed page for the life of the window.
    tab.dispose();
    if (tab.view) {
      try {
        this.options.window.contentView.removeChildView(tab.view);
      } catch {
        // Already detached, or the window is tearing down.
      }
    }

    // That target id will never be seen again, so the relay must forget its claim rather than hold
    // it against a page that no longer exists.
    if (tab.targetId) this.notifyRelay("iab-tab-closed", { targetId: tab.targetId });

    // Whoever was pointing at this tab needs somewhere else to look.
    for (const [scope, activeId] of this.activeByScope) {
      if (activeId === tab.id) this.activeByScope.delete(scope);
    }
    this.applyLayout();
    this.publishState();
    this.scheduleCheckpoint();
    this.log(`closed ${tab.id}`);
  }

  // --- session and task lifecycle -------------------------------------------

  /** Which conversation the renderer is showing. */
  setActiveSession(sessionId: string | null): void {
    if (this.activeSession === sessionId) return;
    this.activeSession = sessionId;
    this.applyLayout();
    this.publishState();
  }

  /** Which browser the next agent session should use (002 §6.1). A task-level decision. */
  setBackend(backend: PaneBackend): void {
    const sessionId = this.requireActiveSession();
    if (this.backendFor(sessionId) === backend) return;
    // Refused, not merely discouraged in the UI. Switching browsers changes whose login an order is
    // placed under and throws away the page state the running task is built on, so it happens
    // between tasks (002 §6.1, §7.3) — and a check that lives only in the renderer is one a stale
    // frame, or a second window, walks straight past.
    if (this.hasRunningTask(sessionId)) {
      throw new Error(
        "This conversation has a task running. The browser it uses is chosen between tasks, not " +
          "during one: switching now would discard the pages the task is working in.",
      );
    }
    if (backend === "extension" && !this.extensionBackendAvailable) {
      throw new Error(
        "The Chrome extension backend cannot be reached in this run: another program already owns " +
          "the relay port the extension connects to, so this app is running its own relay on a " +
          "different one. Close the other program and restart the app to use your own Chrome.",
      );
    }
    this.backendBySession.set(sessionId, backend);
    this.options.onBackendChange?.(sessionId, backend);
    this.publishState();
    this.log(`backend for ${sessionId} set to ${backend}`);
  }

  private backendFor(sessionId: string | null): PaneBackend {
    return (sessionId && this.backendBySession.get(sessionId)) || "iab";
  }

  private hasRunningTask(sessionId: string): boolean {
    for (const scope of this.runningTasks.values()) {
      if (scope === sessionId) return true;
    }
    return false;
  }

  /**
   * Refuses anything but a task the harness says is running right now.
   *
   * **Positive authority, not absence of a tombstone.** An earlier version refused ids it had seen
   * end, which is a different and much weaker claim: the record was bounded, so a few hundred tasks
   * later an id fell out of it and became acceptable again — and a pane rebuilt with its window
   * started with an empty record, so every expired id was acceptable from the first frame. A
   * background command the Agent started keeps a genuine `PENGUIN_TASK_ID` for as long as it runs,
   * which is exactly the thing this has to stop.
   *
   * So the question is "is this turn live", answered by the harness's own `task_state`, and the
   * tombstone only chooses which of two refusals to give. The pair also has to match: a task id is
   * not a licence to act in a conversation it does not belong to.
   */
  private async requireTaskLive(sessionId: string, taskId: string): Promise<void> {
    if (this.runningTasks.get(taskId) === sessionId) return;
    // An agent's first command can outrun the supervisor's poll, and a turn that has only just
    // started is a legitimate caller. One bounded refresh turns that race into a wait rather than an
    // error the agent has to read as "probably just early". A turn already known to have ended is
    // refused without asking: nothing a refresh could return would change it.
    if (!this.endedTasks.has(taskId)) {
      // The refresh has to *ask about this conversation*. Interest is otherwise derived from tabs
      // and known-running tasks, and the first tab of a turn in a conversation the user is not
      // looking at has neither — so the poll would come back knowing nothing about it and the turn
      // would be refused as not-live while the server had it running.
      this.noteInterest(sessionId);
      await this.options.refreshTaskState?.();
    }
    this.assertTaskLive(sessionId, taskId);
  }

  private assertTaskLive(sessionId: string, taskId: string): void {
    if (this.runningTasks.get(taskId) === sessionId) return;
    if (this.endedTasks.has(taskId)) {
      throw new Error(
        `IAB_TASK_ENDED: task ${taskId} has finished, and its pages belong to the user now. A ` +
          "command left over from a finished turn cannot open or claim tabs under its name.",
      );
    }
    throw new Error(
      `IAB_TASK_NOT_LIVE: the in-app browser has no record of task ${taskId} running in ` +
        `conversation ${sessionId}. If the turn has only just started, retry in a moment; ` +
        "otherwise this command has outlived the turn that started it.",
    );
  }

  private noteTaskEnded(taskId: string): void {
    this.endedTasks.add(taskId);
    while (this.endedTasks.size > MAX_ENDED_TASKS) {
      const oldest = this.endedTasks.values().next().value;
      if (oldest === undefined) break;
      this.endedTasks.delete(oldest);
    }
  }

  applyTaskState(states: readonly SessionTaskState[]): void {
    const { live, ended } = reconcileTasks(this.runningTasks, states);

    for (const { sessionId, taskId } of live) {
      // A turn this pane has already ended never comes back. The answer can be stale — a poll that
      // went out before the turn finished lands after it — and a task id is minted once and never
      // reused, so "running" about an id we have seen end is always the older fact. Believing it
      // would hand a finished turn its pages back, including the ones already released to the user,
      // which is precisely the authority a leftover background command is reaching for.
      if (this.endedTasks.has(taskId)) continue;
      if (this.runningTasks.get(taskId) !== sessionId) {
        this.runningTasks.set(taskId, sessionId);
        this.log(`task ${taskId} confirmed running in ${sessionId}`);
      }
    }
    // The Session's own scratchpad, from the server rather than from the renderer: the shell must
    // not take anyone's word for which Agent a conversation belongs to.
    for (const state of states) {
      if (state.projectId && state.agentId) {
        this.options.onSessionResolved?.({
          sessionId: state.sessionId,
          projectId: state.projectId,
          agentId: state.agentId,
        });
      }
    }
    for (const { taskId, failed } of ended) this.endTask(taskId, { abnormal: failed });

    if (live.length > 0) this.publishState();
  }

  /**
   * Where a conversation's downloads go, as resolved by main from the server's own answer.
   *
   * Remembered per conversation and kept: a tab in one conversation can download while the user
   * reads another, and the file belongs to the Session that fetched it rather than to whatever is
   * on screen. Bounded, because a long-lived window sees many conversations.
   */
  setSessionDownloadDir(sessionId: string, target: DownloadTarget): void {
    if (!sessionId || !target.directory || !target.root) return;
    const existing = this.downloadDirs.get(sessionId);
    if (existing?.directory === target.directory && existing.root === target.root) return;
    this.downloadDirs.delete(sessionId);
    this.downloadDirs.set(sessionId, { ...target });
    while (this.downloadDirs.size > MAX_DOWNLOAD_DIRS) {
      const oldest = this.downloadDirs.keys().next().value;
      if (oldest === undefined) break;
      this.downloadDirs.delete(oldest);
    }
  }

  /** Conversations the supervisor should be asking about: anything this pane holds state for. */
  sessionsOfInterest(): string[] {
    const sessions = new Set<string>();
    for (const tab of this.tabs.values()) sessions.add(tab.sessionScope);
    for (const sessionId of this.runningTasks.values()) sessions.add(sessionId);
    for (const sessionId of this.askedAbout) sessions.add(sessionId);
    if (this.activeSession) sessions.add(this.activeSession);
    return [...sessions];
  }

  /**
   * Conversations somebody has asked about that the pane holds nothing for yet.
   *
   * Bounded and never explicitly cleared: an entry costs one id in the next poll's query string,
   * and dropping one early is what would bring back the false refusal it exists to prevent.
   */
  private noteInterest(sessionId: string): void {
    if (!sessionId || this.askedAbout.has(sessionId)) return;
    this.askedAbout.add(sessionId);
    while (this.askedAbout.size > MAX_ASKED_ABOUT) {
      const oldest = this.askedAbout.values().next().value;
      if (oldest === undefined) break;
      this.askedAbout.delete(oldest);
    }
  }

  /**
   * A task finished; apply the four end-of-task rules (002 §6.4 一).
   *
   * Retained tabs lose their owner and stay in the strip — same session scope as before, now the
   * user's to close. Closed ones go. Tabs belonging to other tasks are not considered at all.
   */
  endTask(taskId: string, ending: { abnormal: boolean } = { abnormal: false }): void {
    const outcome = this.resolveOutcome(taskId, ending.abnormal);
    this.declaredOutcomes.delete(taskId);
    const plan = planTaskEnd([...this.tabs.values()], taskId, outcome);
    for (const id of plan.retain) {
      const tab = this.tabs.get(id);
      // Ownership only. The session scope stays: the tab keeps appearing in the conversation it was
      // opened for, which is the one place the user would go looking for it. The relay session goes
      // with the ownership, because the concurrency claim is what a later task has to be able to
      // take — the pair is what the reconciliation below reports as "nobody holds this".
      if (tab) {
        tab.ownedByTask = null;
        tab.relaySession = null;
      }
    }
    for (const id of plan.close) {
      const tab = this.tabs.get(id);
      // Not a user close: the task ending is why these are going, and the agent that owned them is
      // the one that ended — there is nobody left to hand a structured error to.
      if (tab) this.destroyTab(tab);
    }
    if (plan.retain.length > 0) this.scheduleCheckpoint();

    // Authority goes *before* the last publish, and that publish is unconditional.
    //
    // The closes above and the retain branch each published on their way past, and every one of
    // them ran while this task was still in `runningTasks` — so the last state the renderer received
    // said the backend was locked and the profile could not be cleared, and nothing published again
    // until some unrelated change came along. The locks stayed on screen for a task that had ended.
    this.runningTasks.delete(taskId);
    this.noteTaskEnded(taskId);
    this.publishState();
    // Both layers move together. Ownership here is already gone, which stops any write; this drops
    // the relay's concurrency claim, without which the retained tab would be permanently
    // unclaimable — refused here because it is unowned, and refused there because a finished
    // session still holds it.
    this.notifyRelay("iab-task-ended", { taskId, outcome });
    this.log(
      `task ${taskId} ended (${outcome}): closed ${plan.close.length}, retained ${plan.retain.length}`,
    );
  }

  /**
   * Records how the agent says its task went — **without acting on it**.
   *
   * The agent declares this when it closes its browser session, which is *before* the turn is
   * actually over: the model can still abort, or the run can throw, after the browser work looks
   * finished. Acting here would let a declared `read_only` destroy the tabs of a task that then
   * failed, which is exactly the case the retain rules exist for. So the declaration is kept and
   * applied at the one authoritative boundary — the harness's own `task_state` idle — where an
   * abnormal ending can still override it.
   *
   * An unrecognised value is discarded rather than rejected: the ending is real either way, and
   * falling back to the conservative rule beats refusing the message and leaving the tabs owned by
   * a task that has definitely finished.
   */
  declareTaskOutcome(taskId: string, outcome: string): void {
    const known: readonly TaskOutcome[] = ["read_only", "committed", "failed", "unknown"];
    if (!(known as readonly string[]).includes(outcome)) return;
    // Merged conservatively, never replaced. One task can open and close several browser sessions —
    // a search in one, a booking in another — and each closes with its own account. Letting the
    // last one win means a `read_only` from the search session erases the `committed` from the
    // booking session, and the payment page it left behind is closed. So `read_only` only survives
    // if every declaration was `read_only`; anything else is already a retain and stays one.
    const previous = this.declaredOutcomes.get(taskId);
    const merged: TaskOutcome =
      previous === undefined
        ? (outcome as TaskOutcome)
        : previous === "read_only"
          ? (outcome as TaskOutcome)
          : outcome === "read_only"
            ? previous
            : (outcome as TaskOutcome);
    this.declaredOutcomes.set(taskId, merged);
    // Bounded: a long-lived window can see many tasks, and a declaration whose task never ends is
    // a leak of a few bytes each. The oldest are dropped, which costs only the conservative
    // fallback for a task nobody is waiting on any more.
    while (this.declaredOutcomes.size > MAX_DECLARED_OUTCOMES) {
      const oldest = this.declaredOutcomes.keys().next().value;
      if (oldest === undefined) break;
      this.declaredOutcomes.delete(oldest);
    }
    this.log(`task ${taskId} declared outcome ${outcome} (effective: ${merged})`);
  }

  /**
   * The outcome the end-of-task rules actually run with.
   *
   * An abnormal ending wins over anything the agent said. A task that declared "just a search" and
   * then aborted did not have a clean read-only run — the pages it left are the evidence of what
   * went wrong, and closing them is the one irreversible thing this code can do.
   */
  private resolveOutcome(taskId: string, abnormal: boolean): TaskOutcome {
    if (abnormal) return "failed";
    return this.declaredOutcomes.get(taskId) ?? "unknown";
  }

  /**
   * Answers the crash prompt.
   *
   * Restored tabs come back **unowned**. The run that owned them is gone, so there is no live task
   * to hand them to, and an agent that wants one has to claim it the ordinary way — which is also
   * what puts it back through `tabRegistry`. Their session scope is restored, because that is what
   * decides where the user finds them again.
   */
  restore(accept: boolean): void {
    // Memory first: a snapshot that could not be written to disk is still the user's pages.
    const checkpoint = this.pendingCheckpoint ?? this.pendingCheckpoints?.read() ?? null;

    if (!accept || !checkpoint) {
      this.discardPendingRestore();
      this.publishState();
      return;
    }

    // **Rebuild before forgetting.** The offer is the only copy of a crashed run's pages, and
    // creating a WebContentsView can fail — no GPU process, an exhausted handle table, a window
    // torn down underneath. Clearing first and then failing threw the pages away permanently, with
    // nothing left to retry from: the user answered "yes" and lost the lot. So the snapshot stays
    // exactly where it is until every view exists, and a failure leaves the prompt standing.
    const restored: Tab[] = [];
    try {
      for (const entry of checkpoint.tabs) {
        // A checkpoint entry with no session scope predates one, or was edited; it has no strip to
        // go back to, so it is dropped rather than shown somewhere arbitrary.
        if (entry.taskScope === null) continue;
        const tab = this.createTab({
          url: entry.url,
          sessionScope: entry.taskScope,
          ownedByTask: null,
          retain: entry.retain,
          activate: false,
        });
        restored.push(tab);
        if (entry.active) this.activeByScope.set(tab.sessionScope, tab.id);
      }
    } catch (error) {
      // All-or-preserve: the half-built strip goes, so a retry does not double the tabs, and the
      // offer survives for that retry.
      for (const tab of restored) this.destroyTab(tab);
      this.applyLayout();
      this.publishState();
      this.log(`could not restore the previous run's tabs: ${(error as Error).message}`);
      throw new Error(
        `IAB_RESTORE_FAILED: the previous run's pages could not be reopened (${
          (error as Error).message
        }). They have been kept, so this can be tried again.`,
      );
    }

    // Cleared here and nowhere else: this is the only moment the user has said what should happen
    // to those pages, and by now they are back on screen.
    this.discardPendingRestore();
    this.requestForAgent();
    this.applyLayout();
    this.publishState();
    this.log(`restored ${checkpoint.tabs.length} tabs from the previous run`);
  }

  /**
   * Drops the crash offer: the snapshot, the crashed run's own file, and the suspension.
   *
   * Promotion leaves the crashed file in place when the copy fails, so it is cleared here too, and
   * the live checkpoint resumes being written because there is nothing left to protect.
   */
  private discardPendingRestore(): void {
    this.pendingCheckpoints?.clear();
    if (this.liveCheckpointsSuspended) {
      this.checkpoints?.clear();
      this.liveCheckpointsSuspended = false;
    }
    this.pendingCheckpoint = null;
    this.restorable = 0;
  }

  /**
   * Clears the pane's cookies, cache and credentials, and closes every tab that was using them.
   *
   * Refused while **any** task is running, not just one in this conversation: the profile is shared
   * by every conversation's tabs, so a reset takes down work the user cannot see from here. Closing
   * one tab is a deliberate act on a page in front of you; this is not the same thing, and a
   * running booking losing its session mid-checkout is the failure it prevents.
   */
  async clearProfile(): Promise<void> {
    if (this.runningTasks.size > 0) {
      throw new Error(
        "A task is running. Clearing the browser data signs out every conversation's tabs and " +
          "closes them, so it waits until nothing is working in the browser.",
      );
    }
    // **Clear first, then close.** The other order loses the user their tabs and, if any of the
    // three clears fails, leaves them still signed in — the worst of both. This way a failure
    // propagates with every tab still open and the profile untouched, and the caller can say so.
    await clearIabSession();
    for (const tab of [...this.tabs.values()]) this.destroyTab(tab);
    this.log("cleared the in-app browser profile");
  }

  /**
   * What to hand to the user's own browser when a task moves there (002 §7.2).
   *
   * **Not browser state.** Migrating cookies crosses a security boundary and is the most
   * recognisable anti-fraud signal there is: the same session suddenly arriving with a different
   * fingerprint. What transfers is the deep link and the structured work product.
   */
  handoff(): BackendHandoff | null {
    const tab = this.activeTab();
    if (!tab) return null;
    const contents = this.contentsOf(tab);
    const url = contents ? contents.getURL() : tab.lastUrl;
    if (!isNavigableUrl(url)) return null;
    return { url, sessionScope: tab.sessionScope };
  }

  // --- layout and state -----------------------------------------------------

  /** The renderer's measurement of the hole it left for the pane. */
  setMeasurement(measurement: PaneMeasurement | null): void {
    this.measurement = measurement;
    this.applyLayout();
  }

  /**
   * Opens the pane because the agent needs it.
   *
   * An agent that starts driving a browser the user cannot see is the failure this prevents: the
   * whole point of the workspace is that the work is visible.
   */
  private requestForAgent(): void {
    if (this.requested) return;
    this.requested = true;
    this.log("opened the pane because a tab was created");
    this.applyLayout();
    this.publishState();
  }

  /** The renderer's intent: is the pane open? */
  setRequested(requested: boolean): void {
    this.requested = requested;
    this.applyLayout();
    this.publishState();
  }

  /** Something in the DOM needs to cover the pane area; hide the view until it is gone. */
  setOccluded(occluded: boolean): void {
    this.occluded = occluded;
    this.applyLayout();
  }

  /**
   * Whether a task may drive a given view.
   *
   * The enforcement point for tab ownership, and the reason `ownedByTask` is not merely something
   * the tab strip draws. A retained tab stays **alive** on purpose — it holds a booking the user
   * wants to look at — so there is no destroyed view to fail against, and nothing except this check
   * stops the executor that opened it from carrying on writing after its task ended.
   *
   * Three outcomes, and the caller turns the refusals into errors the agent can act on:
   *   - the tab is this task's — allowed;
   *   - the tab has no owner — it was retained or the user opened it, and it is the user's now;
   *   - the tab belongs to another task — a session was reused across turns.
   */
  mayDrive(contents: WebContents, taskId: string | undefined): DriveDecision {
    const tab = this.tabForContents(contents);
    if (!tab) return { allowed: false, reason: "gone" };
    // A secret phase revokes the agent's channel to one target while the person types a code into
    // it (003 §7.3): the check is here so it covers every route the agent could drive by, not just
    // the one the fill uses.
    if (tab.targetId && this.secretPhaseTargets.has(tab.targetId)) {
      return { allowed: false, reason: "released", tabId: tab.id };
    }
    if (tab.ownedByTask === null) {
      return { allowed: false, reason: "released", tabId: tab.id };
    }
    if (!taskId || tab.ownedByTask !== taskId) {
      return { allowed: false, reason: "foreign", tabId: tab.id, owner: tab.ownedByTask };
    }
    return { allowed: true };
  }

  /**
   * Targets whose agent channel is currently revoked for a secret phase.
   *
   * Held by target id rather than by tab, because the vault side speaks in target ids and a tab's
   * view can be rebuilt (crash recovery) under the same id. Cleared on exit; also cleared when the
   * tab goes, since a gone target drives nothing.
   */
  private readonly secretPhaseTargets = new Set<string>();

  /** The live contents for a CDP target id, for the vault's fill port (see pane-target-resolver). */
  contentsForTarget(targetId: string): WebContents | null {
    for (const tab of this.tabs.values()) {
      if (tab.targetId !== targetId) continue;
      return this.contentsOf(tab);
    }
    return null;
  }

  /** Closes the tab that owns a target (secret-phase exit c). No-op if it is already gone. */
  async closeTarget(targetId: string): Promise<void> {
    for (const tab of this.tabs.values()) {
      if (tab.targetId !== targetId) continue;
      this.secretPhaseTargets.delete(targetId);
      this.destroyTab(tab);
      return;
    }
  }

  /**
   * Turns the agent's ability to drive a target off (secret-phase enter) or on (exit).
   *
   * Returns whether the target is live: the vault's detach must fail closed on a target that has
   * gone rather than believe it revoked a channel that no longer exists (003 §7.3).
   */
  setAgentDrivable(input: { targetId: string; drivable: boolean }): boolean {
    if (this.contentsForTarget(input.targetId) === null) return false;
    if (input.drivable) this.secretPhaseTargets.delete(input.targetId);
    else this.secretPhaseTargets.add(input.targetId);
    return true;
  }

  /**
   * Takes ownership of an unowned tab for a task.
   *
   * The counterpart to a release: after a task ends, its tabs are the user's, and a later task that
   * genuinely wants one has to ask. Refused for a tab that is still owned (no stealing), and for
   * one belonging to another conversation (it is not even on that agent's strip).
   */
  claimTab(
    targetId: string,
    identity: { sessionId: string; taskId: string; relaySessionId?: string },
  ): ClaimResult {
    // Same rule as opening, and the same reason: a command left over from a finished turn still
    // carries a genuine id, so the question is whether the turn is live rather than whether the id
    // is one we happen to remember ending.
    if (this.runningTasks.get(identity.taskId) !== identity.sessionId) {
      return {
        claimed: false,
        reason: this.endedTasks.has(identity.taskId) ? "task-ended" : "task-not-live",
      };
    }
    for (const tab of this.tabs.values()) {
      if (tab.targetId !== targetId) continue;
      if (tab.sessionScope !== identity.sessionId) {
        return { claimed: false, reason: "other-conversation" };
      }
      if (tab.ownedByTask !== null && tab.ownedByTask !== identity.taskId) {
        return { claimed: false, reason: "owned" };
      }
      tab.ownedByTask = identity.taskId;
      if (identity.relaySessionId) tab.relaySession = identity.relaySessionId;
      // Told immediately, not left to the next reconnect. The relay's registry has to learn who
      // holds this page now: without it, a task that ends before any reconnect leaves a claim the
      // release cannot find, and the tab stays unclaimable by anyone.
      this.notifyRelay("iab-ownership-changed", {
        targetId,
        ...this.ownershipFor(tab),
      });
      this.publishState();
      this.log(`${tab.id} claimed by task ${identity.taskId}`);
      return { claimed: true, tabId: tab.id };
    }
    return { claimed: false, reason: "gone" };
  }

  /**
   * A live view the given task owns, preferring the one it is looking at.
   *
   * Answers the "where does an untargeted command go" question for a task, which is not the same as
   * "what is on screen": the user can select a retained tab, or another conversation's, while a
   * task keeps working in its own pages.
   */
  taskContents(taskId: string | undefined): WebContents | null {
    if (!taskId) return null;
    const owned = [...this.tabs.values()].filter(
      (tab) => tab.ownedByTask === taskId && this.contentsOf(tab) !== null,
    );
    if (owned.length === 0) return null;
    const active = this.activeTab();
    const preferred = active && owned.includes(active) ? active : owned[owned.length - 1];
    return preferred ? this.contentsOf(preferred) : null;
  }

  /**
   * Who owns a view's tab, for the relay's registry.
   *
   * Announced alongside every target, on first attach and on every reconnect. That is what makes
   * the two registries converge without a durable message log: the shell is the authority on
   * ownership, and it restates the whole truth every time the connection is rebuilt, so a
   * notification lost while the socket was down costs nothing.
   */
  ownershipOf(contents: WebContents): TabOwnership | null {
    const tab = this.tabForContents(contents);
    if (!tab) return null;
    return this.ownershipFor(tab);
  }

  /**
   * The full ownership record for a tab, including its conversation.
   *
   * The conversation is reported for *every* tab, owned or not — that is what lets the relay keep
   * one conversation's pages out of another's Playwright client. A released tab still belongs to the
   * conversation it was opened in; it simply has no task and no relay session.
   */
  private ownershipFor(tab: Tab): TabOwnership {
    return {
      sessionScope: tab.sessionScope,
      taskId: tab.ownedByTask,
      relaySessionId: tab.relaySession,
    };
  }

  private tabForContents(contents: WebContents): Tab | null {
    for (const tab of this.tabs.values()) {
      if (tab.view?.webContents === contents) return tab;
    }
    return null;
  }

  /**
   * Whether the browser's keyboard shortcuts apply right now.
   *
   * All three conditions are about the same thing: Cmd+W must close a *tab* only when there is a
   * visible tab strip to close it from. With the pane shut it is the window's shortcut; with a
   * modal over the pane the user is interacting with the dialog, not the browser; with no
   * conversation selected there is no strip at all. Anywhere else, claiming the key would take it
   * from whatever the user was actually using.
   */
  acceptsShortcuts(): boolean {
    return this.requested && !this.occluded && this.activeSession !== null;
  }

  /**
   * Whether a tab appears in the strip the renderer is currently showing.
   *
   * Exact match, and nothing else qualifies. An unset conversation shows *no* tabs rather than all
   * of them: "we have not been told which conversation this is" is not a reason to reveal another
   * conversation's pages, and an unowned tab is not a public one — it still belongs to the strip it
   * was opened in.
   */
  private inScope(tab: Tab): boolean {
    return this.activeSession !== null && tab.sessionScope === this.activeSession;
  }

  private visibleTabs(): Tab[] {
    return [...this.tabs.values()].filter((tab) => this.inScope(tab));
  }

  /** The tab on screen: the remembered one when it is still here, otherwise the newest in scope. */
  private activeTab(): Tab | null {
    const visible = this.visibleTabs();
    if (visible.length === 0) return null;
    const remembered =
      this.activeSession === null ? undefined : this.activeByScope.get(this.activeSession);
    const match = remembered ? visible.find((tab) => tab.id === remembered) : undefined;
    return match ?? visible[visible.length - 1] ?? null;
  }

  private applyLayout(): void {
    const [width = 0, height = 0] = this.options.window.getContentSize();
    const layout = computePaneLayout({
      measurement: this.measurement,
      content: { width, height },
      requested: this.requested,
      occluded: this.occluded,
    });
    const activeId = this.activeTab()?.id ?? null;

    let changed = false;
    for (const tab of this.tabs.values()) {
      // A tab with no view is one whose rebuild failed. It keeps its place in the strip and its
      // failure message; there is simply nothing to position.
      const view = tab.view;
      if (!view || view.webContents.isDestroyed()) continue;
      const target = tab.id === activeId ? layout : HIDDEN_LAYOUT;
      if (!layoutChanged(tab.lastLayout, target)) continue;
      tab.lastLayout = target;
      view.setVisible(target.visible);
      if (target.visible) view.setBounds(target.bounds);
      changed = true;
    }
    if (changed) this.publishState();
  }

  private tabState(tab: Tab): PaneTabState {
    const contents = this.contentsOf(tab);
    const alive = contents !== null;
    return {
      id: tab.id,
      targetId: tab.targetId,
      url: alive ? contents.getURL() : tab.lastUrl,
      title: alive ? contents.getTitle() : "",
      loading: alive ? contents.isLoading() : false,
      canGoBack: alive ? (contents.navigationHistory?.canGoBack() ?? false) : false,
      canGoForward: alive ? (contents.navigationHistory?.canGoForward() ?? false) : false,
      ownedByTask: tab.ownedByTask,
      retain: tab.retain,
      failed: tab.failed,
    };
  }

  /** Current state, for a renderer that just connected and needs to catch up. */
  state(): PaneState {
    const visible = this.visibleTabs();
    const active = this.activeTab();
    return {
      present: visible.length > 0,
      visible: active?.lastLayout?.visible ?? false,
      requested: this.requested,
      tabs: visible.map((tab) => this.tabState(tab)),
      activeTabId: active?.id ?? null,
      sessionScope: this.activeSession,
      backend: this.backendFor(this.activeSession),
      backendLocked: this.activeSession !== null && this.hasRunningTask(this.activeSession),
      // Profile-wide, so any conversation's running task holds it shut.
      profileResetLocked: this.runningTasks.size > 0,
      extensionBackendAvailable: this.extensionBackendAvailable,
      restorable: this.restorable,
    };
  }

  private publishState(): void {
    if (this.disposed) return;
    // Same reasoning as `log`, and the same callers: this is a push at the renderer, and
    // `webContents.send` throws once the window has been destroyed — which is exactly when a
    // crashing view's `render-process-gone` is most likely to arrive. A state nobody is left to
    // receive is not worth taking the process down for.
    try {
      this.options.onState(this.state());
    } catch (error) {
      this.log(`could not publish state: ${(error as Error).message}`);
    }
  }

  // --- checkpoint -----------------------------------------------------------

  private scheduleCheckpoint(): void {
    if (!this.checkpoints || this.checkpointTimer || this.disposed) return;
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null;
      if (!this.disposed) this.writeCheckpoint();
    }, CHECKPOINT_DEBOUNCE_MS);
    this.checkpointTimer.unref?.();
  }

  private writeCheckpoint(): void {
    if (!this.checkpoints || this.liveCheckpointsSuspended) return;
    const activeIds = new Set(this.activeByScope.values());
    this.checkpoints.write(
      buildCheckpoint(
        [...this.tabs.values()].map((tab) => ({
          id: tab.id,
          url: tab.lastUrl,
          taskScope: tab.sessionScope,
          retain: tab.retain,
          active: activeIds.has(tab.id),
        })),
      ),
    );
  }

  /**
   * Tears the pane down.
   *
   * `disposed` is set *first*, because closing the tabs below schedules a checkpoint of its own —
   * an earlier revision cleared the timer, then closed the tabs, then cleared the file, and the
   * closes rearmed a timer that wrote an empty checkpoint half a second after teardown. The flag
   * makes every later write a no-op rather than relying on the ordering.
   *
   * Clearing the checkpoint on the way out is what makes the crash prompt mean something: the file
   * surviving into the next launch is precisely the evidence that this never ran.
   */
  destroy(): void {
    this.disposed = true;
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    try {
      this.options.window.off("resize", this.onWindowResize);
    } catch {
      // The window is already gone, which took its listeners with it.
    }
    for (const tab of [...this.tabs.values()]) this.destroyTab(tab);
    // The live checkpoint only. An unanswered crash prompt survives a clean shutdown and is offered
    // again next launch — the user never said to discard those pages, and closing a window is not
    // an answer to a question about a different run.
    //
    // Except when the live file *is* the unanswered prompt, because the copy aside failed. Then it
    // is the only record of those pages and clearing it would answer the question for the user.
    if (!this.liveCheckpointsSuspended) this.checkpoints?.clear();
  }

  /**
   * Turns a surviving live checkpoint into the crash snapshot, at startup.
   *
   * A live checkpoint that outlived its process is the evidence of an unclean shutdown: a clean one
   * clears it. Moving it aside immediately is what lets the pane go on writing live checkpoints —
   * for tabs opened before the user answers — without overwriting the pages it is offering to
   * restore. An unanswered snapshot from an earlier crash is merged rather than replaced, so two
   * crashes in a row do not cost the user the first one's pages.
   */
  private promoteCrashedCheckpoint(): TabCheckpoint | null {
    if (!this.checkpoints || !this.pendingCheckpoints) return null;
    const crashed = this.checkpoints.read();
    const pending = this.pendingCheckpoints.read();
    if (!crashed || crashed.tabs.length === 0) {
      this.pendingCheckpoint = pending;
      return pending;
    }

    const merged = pending ? mergeCheckpoints(pending, crashed) : crashed;
    // Held in memory whatever happens next: this run's prompt is answered from here, so a copy that
    // could not be written still offers the user their pages.
    this.pendingCheckpoint = merged;

    if (this.pendingCheckpoints.write(merged)) {
      this.checkpoints.clear();
    } else {
      // The copy did not land. Deleting the original anyway is the failure the whole
      // "old or new, never neither" rule exists to prevent, so the crashed file stays exactly where
      // it is — and live checkpointing is suspended for this run so nothing overwrites it. The cost
      // is that a *second* crash in this run loses only the new tabs, which is the lesser loss.
      this.liveCheckpointsSuspended = true;
      this.log(
        "could not copy the crashed run's pages aside, so they are being left where they are and " +
          "this run will not write its own checkpoint",
      );
    }
    this.log(`kept ${merged.tabs.length} pages from a run that did not shut down cleanly`);
    return merged;
  }
}

/**
 * What moves to the other backend (002 §7.2).
 *
 * `url` is the whole of what Phase 2 can honestly transfer. The design also names the candidate
 * set, the Intent and the Commitment — those are structures the離场 pipeline produces, and no
 * producer for them is wired yet, so they are absent from this type rather than present and always
 * undefined. When one exists it is added here, and the omission is a compile error at every call
 * site instead of an empty field nobody noticed.
 */
export interface BackendHandoff {
  url: string;
  /** The conversation the handed-off page belongs to. */
  sessionScope: string;
}

/** The answer to "may this task touch this page?" (see {@link BrowserPane.mayDrive}). */
export type DriveDecision =
  | { allowed: true }
  /** The view is not a tab of ours any more. */
  | { allowed: false; reason: "gone" }
  /** The tab outlived its task and belongs to the user now. */
  | { allowed: false; reason: "released"; tabId: string }
  /** Another task owns it — usually a browser session reused across turns. */
  | { allowed: false; reason: "foreign"; tabId: string; owner: string | null };

/** What the relay's registry needs to know about a tab (see {@link BrowserPane.ownershipOf}). */
export interface TabOwnership {
  /** The conversation the tab belongs to. Always present — a tab is never conversation-less. */
  sessionScope: string;
  /** The task allowed to write to it, or null once it has been released. */
  taskId: string | null;
  /** The relay session holding its concurrency claim, or null when nobody does. */
  relaySessionId: string | null;
}

export type ClaimResult =
  | { claimed: true; tabId: string }
  | {
      claimed: false;
      reason: "gone" | "owned" | "other-conversation" | "task-ended" | "task-not-live";
    };

/** Identities that decide who sees and who may write are never blank, and never guessed. */
function requireIdentity(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`The in-app browser needs a ${name} to open a tab; it will not invent one`);
  }
  return value;
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
