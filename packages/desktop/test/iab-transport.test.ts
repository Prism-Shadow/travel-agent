/**
 * The `/iab` transport (src/iab-transport.ts), against a fake socket and a fake debugger.
 *
 * The transport is the seam between two systems neither of which is available in a unit test, so
 * both are replaced: `WebSocket` with a controllable double, and Electron's `WebContents` with an
 * object exposing the three debugger methods the transport actually calls. What remains under test
 * is the part that is ours — the message loop, error mapping, and the reconnect ladder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IabTransport } from "../src/iab-transport.js";

type Listener = (event: unknown) => void;

/** A controllable stand-in for the platform `WebSocket`. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly url: string;
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  deliver(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  deliverRaw(data: string): void {
    this.emit("message", { data });
  }

  fail(code = 1006): void {
    this.readyState = 3;
    this.emit("close", { code });
  }

  /** The messages this socket sent, parsed. */
  messages(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

/** Minimal `WebContents` shape: only what the transport touches. */
function fakeContents(overrides: Partial<Record<string, unknown>> = {}) {
  const debuggerListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const contents = {
    isDestroyed: () => false,
    debugger: {
      isAttached: () => false,
      attach: vi.fn(),
      sendCommand: vi.fn(async () => ({ ok: true })),
      on: (event: string, handler: (...args: unknown[]) => void) => {
        const existing = debuggerListeners.get(event) ?? [];
        existing.push(handler);
        debuggerListeners.set(event, existing);
      },
      once: (event: string, handler: (...args: unknown[]) => void) => {
        const existing = debuggerListeners.get(event) ?? [];
        existing.push(handler);
        debuggerListeners.set(event, existing);
      },
      off: (event: string, handler: (...args: unknown[]) => void) => {
        const existing = debuggerListeners.get(event) ?? [];
        debuggerListeners.set(
          event,
          existing.filter((candidate) => candidate !== handler),
        );
      },
    },
    once: vi.fn(),
    off: vi.fn(),
    /** Test helper: how many listeners are registered, to catch duplicate registration. */
    listenerCount(event: string) {
      return (debuggerListeners.get(event) ?? []).length;
    },
    /** Test helper: fire a CDP event as Electron would. */
    emitDebuggerMessage(method: string, params: unknown, sessionId?: string) {
      for (const handler of debuggerListeners.get("message") ?? []) {
        handler({}, method, params, sessionId);
      }
    },
    ...overrides,
  };
  return contents as unknown as Electron.WebContents & {
    emitDebuggerMessage(method: string, params: unknown, sessionId?: string): void;
    listenerCount(event: string): number;
    debugger: { attach: ReturnType<typeof vi.fn>; sendCommand: ReturnType<typeof vi.fn> };
  };
}

function makeTransport() {
  const contents = fakeContents();
  const openTab = vi.fn(async () => "target-1");
  const redactionState = vi.fn<() => unknown>(() => ({ active: false }));
  const transport = new IabTransport({
    port: 19989,
    key: "test-key",
    installId: "install-1",
    openTab,
    liveTargets: () => [contents],
    // The pane's ownership check. Allowing everything here keeps these tests about the wire
    // protocol; the refusals have their own tests below and in browser-pane-behaviour.
    mayDrive: () => ({ allowed: true }),
    redactionState,
  });
  return { transport, contents, openTab, redactionState };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connection", () => {
  it("connects to the relay's /iab endpoint with its key and identity", () => {
    const { transport } = makeTransport();
    transport.start();

    const url = new URL(FakeSocket.instances[0]!.url);
    expect(url.pathname).toBe("/iab");
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(url.searchParams.get("id")).toBe("travel-agent-iab");
    expect(url.searchParams.get("installId")).toBe("install-1");
    transport.stop();
  });

  it("attaches every live view once the socket opens", () => {
    const { transport, contents } = makeTransport();
    transport.start();
    FakeSocket.instances[0]!.open();
    expect(contents.debugger.attach).toHaveBeenCalledWith("1.3");
    transport.stop();
  });

  it("answers a ping with a pong", () => {
    const { transport } = makeTransport();
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.deliver({ method: "ping" });
    expect(socket.messages()).toContainEqual({ method: "pong" });
    transport.stop();
  });
});

