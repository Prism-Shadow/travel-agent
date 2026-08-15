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

/** Wire messages, matching `packages/browser-cli/src/protocol.ts`. */
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
  /** Pending retry, cancelled when the view is released. */
  retryTimer: NodeJS.Timeout | null;
  dispose: () => void;
}

export interface IabTransportOptions {
  /** Relay port. The shell forked the relay, so it knows this without discovery. */
  port: number;
  /** Per-run key, matched by the relay in constant time. Never logged. */
  key: string;
  /** Stable identity for this installation, so the relay can recognise a reconnect. */
  installId: string;
  /** Creates a view on `iab-open-tab` and returns its CDP target id. */
  openTab: (url?: string) => Promise<string>;
  /** Every view the transport should be attached to right now. */
  liveTargets: () => WebContents[];
  log?: (message: string) => void;
}

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
        const requested = (message.params as { url?: unknown } | undefined)?.url;
        const url = typeof requested === "string" ? requested : undefined;
        const targetId = await this.options.openTab(url);
        this.send({ id, result: { targetId } });
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
  }): Promise<unknown> {
    const { method, sessionId } = params;
    if (!method) throw new Error("forwardCDPCommand without a method");

    const contents = this.contentsForSession(sessionId);
    if (!contents) {
      throw new Error(
        sessionId
          ? `No in-app browser view is attached for session ${sessionId}`
          : "No in-app browser view is attached",
      );
    }
    if (contents.isDestroyed()) throw new Error("The in-app browser view was destroyed");

    // A session id we minted is a routing label, not something Electron knows — passing it to
    // sendCommand would be rejected. Only ids Chromium itself produced (an out-of-process iframe,
    // a worker) are forwarded, and those are exactly the ones absent from our table.
    const ours = sessionId !== undefined && this.attached.has(sessionId);
    return contents.debugger.sendCommand(
      method,
      params.params as object | undefined,
      ours ? undefined : sessionId,
    );
  }

  /**
   * Resolves which view a command is for.
   *
   * Phase 1 is a single view by design, so an unrouted command goes to the only attachment. Keeping
   * the lookup in one place is what lets Phase 2 add real per-session routing without touching the
   * message loop.
   */
  private contentsForSession(sessionId: string | undefined): WebContents | null {
    if (sessionId) {
      const match = this.attached.get(sessionId)?.contents;
      if (match && !match.isDestroyed()) return match;
      // A browser-scoped command carries no session id the relay recognises; fall through.
    }
    for (const entry of this.attached.values()) {
      if (!entry.contents.isDestroyed()) return entry.contents;
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
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.dispose();
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

      this.send({
        method: "forwardCDPEvent",
        params: {
          method: "Target.attachedToTarget",
          params: {
            sessionId,
            targetInfo: { ...targetInfo, attached: true },
            waitingForDebugger: false,
          },
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
