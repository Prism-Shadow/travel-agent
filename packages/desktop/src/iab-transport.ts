/**
 * The desktop shell's side of the relay's `/iab` socket.
 *
 * Design/002 §4.2 weighed three ways to let the agent drive an in-app `WebContentsView` and picked
 * this one. The rejected alternative is worth remembering: opening Chromium's own
 * `--remote-debugging-port` would have worked with zero relay changes, but Phase 0 confirmed that
 * the port exposes **every** target in the process — including the window holding the user's
 * authenticated session — to any local caller, with no authentication of any kind.
 *
 * So instead the shell speaks the protocol the relay already understands. A Chrome extension
 * bridges `chrome.debugger`; this bridges `webContents.debugger`. Both present the same thing: a
 * set of independent per-target debugger sessions exchanging `forwardCDPCommand` and
 * `forwardCDPEvent`. The relay's target synthesis, Playwright bridging, tab ownership and executor
 * all work unchanged because from their side nothing changed.
 *
 * One command is ours alone. `Target.createTarget` is unsupported on Electron (Phase 0), so
 * `iab-open-tab` asks the shell to construct a view; everything else is ordinary CDP.
 */
import { WebContents } from "electron";
import type { ClaimResult, DriveDecision, TabOwnership } from "./browser-pane.js";

/** Attaching uses a fixed protocol revision so a Chromium upgrade cannot silently change semantics. */
const DEBUGGER_PROTOCOL_VERSION = "1.3";

/** Reconnect backoff. Short at first — the usual cause is the relay still starting up. */
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000];

/**
 * Retry ladder for announcing a target.
 *
 * A single transient failure used to be permanent: the announcement is what tells the relay a page
 * exists, and the only thing that tried again was a socket reconnect. On a socket that stays open —
 * the normal case — the backend sat connected with zero targets and every command failed as though
 * it were gone. Bounded, because a view whose debugger will not answer after a few seconds is not
 * going to start.
 */
const ANNOUNCE_RETRY_DELAYS_MS = [200, 500, 1500, 3000];

/** Wire messages, matching `packages/browser-cli/src/relay/protocol.ts`. */
interface InboundMessage {
  id?: number;
  method?: string;
  params?: { method?: string; sessionId?: string; params?: unknown };
}

/** A view the transport is bridging, plus the teardown for the listeners it registered. */
interface AttachedView {
  contents: WebContents;
  /** Announced to the relay already; re-announcing would give it two pages for one view. */
  announced: boolean;
  /** In flight, so a retry and a reconnect cannot announce the same view twice. */
  announcing: boolean;
  /** The CDP target id this view announced itself under. Null until the announcement succeeds. */
  targetId: string | null;
  /**
   * CDP sessions Chromium minted *underneath* this view — an out-of-process iframe, a worker.
   * Tracked so a command addressed to one of them lands on the view that owns it rather than on
   * whichever view happened to be convenient.
   */
  children: Set<string>;
  /** Pending retry, cancelled when the view is released. */
  retryTimer: NodeJS.Timeout | null;
  dispose: () => void;
}

/** What is known about a tab when the user closes it, as the pane reports it. */
export interface ClosedTabNotice {
  tabId: string;
  targetId: string | null;
  sessionScope: string;
  ownedByTask: string | null;
}

/**
 * Turns a refusal into something the agent can act on.
 *
 * Each carries a code the skill documents, because "permission denied" tells an agent nothing about
 * whether to retry, claim, or start over — and each of these calls for a different next step.
 */
function ownershipError(decision: Exclude<DriveDecision, { allowed: true }>): string {
  switch (decision.reason) {
    case "gone":
      return "IAB_TAB_GONE: that page is no longer a tab of the in-app browser.";
    case "released":
      return (
        `IAB_TAB_RELEASED: tab ${decision.tabId} outlived the task that opened it and belongs to ` +
        "the user now. It was left open on purpose. Claim it with tabs.claim() if you need it, or " +
        "open a new tab."
      );
    case "foreign":
      return (
        `IAB_TAB_FOREIGN: tab ${decision.tabId} is owned by task ${String(decision.owner)}, not by ` +
        "the task making this call. Open your own tab rather than writing to another task's page."
      );
  }
}