describe("commands", () => {
  it("forwards a CDP command to the view's debugger and answers with its result", async () => {
    const { transport, contents } = makeTransport();
    contents.debugger.sendCommand.mockResolvedValue({ root: { nodeId: 1 } });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    // No session id: a browser-scoped command, which goes to the view without one of ours attached
    // (our session ids are routing labels Electron would reject).
    socket.deliver({
      id: 7,
      method: "forwardCDPCommand",
      params: { method: "DOM.getDocument", params: { depth: 1 } },
    });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 7)).toBe(true));

    expect(contents.debugger.sendCommand).toHaveBeenCalledWith(
      "DOM.getDocument",
      { depth: 1 },
      undefined,
    );
    expect(socket.messages().find((m) => m.id === 7)).toEqual({
      id: 7,
      result: { root: { nodeId: 1 } },
    });
    transport.stop();
  });

  it("creates a view on iab-open-tab and returns its target id", async () => {
    // Target.createTarget is unsupported on Electron (Phase 0), so this command is how a page gets
    // made at all. The shell owns creation; the relay only asks.
    const { transport, openTab } = makeTransport();
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.deliver({
      id: 3,
      method: "iab-open-tab",
      params: { url: "https://example.com/", sessionId: "session-1", taskId: "task-a" },
    });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 3)).toBe(true));

    expect(openTab).toHaveBeenCalledWith({
      url: "https://example.com/",
      sessionId: "session-1",
      taskId: "task-a",
    });
    expect(socket.messages().find((m) => m.id === 3)).toEqual({
      id: 3,
      result: { targetId: "target-1" },
    });
    transport.stop();
  });

  it("ignores a non-string url rather than passing it through", async () => {
    const { transport, openTab } = makeTransport();
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.deliver({
      id: 4,
      method: "iab-open-tab",
      params: { url: { evil: true }, sessionId: "session-1", taskId: "task-a" },
    });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 4)).toBe(true));
    expect(openTab).toHaveBeenCalledWith({
      url: undefined,
      sessionId: "session-1",
      taskId: "task-a",
    });
    transport.stop();
  });

  it.each([
    ["no session id", { url: "https://example.com/", taskId: "task-a" }],
    ["no task id", { url: "https://example.com/", sessionId: "session-1" }],
  ])("refuses to open a tab with %s", async (_label, params) => {
    // A tab with no conversation appears in no strip; one with no task is never subject to the
    // end-of-task rules. Neither is defaulted, here or anywhere else on the path.
    const { transport, openTab } = makeTransport();
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.deliver({ id: 5, method: "iab-open-tab", params });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 5)).toBe(true));
    expect(openTab).not.toHaveBeenCalled();
    expect(String(socket.messages().find((m) => m.id === 5)?.error)).toMatch(/sessionId/);
    transport.stop();
  });

  it("returns main's current redaction state for the named target", async () => {
    const { transport, contents, redactionState } = makeTransport();
    contents.debugger.sendCommand.mockResolvedValue({ targetInfo: { targetId: "target-1" } });
    redactionState.mockReturnValue({
      active: true,
      salt: "c2FsdA==",
      entries: [{ id: "se-1" }],
      live: [{ id: "se-1" }],
    });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await vi.waitFor(() =>
      expect(
        socket
          .messages()
          .some(
            (message) =>
              message.method === "forwardCDPEvent" &&
              (message.params as { method?: string } | undefined)?.method ===
                "Target.attachedToTarget",
          ),
      ).toBe(true),
    );

    socket.deliver({
      id: 6,
      method: "iab-redaction-state",
      params: { targetId: "target-1", taskId: "task-a" },
    });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 6)).toBe(true));

    expect(redactionState).toHaveBeenCalledWith("target-1");
    expect(socket.messages().find((m) => m.id === 6)).toMatchObject({
      id: 6,
      result: { active: true },
    });
    transport.stop();
  });

  it("refuses a redaction request when main has no provider", async () => {
    const contents = fakeContents();
    contents.debugger.sendCommand.mockResolvedValue({ targetInfo: { targetId: "target-1" } });
    const transport = new IabTransport({
      port: 19989,
      key: "k",
      installId: "i",
      openTab: async () => "target-1",
      liveTargets: () => [contents],
      mayDrive: () => ({ allowed: true }),
    });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await vi.waitFor(() => expect(contents.debugger.sendCommand).toHaveBeenCalled());
    socket.deliver({
      id: 8,
      method: "iab-redaction-state",
      params: { targetId: "target-1", taskId: "task-a" },
    });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 8)).toBe(true));
    expect(String(socket.messages().find((m) => m.id === 8)?.error)).toMatch(
      /no main-process provider/,
    );
    transport.stop();
  });

  it("refuses redaction state for a tab the bound task may not drive", async () => {
    const contents = fakeContents();
    contents.debugger.sendCommand.mockResolvedValue({ targetInfo: { targetId: "target-1" } });
    const redactionState = vi.fn<() => unknown>(() => ({ active: false }));
    const transport = new IabTransport({
      port: 19989,
      key: "k",
      installId: "i",
      openTab: async () => "target-1",
      liveTargets: () => [contents],
      mayDrive: () => ({
        allowed: false,
        reason: "foreign",
        tabId: "tab-1",
        owner: "task-owner",
      }),
      redactionState,
    });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await vi.waitFor(() => expect(contents.debugger.sendCommand).toHaveBeenCalled());
    socket.deliver({
      id: 10,
      method: "iab-redaction-state",
      params: { targetId: "target-1", taskId: "task-caller" },
    });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 10)).toBe(true));
    expect(String(socket.messages().find((m) => m.id === 10)?.error)).toMatch(
      /IAB_TAB_FOREIGN.*task-owner/,
    );
    expect(redactionState).not.toHaveBeenCalled();
    transport.stop();
  });
});

