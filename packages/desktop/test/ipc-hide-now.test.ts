/**
 * The synchronous hide channel (`iab:hide-now` in src/ipc.ts).
 *
 * Everything else in this bridge is an `invoke`, and this one is not, for a reason that is a
 * property of frames rather than of messages: when the route changes, the renderer's layout effect
 * runs inside the commit that will paint the new conversation, and the native view is composited
 * *above* that frame still showing the previous conversation's page. An asynchronous message is
 * only *started* there. Blocking the renderer until main has hidden the view is the only way the
 * ordering is actually guaranteed — so what is tested here is that the channel exists as a
 * synchronous one, that it hides, that it is refused for anyone but the app window, and that it
 * says so rather than throwing.
 */
import { describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
const listeners = new Map<string, (event: { sender: unknown; returnValue?: unknown }) => void>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
    on: (
      channel: string,
      listener: (event: { sender: unknown; returnValue?: unknown }) => void,
    ) => {
      listeners.set(channel, listener);
    },
    removeListener: (channel: string) => {
      listeners.delete(channel);
    },
  },
  shell: { openExternal: vi.fn(async () => {}) },
}));

const { installBrowserIpc } = await import("../src/ipc.js");

function harness(options: { failHide?: boolean } = {}) {
  handlers.clear();
  listeners.clear();
  const measurements: Array<unknown> = [];
  const webContents = { id: 1 };
  const window = { webContents } as never;
  const pane = {
    setMeasurement: (value: unknown) => {
      if (options.failHide) throw new Error("the window is going away");
      measurements.push(value);
    },
    state: () => ({ sessionScope: null }),
    setActiveSession: () => {},
  } as never;
  const dispose = installBrowserIpc({ window, pane, promptTaskRefresh: () => {} });
  return { measurements, webContents, dispose };
}

/** Calls the synchronous channel the way Electron does, and reports what it answered. */
function hideNow(sender: unknown): unknown {
  const listener = listeners.get("iab:hide-now");
  if (!listener) throw new Error("iab:hide-now was never registered");
  const event: { sender: unknown; returnValue?: unknown } = { sender };
  listener(event);
  return event.returnValue;
}

describe("iab:hide-now", () => {
  it("is registered as a synchronous channel, not an invoke", () => {
    // If this ever becomes a `handle`, the renderer's layout effect goes back to *starting* a hide
    // and hoping — which is the bug this channel exists to close.
    const { dispose } = harness();
    expect(listeners.has("iab:hide-now")).toBe(true);
    expect(handlers.has("iab:hide-now")).toBe(false);
    dispose();
  });

  it("hides the view and answers true, before returning", () => {
    const { measurements, webContents, dispose } = harness();
    expect(hideNow(webContents)).toBe(true);
    // The hide has already happened by the time the call returns — that is the whole guarantee.
    expect(measurements).toEqual([null]);
    dispose();
  });

  it("refuses a sender that is not the application window", () => {
    // Same rule as every other channel here: a page inside the pane has no preload and cannot reach
    // this, but the check does not depend on that being true.
    const { measurements, dispose } = harness();
    expect(hideNow({ id: 99 })).toBe(false);
    expect(measurements).toEqual([]);
    dispose();
  });

  it("answers false rather than throwing when the pane cannot be hidden", () => {
    // A synchronous channel that throws leaves the renderer with an exception inside a layout
    // effect. `false` is a value the switch already knows what to do with: stop, and confirm no
    // scope, which keeps every tab hidden.
    const { webContents, dispose } = harness({ failHide: true });
    expect(hideNow(webContents)).toBe(false);
    dispose();
  });

  it("is taken off again on dispose", () => {
    // `handle` and `on` are different registries, so removing the handlers is not enough: a second
    // install would leave two listeners answering the same synchronous call.
    const { dispose } = harness();
    dispose();
    expect(listeners.has("iab:hide-now")).toBe(false);
  });
});