/** Where a command should be sent, or why it cannot be. */
type CommandRoute =
  | { kind: "view"; contents: WebContents; cdpSessionId: string | undefined }
  /** The tab this session belonged to was closed by the user. */
  | { kind: "closed"; tabId: string }
  /** A session id that is not ours and never was. */
  | { kind: "unknown" }
  /** No view at all — the pane is empty. */
  | { kind: "none" };

export interface IabTransportOptions {
  /** Relay port. The shell forked the relay, so it knows this without discovery. */
  port: number;
  /** Per-run key, matched by the relay in constant time. Never logged. */
  key: string;
  /** Stable identity for this installation, so the relay can recognise a reconnect. */
  installId: string;
  /**
   * Creates a view on `iab-open-tab` and returns its CDP target id.
   *
   * `relaySessionId` is the relay session that will hold the tab's concurrency claim. Optional
   * because a caller that has not got one yet — the relay's own cold-start bootstrap runs before
   * the executor exists — still opens a tab; the claim is then established by the announcement.
   */
  openTab: (options: {
    url?: string;
    sessionId: string;
    taskId: string;
    relaySessionId?: string;
  }) => Promise<string>;
  /** Every view the transport should be attached to right now. */
  liveTargets: () => WebContents[];
  /**
   * The view the user is looking at.
   *
   * Used for commands that carry no session the relay recognises. With one view "the only
   * attachment" and "the one on screen" were the same thing; with a tab strip they are not, and a
   * browser-scoped command landing on a background tab would act on a page nobody is watching.
   */
  activeTarget?: () => WebContents | null;
  /**
   * Whether the task driving a command may touch the page it reached.
   *
   * Supplied by the pane, which owns the tab model. Optional so a transport can be built without
   * one in a test; in the shell it is always wired, because without it there is no ownership at
   * all — only a field the tab strip draws.
   */
  mayDrive?: (contents: WebContents, taskId: string | undefined) => DriveDecision;
  /** Takes ownership of an unowned tab for a task, for `iab-claim-tab`. */
  claimTab?: (
    targetId: string,
    identity: { sessionId: string; taskId: string; relaySessionId?: string },
  ) => ClaimResult;
  /**
   * Who owns the tab behind a view, for the relay's own registry.
   *
   * Sent with every target announcement — first attach and every reconnect — so the relay can
   * rebuild its claims from the authority rather than from a stream of notifications it may have
   * missed while the socket was down.
   */
  ownershipOf?: (contents: WebContents) => TabOwnership | null;
  /**
   * A live view the calling task may drive, for commands that name no target.
   *
   * Browser-scoped commands (`Target.*`, `Browser.*`) have to land *somewhere*, and the tab the
   * user happens to be looking at is the wrong answer: it may belong to another task, or to nobody
   * at all, and the still-running task's own command would then be refused for a page it never
   * asked about.
   */
  taskTarget?: (taskId: string | undefined) => WebContents | null;
  /**
   * The agent's own account of how its task went (`iab-end-task`), recorded for later.
   *
   * The outcome arrives as a raw string and is validated by the pane: this side has no business
   * deciding which values are meaningful, and an unrecognised one must land on the conservative
   * rule rather than being rejected outright.
   */
  declareOutcome?: (taskId: string, outcome: string) => void;
  log?: (message: string) => void;
}

/**
 * How many closed-session tombstones are remembered.
 *
 * A tombstone is what turns "that session does not exist" into "the user closed that tab", and a
 * closed tab can leave several behind at once — its root session and every child session under it.
 * Sized for the commands still in flight when a tab goes away, several tabs deep. Not a ledger:
 * once evicted, the answer degrades to the generic unknown-session error, which is still a refusal.
 */