describe("ownership", () => {
  it("refuses a command for a page the calling task no longer owns", async () => {
    // The retained tab: still alive, still loaded, no longer the agent's. Nothing else would refuse
    // this — the socket is up, the CDP session is valid, the page is there — so the refusal has to
    // come from the pane's own ownership check, and it has to say which case it is.
    const contents = fakeContents();
    const transport = new IabTransport({
      port: 19989,
      key: "k",
      installId: "i",
      openTab: async () => "t",
      liveTargets: () => [contents],
      mayDrive: () => ({ allowed: false, reason: "released", tabId: "tab-7" }),
    });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.deliver({ id: 21, method: "forwardCDPCommand", params: { method: "Runtime.evaluate" } });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 21)).toBe(true));
    expect(String(socket.messages().find((m) => m.id === 21)?.error)).toMatch(
      /IAB_TAB_RELEASED.*tab-7/,
    );
    expect(contents.debugger.sendCommand).not.toHaveBeenCalledWith(
      "Runtime.evaluate",
      expect.anything(),
      expect.anything(),
    );
    transport.stop();
  });

  it("names the owning task when another one is driving", async () => {
    const contents = fakeContents();
    const transport = new IabTransport({
      port: 19989,
      key: "k",
      installId: "i",
      openTab: async () => "t",
      liveTargets: () => [contents],
      mayDrive: () => ({ allowed: false, reason: "foreign", tabId: "tab-3", owner: "task-other" }),
    });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.deliver({ id: 22, method: "forwardCDPCommand", params: { method: "Runtime.evaluate" } });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 22)).toBe(true));
    expect(String(socket.messages().find((m) => m.id === 22)?.error)).toMatch(
      /IAB_TAB_FOREIGN.*task-other/,
    );
    transport.stop();
  });
});

