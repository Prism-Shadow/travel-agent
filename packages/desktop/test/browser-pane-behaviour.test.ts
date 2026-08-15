/**
 * BrowserPane's decisions (src/browser-pane.ts), against a fake Electron surface.
 *
 * `WebContentsView` and `BrowserWindow` are replaced with doubles because the behaviour under test
 * is not Chromium's — it is whether the pane opens itself when the agent needs it, whether a bad
 * URL is refused loudly, and whether a rebuilt view is positioned rather than skipped as
 * "unchanged". Each of those was a real defect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const views: FakeView[] = [];

class FakeContents {
  destroyed = false;
  private url = "";
  private title = "";
  loadingNow = false;
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  readonly debugger = {
    isAttached: () => false,
    attach: vi.fn(),
    sendCommand: vi.fn(async () => ({ targetInfo: { targetId: "T1" } })),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  };
  loadURL = vi.fn(async (next: string) => {
    this.url = next;
  });
  setWindowOpenHandler = vi.fn();
  on(event: string, handler: (...args: unknown[]) => void): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(handler);
    this.listeners.set(event, existing);
    return this;
  }
  once = vi.fn();
  off = vi.fn();
  isDestroyed(): boolean {
    return this.destroyed;
  }
  getURL(): string {
    return this.url;
  }
  getTitle(): string {
    return this.title;
  }
  isLoading(): boolean {
    return this.loadingNow;
  }
  close = vi.fn();
  emit(event: string): void {
    for (const handler of this.listeners.get(event) ?? []) handler();
  }
}

class FakeView {
  readonly webContents = new FakeContents();
  setBounds = vi.fn();
  setVisible = vi.fn();
  constructor() {
    views.push(this);
  }
}

vi.mock("electron", () => ({
  WebContentsView: class {
    constructor() {
      return new FakeView() as unknown as object;
    }
  },
  session: { fromPartition: () => ({}) },
}));

vi.mock("../src/session-partition.js", () => ({
  iabWebPreferences: () => ({}),
}));

const { BrowserPane, isNavigableUrl } = await import("../src/browser-pane.js");

function makeWindow() {
  const resizeHandlers: Array<() => void> = [];
  return {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentSize: () => [1600, 900],
    on: (event: string, handler: () => void) => {
      if (event === "resize") resizeHandlers.push(handler);
    },
    resize: () => resizeHandlers.forEach((handler) => handler()),
  };
}

function makePane() {
  const states: Array<Record<string, unknown>> = [];
  const window = makeWindow();
  const pane = new (
    BrowserPane as unknown as new (options: unknown) => InstanceType<typeof BrowserPane>
  )({
    window: window as never,
    onState: (state: unknown) => states.push(state as Record<string, unknown>),
  });
  return { pane, states, window };
}

beforeEach(() => {
  views.length = 0;
});

describe("isNavigableUrl", () => {
  it.each(["https://ctrip.com/", "http://localhost:3000/x"])("allows %s", (url) => {
    expect(isNavigableUrl(url)).toBe(true);
  });

  it.each([
    "file:///etc/passwd",
    "chrome://settings",
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "not a url",
    "",
  ])("refuses %s", (url) => {
    expect(isNavigableUrl(url)).toBe(false);
  });
});

describe("openTabForAgent", () => {
  it("returns the view's target id", async () => {
    const { pane } = makePane();
    await expect(pane.openTabForAgent()).resolves.toBe("T1");
  });

  it("opens the pane so the user sees what the agent is doing", async () => {
    // The regression: the agent could drive a browser the user had never opened, invisibly.
    const { pane, states } = makePane();
    expect(pane.state().requested).toBe(false);
    await pane.openTabForAgent("https://ctrip.com/");
    expect(pane.state().requested).toBe(true);
    expect(states.some((state) => state.requested === true)).toBe(true);
  });

  it("rejects a URL it cannot navigate rather than silently opening blank", async () => {
    // Returning a target id for a page that is not where the agent believes it is would make every
    // later assertion be about the wrong document.
    const { pane } = makePane();
    await expect(pane.openTabForAgent("file:///etc/passwd")).rejects.toThrow(/http and https/);
  });

  it("treats undefined as 'leave it blank'", async () => {
    const { pane } = makePane();
    await pane.openTabForAgent();
    const view = views[0]!;
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(view.webContents.loadURL).toHaveBeenCalledWith("about:blank");
  });
});

describe("layout", () => {
  it("positions and shows the view once measured and requested", () => {
    const { pane } = makePane();
    pane.setRequested(true);
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    const view = views[0]!;
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 800, y: 40, width: 700, height: 800 });
  });

  it("hides the view while the renderer says it is occluded", () => {
    const { pane } = makePane();
    pane.setRequested(true);
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    pane.setOccluded(true);
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("positions a rebuilt view even at identical bounds", async () => {
    // The regression: lastLayout survived the old view, so an identical rectangle was skipped as
    // "unchanged" and the fresh view was never positioned or shown.
    const { pane } = makePane();
    pane.setRequested(true);
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    const first = views[0]!;
    expect(first.setBounds).toHaveBeenCalled();

    first.webContents.destroyed = true;
    first.webContents.emit("destroyed");

    await pane.openTabForAgent();
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    const second = views[1]!;
    expect(second).not.toBe(first);
    expect(second.setBounds).toHaveBeenCalledWith({ x: 800, y: 40, width: 700, height: 800 });
    expect(second.setVisible).toHaveBeenLastCalledWith(true);
  });

  it("recomputes when the window resizes without a new measurement", () => {
    const { pane, window } = makePane();
    pane.setRequested(true);
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    views[0]!.setBounds.mockClear();
    window.resize();
    // Same window size here, so nothing should change — the assertion is that it did not throw and
    // did not push a redundant update.
    expect(views[0]!.setBounds).not.toHaveBeenCalled();
  });
});

describe("state", () => {
  it("reports requested so the renderer can follow main rather than guess", () => {
    const { pane } = makePane();
    expect(pane.state().requested).toBe(false);
    pane.setRequested(true);
    expect(pane.state().requested).toBe(true);
  });

  it("reports no view before one is created", () => {
    const { pane } = makePane();
    expect(pane.state().present).toBe(false);
  });
});

describe("clearing the measurement", () => {
  it("hides the view when the renderer says the hole is gone", () => {
    // The regression: main kept the last rectangle, so a closed pane left the view sitting on top
    // of the conversation, and a later reopen flashed at the stale bounds.
    const { pane } = makePane();
    pane.setRequested(true);
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    const view = views[0]!;
    expect(view.setVisible).toHaveBeenLastCalledWith(true);

    pane.setMeasurement(null);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("stays hidden until a fresh measurement arrives after reopening", () => {
    const { pane } = makePane();
    pane.setRequested(true);
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    pane.setMeasurement(null);
    const view = views[0]!;
    view.setBounds.mockClear();

    pane.setRequested(false);
    pane.setRequested(true);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(view.setBounds).not.toHaveBeenCalled();

    pane.setMeasurement({ x: 900, y: 40, width: 600, height: 800 });
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 900, y: 40, width: 600, height: 800 });
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
  });

  it("hides the view when the pane is closed even with a measurement on file", () => {
    const { pane } = makePane();
    pane.setRequested(true);
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    pane.setRequested(false);
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(false);
  });
});