const TOMBSTONE_MEMORY = 128;

/**
 * Bridges Electron's per-view debuggers to the relay.
 *
 * Owns its socket and its reconnect loop; callers `start()` it once and `attach()` each view as it
 * is created.
 */
export class IabTransport {
  private socket: WebSocket | null = null;
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** Attached views, keyed by the synthetic CDP session id the relay routes on. */
  private readonly attached = new Map<string, AttachedView>();
  private nextSessionOrdinal = 1;
  /** Scope makes session ids unique across reconnects, matching the extension's own scheme. */
  private readonly sessionScope = Math.random().toString(36).slice(2, 8);
  /** Child CDP session id → the root session of the view that owns it. */
  private readonly childToRoot = new Map<string, string>();
  /** Session ids (root and child alike) whose view the user closed, and the tab it was. */
  private readonly tombstones = new Map<string, string>();

  constructor(private readonly options: IabTransportOptions) {}

  private log(message: string): void {
    this.options.log?.(`[iab] ${message}\n`);
  }

  /** Relay URL. Built per connection so a rotated key is picked up on reconnect. */
  private url(): string {
    const query = new URLSearchParams({
      key: this.options.key,
      id: "travel-agent-iab",
      installId: this.options.installId,
      browser: "Travel Agent (in-app browser)",
    });
    return `ws://127.0.0.1:${this.options.port}/iab?${query.toString()}`;
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  private connect(): void {
    if (this.closed || this.socket) return;

    // Node's built-in WebSocket, which sends no Origin header — exactly what the relay demands,
    // since a page always sends one and this must not look like a page.
    const socket = new WebSocket(this.url());
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.log("connected to the relay");
      // Attach anything new, then announce *everything*. A view attached before the socket opened
      // — the usual case, since the pane is created as soon as the window is — had its
      // announcement dropped on a closed socket, and a re-attach alone would be a no-op because it
      // is already registered. The relay learns which targets exist only from these events, so
      // skipping them leaves it connected with zero pages.
      for (const contents of this.options.liveTargets()) this.attach(contents);
      // A reconnected relay has forgotten every target, so the announcements have to be made again.
      for (const entry of this.attached.values()) entry.announced = false;
      for (const sessionId of [...this.attached.keys()]) void this.announceTarget(sessionId);
    });

    socket.addEventListener("message", (event) => {
      void this.onMessage(String((event as MessageEvent).data));
    });

    socket.addEventListener("error", () => {
      // Expected while the relay is still binding its port; the close handler reconnects.
      this.log("socket error");
    });

    socket.addEventListener("close", (event) => {
      this.socket = null;
      if (this.closed) return;
      this.log(`socket closed (${(event as CloseEvent).code}); reconnecting`);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState !== 1 /* OPEN */) return;
    this.socket.send(JSON.stringify(payload));
  }