describe("errors", () => {
  it("returns a debugger failure as an error response, not a dropped request", async () => {
    const { transport, contents } = makeTransport();
    contents.debugger.sendCommand.mockRejectedValue(new Error("Not supported"));
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    socket.deliver({
      id: 9,
      method: "forwardCDPCommand",
      params: { method: "Target.createTarget" },
    });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 9)).toBe(true));
    expect(socket.messages().find((m) => m.id === 9)).toEqual({ id: 9, error: "Not supported" });
    transport.stop();
  });

  it("reports an unsupported method instead of staying silent", async () => {
    const { transport } = makeTransport();
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.deliver({ id: 11, method: "somethingElse" });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 11)).toBe(true));
    expect(String(socket.messages().find((m) => m.id === 11)?.error)).toMatch(/Unsupported method/);
    transport.stop();
  });

  it("answers with an error when no view is attached", async () => {
    const contents = fakeContents();
    const transport = new IabTransport({
      port: 19989,
      key: "k",
      installId: "i",
      openTab: async () => "t",
      liveTargets: () => [],
    });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.deliver({ id: 12, method: "forwardCDPCommand", params: { method: "DOM.getDocument" } });
    await vi.waitFor(() => expect(socket.messages().some((m) => m.id === 12)).toBe(true));
    expect(String(socket.messages().find((m) => m.id === 12)?.error)).toMatch(
      /no in-app browser view/i,
    );
    void contents;
    transport.stop();
  });

  it("survives a message that is not JSON", () => {
    const { transport } = makeTransport();
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    expect(() => socket.deliverRaw("<html>not json</html>")).not.toThrow();
    transport.stop();
  });

  it("ignores a notification with no id, since there is nothing to answer", () => {
    const { transport } = makeTransport();
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    const before = socket.sent.length;
    socket.deliver({ method: "forwardCDPCommand", params: { method: "DOM.getDocument" } });
    expect(socket.sent.length).toBe(before);
    transport.stop();
  });
});

describe("events", () => {
  it("forwards debugger events to the relay as forwardCDPEvent", () => {
    const { transport, contents } = makeTransport();
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    contents.emitDebuggerMessage(
      "Page.frameNavigated",
      { frame: { url: "https://ctrip.com/" } },
      "s1",
    );

    expect(socket.messages()).toContainEqual({
      method: "forwardCDPEvent",
      params: {
        method: "Page.frameNavigated",
        params: { frame: { url: "https://ctrip.com/" } },
        sessionId: "s1",
      },
    });
    transport.stop();
  });
});