  private async onMessage(raw: string): Promise<void> {
    let message: InboundMessage;
    try {
      message = JSON.parse(raw) as InboundMessage;
    } catch {
      this.log("dropped a message that was not JSON");
      return;
    }

    if (message.method === "ping") {
      this.send({ method: "pong" });
      return;
    }

    // Everything else the relay sends us is a request and carries an id to answer.
    if (typeof message.id !== "number") return;
    const id = message.id;

    try {
      if (message.method === "iab-open-tab") {
        const params = message.params as
          | { url?: unknown; sessionId?: unknown; taskId?: unknown; relaySessionId?: unknown }
          | undefined;
        const url = typeof params?.url === "string" ? params.url : undefined;
        // Both identities travel from the harness — the session that owns the conversation, the
        // task that owns the turn — through the CLI and the relay to here. Neither is defaulted:
        // a tab with no session would appear in no strip, and one with no task would never be
        // subject to the end-of-task rules. Refusing is the only honest answer, and it surfaces
        // as a failed `tabs.open()` rather than as a tab nobody can account for.
        const sessionId = typeof params?.sessionId === "string" ? params.sessionId : "";
        const taskId = typeof params?.taskId === "string" ? params.taskId : "";
        if (!sessionId || !taskId) {
          throw new Error(
            "iab-open-tab needs both a sessionId and a taskId; the in-app browser will not open " +
              "a tab that belongs to no conversation and no task",
          );
        }
        const relaySessionId =
          typeof params?.relaySessionId === "string" ? params.relaySessionId : undefined;
        const targetId = await this.options.openTab({
          url,
          sessionId,
          taskId,
          ...(relaySessionId ? { relaySessionId } : {}),
        });
        this.send({ id, result: { targetId } });
        return;
      }

      if (message.method === "iab-claim-tab") {
        const params = message.params as
          | { targetId?: unknown; sessionId?: unknown; taskId?: unknown; relaySessionId?: unknown }
          | undefined;
        const targetId = typeof params?.targetId === "string" ? params.targetId : "";
        const sessionId = typeof params?.sessionId === "string" ? params.sessionId : "";
        const taskId = typeof params?.taskId === "string" ? params.taskId : "";
        if (!targetId || !sessionId || !taskId) {
          throw new Error("iab-claim-tab needs a targetId, a sessionId and a taskId");
        }
        const relaySessionId =
          typeof params?.relaySessionId === "string" ? params.relaySessionId : undefined;
        const result = this.options.claimTab?.(targetId, {
          sessionId,
          taskId,
          ...(relaySessionId ? { relaySessionId } : {}),
        }) ?? { claimed: false, reason: "gone" as const };
        this.send({ id, result });
        return;
      }

      if (message.method === "iab-end-task") {
        // The agent closing its browser session, saying how the task went. It is the only party
        // that knows whether a turn merely searched or left an order behind (design/002 §6.4) — but
        // it is saying so *before* the turn is over, so this only records the claim. The rules run
        // at the harness's own end-of-task boundary, where an abort can still override it.
        const params = message.params as { taskId?: unknown; outcome?: unknown } | undefined;
        const taskId = typeof params?.taskId === "string" ? params.taskId : "";
        if (!taskId) throw new Error("iab-end-task needs a taskId");
        const outcome = typeof params?.outcome === "string" ? params.outcome : "unknown";
        this.options.declareOutcome?.(taskId, outcome);
        this.send({ id, result: { recorded: true } });
        return;
      }

      if (message.method === "forwardCDPCommand") {
        const result = await this.forwardCdpCommand(message.params ?? {});
        this.send({ id, result });
        return;
      }

      this.send({ id, error: `Unsupported method: ${String(message.method)}` });
    } catch (error) {
      this.send({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async forwardCdpCommand(params: {
    method?: string;
    sessionId?: string;
    params?: unknown;
    taskId?: string;
  }): Promise<unknown> {
    const { method, sessionId, taskId } = params;
    if (!method) throw new Error("forwardCDPCommand without a method");

    const route = this.routeFor(sessionId, taskId);
    switch (route.kind) {
      case "closed":
        // A tab the user closed is a different situation from a backend that is not there, and the
        // agent can only replan if it is told which one happened (002 §6.4 四). Nothing reopens the
        // tab: the user closed it on purpose.
        throw new Error(
          `IAB_TAB_CLOSED: the user closed the in-app browser tab this session was using ` +
            `(${route.tabId}). It was not reopened. Open a new tab and continue from there.`,
        );
      case "unknown":
        throw new Error(
          `IAB_UNKNOWN_SESSION: no in-app browser view is attached for session ${String(sessionId)}`,
        );
      case "none":
        throw new Error("No in-app browser view is attached");
      case "view":
        break;
    }

    if (route.contents.isDestroyed()) throw new Error("The in-app browser view was destroyed");

    // Ownership, checked on the page this command actually reached rather than on the session it
    // named. A retained tab is deliberately still alive, so nothing else would refuse the write:
    // the executor that opened it is connected, its CDP session is valid, and the page is there.
    const decision = this.options.mayDrive?.(route.contents, taskId) ?? { allowed: true };
    if (!decision.allowed) throw new Error(ownershipError(decision));

    return route.contents.debugger.sendCommand(
      method,
      params.params as object | undefined,
      route.cdpSessionId,
    );
  }

  /**
   * Resolves where a command goes.
   *
   * **A named session never falls back.** With one view "the only attachment" and "the session you
   * asked for" were the same thing, so an unrecognised id could be sent to the only view without
   * consequence. With a tab strip that is a bug with teeth: a command left over from a tab the user
   * closed, or addressed to an iframe that has gone, would execute on whatever tab is on screen —
   * a click, a fill, a submit landing on a page the agent has never seen. Worse, it made the
   * closed-tab tombstone unreachable, because there was always another view to fall through to.
   *
   * So only three things route:
   *   - **no session id** — a browser-scoped command (`Target.*`, `Browser.*`), which goes to a page
   *     of the *calling task*. The tab the user is looking at is a fallback for a caller with no
   *     task at all, because a user who clicks onto a retained tab must not make a running task's
   *     untargeted commands start landing somewhere else;
   *   - **a root session we minted** — that view, with no CDP session id, because ours is a routing
   *     label Electron would reject;
   *   - **a child session Chromium minted** — the view it was created under, *with* the id, since
   *     that one is Chromium's own.
   *
   * Everything else is refused, with a tombstone's explanation when there is one.
   */
  private routeFor(sessionId: string | undefined, taskId?: string): CommandRoute {
    if (sessionId === undefined || sessionId === "") {
      // A page of the *calling task* first — its own active one when it has several. The tab on
      // screen is only a fallback for a caller with no task (a browser-scoped probe from the
      // relay's own bootstrap), because a user who clicks onto a retained tab must not make a
      // running task's untargeted commands start failing.
      const mine = this.options.taskTarget?.(taskId);
      if (mine && !mine.isDestroyed()) {
        return { kind: "view", contents: mine, cdpSessionId: undefined };
      }
      if (taskId === undefined) {
        const active = this.options.activeTarget?.();
        if (active && !active.isDestroyed()) {
          return { kind: "view", contents: active, cdpSessionId: undefined };
        }
        for (const entry of this.attached.values()) {
          if (!entry.contents.isDestroyed()) {
            return { kind: "view", contents: entry.contents, cdpSessionId: undefined };
          }
        }
      }
      return { kind: "none" };
    }

    const root = this.attached.get(sessionId);
    if (root && !root.contents.isDestroyed()) {
      return { kind: "view", contents: root.contents, cdpSessionId: undefined };
    }

    const parent = this.childToRoot.get(sessionId);
    if (parent) {
      const owner = this.attached.get(parent);
      if (owner && !owner.contents.isDestroyed()) {
        return { kind: "view", contents: owner.contents, cdpSessionId: sessionId };
      }
    }

    const tabId = this.tombstones.get(sessionId);
    return tabId ? { kind: "closed", tabId } : { kind: "unknown" };
  }

  /**
   * Records that a view is going away because the user closed its tab.
   *
   * Called before the view is destroyed, because afterwards there is nothing left to look it up by.
   * The pane knows *that* a user closed a tab and what its target id was; only this side knows
   * which CDP sessions that target had — the root one and every child under it, all of which can
   * still have commands in flight.
   */
  noteUserClosed(notice: ClosedTabNotice): void {
    const rootSessionId = notice.targetId ? this.sessionForTarget(notice.targetId) : null;
    if (!rootSessionId) return;
    this.markTombstone(rootSessionId, notice.tabId);
    for (const [child, parent] of this.childToRoot) {
      if (parent === rootSessionId) this.markTombstone(child, notice.tabId);
    }
  }

  private markTombstone(sessionId: string, tabId: string): void {
    // Re-inserted rather than updated in place so the most recently closed tab is the last to be
    // evicted: the commands still in flight are the ones for the tab that just went away.
    this.tombstones.delete(sessionId);
    this.tombstones.set(sessionId, tabId);
    while (this.tombstones.size > TOMBSTONE_MEMORY) {
      const oldest = this.tombstones.keys().next().value;
      if (oldest === undefined) break;
      this.tombstones.delete(oldest);
    }
  }

  /** The root session a target id was announced under. */
  private sessionForTarget(targetId: string): string | null {
    for (const [sessionId, entry] of this.attached) {
      if (entry.targetId === targetId) return sessionId;
    }
    return null;
  }

  /**
   * Attaches the debugger to a view and starts forwarding its events.
   *
   * Idempotent: a view already attached is left alone, so callers may attach on every navigation
   * without tracking state themselves.
   */
  attach(contents: WebContents): void {
    if (contents.isDestroyed()) return;
    if (this.sessionFor(contents)) return;

    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach(DEBUGGER_PROTOCOL_VERSION);
    } catch (error) {
      this.log(`could not attach the debugger: ${(error as Error).message}`);
      return;
    }

    const sessionId = `pw-tab-${this.sessionScope}-${this.nextSessionOrdinal++}`;

    // Listeners are registered exactly once per view and torn down with it. An earlier revision
    // dropped the view from the table when an announcement failed but left these in place, so the
    // next attach added a second set and every CDP event was forwarded twice.
    const onDebuggerMessage = (
      _event: unknown,
      method: string,
      params: unknown,
      cdpSessionId?: string,
    ): void => {
      // Chromium announces its own sub-targets through this stream: an out-of-process iframe, a
      // service worker. Recording which view they belong to is what lets a later command addressed
      // to one of them be routed exactly, instead of being sent somewhere plausible.
      if (method === "Target.attachedToTarget") {
        const child = (params as { sessionId?: unknown } | undefined)?.sessionId;
        if (typeof child === "string" && child) {
          this.childToRoot.set(child, sessionId);
          this.attached.get(sessionId)?.children.add(child);
        }
      } else if (method === "Target.detachedFromTarget") {
        const child = (params as { sessionId?: unknown } | undefined)?.sessionId;
        if (typeof child === "string" && child) {
          this.childToRoot.delete(child);
          this.attached.get(sessionId)?.children.delete(child);
        }
      }
      this.send({
        method: "forwardCDPEvent",
        params: { method, params, sessionId: cdpSessionId || sessionId },
      });
    };
    const onDetach = (): void => this.release(sessionId);
    const onDestroyed = (): void => this.release(sessionId);

    contents.debugger.on("message", onDebuggerMessage);
    contents.debugger.once("detach", onDetach);
    contents.once("destroyed", onDestroyed);

    this.attached.set(sessionId, {
      contents,
      announced: false,
      announcing: false,
      targetId: null,
      children: new Set(),
      retryTimer: null,
      dispose: () => {
        try {
          contents.debugger.off("message", onDebuggerMessage);
          contents.debugger.off("detach", onDetach);
          contents.off("destroyed", onDestroyed);
        } catch {
          // A destroyed WebContents rejects listener removal; the listeners died with it.
        }
      },
    });

    // Announced on socket open rather than here: this may run before the socket exists.
    if (this.socket?.readyState === 1) void this.announceTarget(sessionId);
  }

  /** The session id a view is registered under, if any. */
  private sessionFor(contents: WebContents): string | null {
    for (const [sessionId, entry] of this.attached) {
      if (entry.contents === contents) return sessionId;
    }
    return null;
  }

  /** Removes a view, detaching its listeners exactly once. */
  private release(sessionId: string): void {
    const entry = this.attached.get(sessionId);
    if (!entry) return;
    this.attached.delete(sessionId);
    // The child sessions go with it. Leaving them mapped to a root that no longer exists would make
    // `routeFor` look up a parent that is gone and fall through to "unknown" — the right answer,
    // but reached by accident, and the map would grow for the life of the process.
    for (const child of entry.children) this.childToRoot.delete(child);
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.dispose();
    // The relay's picture of the browser is built from these events; without a detach it keeps
    // offering Playwright a page that no longer exists, and the next command against it fails as a
    // timeout rather than as a closed tab.
    if (entry.announced) {
      this.send({
        method: "forwardCDPEvent",
        params: { method: "Target.detachedFromTarget", params: { sessionId } },
      });
    }
  }

  /**
   * Tells the relay a target exists.
   *
   * The relay builds its view of the browser from `Target.attachedToTarget`; without this the
   * connection is live but Playwright sees zero pages and every command fails as though the backend
   * were gone. Idempotent — announcing twice would give the relay two pages for one view — and a
   * failure leaves the view registered so the next reconnect can try again rather than silently
   * dropping it.
   */
  private async announceTarget(sessionId: string, attempt = 0): Promise<void> {
    const entry = this.attached.get(sessionId);
    if (!entry || entry.announced || entry.announcing || entry.contents.isDestroyed()) return;
    entry.announcing = true;

    try {
      const info = (await entry.contents.debugger.sendCommand("Target.getTargetInfo")) as {
        targetInfo?: Record<string, unknown>;
      };
      const targetInfo = info?.targetInfo;
      if (!targetInfo) throw new Error("Target.getTargetInfo returned no targetInfo");

      // Re-read: the entry may have been released while the command was in flight.
      const current = this.attached.get(sessionId);
      if (!current || current.announced) return;
      current.announced = true;
      // Kept so a closed tab can be matched back to its CDP session by target id — the pane knows
      // the target id, this side knows the session.
      current.targetId = typeof targetInfo.targetId === "string" ? targetInfo.targetId : null;

      this.send({
        method: "forwardCDPEvent",
        params: {
          method: "Target.attachedToTarget",
          params: {
            sessionId,
            targetInfo: { ...targetInfo, attached: true },
            waitingForDebugger: false,
          },
          // The authority's statement of who holds this page, restated on every reconnect. Null
          // means nobody does — a tab that outlived its task — and the relay releases its claim
          // accordingly. This is what makes the two registries converge without a durable log.
          iabOwner: current.contents.isDestroyed()
            ? null
            : (this.options.ownershipOf?.(current.contents) ?? null),
        },
      });
      this.log(`announced target ${String(targetInfo.targetId)} as ${sessionId}`);
    } catch (error) {
      const delay = ANNOUNCE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        this.log(
          `giving up announcing ${sessionId} after ${ANNOUNCE_RETRY_DELAYS_MS.length} attempts: ` +
            `${(error as Error).message}`,
        );
        return;
      }
      this.log(`could not announce ${sessionId}, retrying: ${(error as Error).message}`);
      const pending = this.attached.get(sessionId);
      if (!pending) return;
      pending.retryTimer = setTimeout(() => {
        const still = this.attached.get(sessionId);
        if (!still) return;
        still.retryTimer = null;
        void this.announceTarget(sessionId, attempt + 1);
      }, delay);
      pending.retryTimer.unref?.();
    } finally {
      const current = this.attached.get(sessionId);
      if (current) current.announcing = false;
    }
  }

  /**
   * Tells the relay something happened on this side that its own registries need to know about.
   *
   * Fire-and-forget, with no id: these are notifications, not requests, and there is nothing useful
   * to do with a failure. A message dropped because the socket is down is re-established by the
   * next reconnect's re-announcement, which rebuilds the relay's picture from scratch anyway.
   */
  notify(method: string, params: Record<string, unknown>): void {
    this.send({ method, params });
  }

  /** Stops reconnecting, closes the socket, and detaches every listener this transport added. */
  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const sessionId of [...this.attached.keys()]) this.release(sessionId);
    this.socket?.close();
    this.socket = null;
  }
}