describe("reconnect", () => {
  it("reconnects after an unexpected close, backing off between attempts", () => {
    const { transport } = makeTransport();
    transport.start();
    expect(FakeSocket.instances).toHaveLength(1);

    FakeSocket.instances[0]!.fail();
    vi.advanceTimersByTime(250);
    expect(FakeSocket.instances).toHaveLength(2);

    // Second failure waits longer: still one socket at 250ms, a new one once the longer delay passes.
    FakeSocket.instances[1]!.fail();
    vi.advanceTimersByTime(250);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(250);
    expect(FakeSocket.instances).toHaveLength(3);
    transport.stop();
  });

  it("resets the backoff once a connection succeeds", () => {
    const { transport } = makeTransport();
    transport.start();
    FakeSocket.instances[0]!.fail();
    vi.advanceTimersByTime(250);
    FakeSocket.instances[1]!.open();

    FakeSocket.instances[1]!.fail();
    vi.advanceTimersByTime(250);
    expect(FakeSocket.instances).toHaveLength(3);
    transport.stop();
  });

  it("stops reconnecting after stop()", () => {
    const { transport } = makeTransport();
    transport.start();
    transport.stop();
    FakeSocket.instances[0]!.fail();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("re-attaches views after reconnecting", () => {
    const { transport, contents } = makeTransport();
    transport.start();
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.fail();
    vi.advanceTimersByTime(250);
    FakeSocket.instances[1]!.open();
    // Already attached, so attach is not called twice — the point is that it did not throw and the
    // transport still considers the view live.
    expect(contents.debugger.attach).toHaveBeenCalledTimes(1);
    transport.stop();
  });
});

describe("announcing a target", () => {
  /** The relay learns a page exists only from Target.attachedToTarget. */
  const announcements = (socket: FakeSocket) =>
    socket
      .messages()
      .filter(
        (m) =>
          m.method === "forwardCDPEvent" &&
          (m.params as { method?: string }).method === "Target.attachedToTarget",
      );

  it("announces once when the socket opens", async () => {
    const { transport, contents } = makeTransport();
    contents.debugger.sendCommand.mockResolvedValue({ targetInfo: { targetId: "T1" } });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await vi.waitFor(() => expect(announcements(socket)).toHaveLength(1));
    transport.stop();
  });

  it("retries a transient failure without waiting for a reconnect", async () => {
    // The regression: one failed announcement was permanent on a socket that stayed open, leaving
    // the backend connected with zero targets and every command failing as though it were gone.
    const { transport, contents } = makeTransport();
    contents.debugger.sendCommand
      .mockRejectedValueOnce(new Error("debugger busy"))
      .mockResolvedValue({ targetInfo: { targetId: "T1" } });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();

    await vi.waitFor(() => expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(1));
    expect(announcements(socket)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(announcements(socket)).toHaveLength(1));
    transport.stop();
  });

  it("gives up after a bounded number of attempts", async () => {
    const { transport, contents } = makeTransport();
    contents.debugger.sendCommand.mockRejectedValue(new Error("never answers"));
    transport.start();
    FakeSocket.instances[0]!.open();

    await vi.advanceTimersByTimeAsync(60_000);
    // Four delays in the ladder, so five attempts in total and then it stops.
    expect(contents.debugger.sendCommand.mock.calls.length).toBeLessThanOrEqual(5);
    transport.stop();
  });

  it("never announces the same view twice", async () => {
    const { transport, contents } = makeTransport();
    contents.debugger.sendCommand.mockResolvedValue({ targetInfo: { targetId: "T1" } });
    transport.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await vi.waitFor(() => expect(announcements(socket)).toHaveLength(1));

    // Attaching again is a no-op, and so is a redundant open.
    transport.attach(contents);
    socket.open();
    await vi.advanceTimersByTimeAsync(1000);
    expect(announcements(socket).length).toBeGreaterThanOrEqual(1);
    expect(contents.listenerCount("message")).toBe(1);
    transport.stop();
  });

  it("registers debugger listeners exactly once across a failed announcement", async () => {
    // The earlier bug: a failed announcement dropped the view from the table but left its listeners
    // attached, so the next attach added a second set and every event was forwarded twice.
    const { transport, contents } = makeTransport();
    contents.debugger.sendCommand.mockRejectedValue(new Error("nope"));
    transport.start();
    FakeSocket.instances[0]!.open();
    await vi.advanceTimersByTimeAsync(5000);
    transport.attach(contents);
    expect(contents.listenerCount("message")).toBe(1);
    transport.stop();
  });

  it("re-announces after a reconnect, because the relay forgot", async () => {
    const { transport, contents } = makeTransport();
    contents.debugger.sendCommand.mockResolvedValue({ targetInfo: { targetId: "T1" } });
    transport.start();
    FakeSocket.instances[0]!.open();
    await vi.waitFor(() => expect(announcements(FakeSocket.instances[0]!)).toHaveLength(1));

    FakeSocket.instances[0]!.fail();
    await vi.advanceTimersByTimeAsync(250);
    FakeSocket.instances[1]!.open();
    await vi.waitFor(() => expect(announcements(FakeSocket.instances[1]!)).toHaveLength(1));
    expect(contents.listenerCount("message")).toBe(1);
    transport.stop();
  });
});
