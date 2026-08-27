/**
 * BrowserPane's decisions (src/browser-pane.ts), against a fake Electron surface.
 *
 * `WebContentsView` and `BrowserWindow` are replaced with doubles because the behaviour under test
 * is not Chromium's — it is whether a tab belongs to the right conversation, whether a task that
 * has ended can still write to a page, whether a crash rebuilds one tab or loses the rest. Each of
 * those is a rule the tab strip only *draws*; this is where it is enforced.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const views: FakeView[] = [];
const clearIabSession = vi.fn(async () => {});

/** Set before building a view whose debugger should refuse to answer. */
let nextDebuggerAttached = true;

class FakeDebugger {
  targetId = "T1";
  attached = nextDebuggerAttached;
  isAttached = (): boolean => this.attached;
  attach = vi.fn();
  sendCommand = vi.fn(async (method: string) => {
    if (method === "Target.getTargetInfo") {
      if (!this.attached) throw new Error("debugger is not attached");
      return { targetInfo: { targetId: this.targetId } };
    }
    return {};
  });
  on = vi.fn();
  once = vi.fn();
  off = vi.fn();
}

class FakeContents {
  destroyed = false;
  private url = "";
  private title = "";
  loadingNow = false;
  backAvailable = false;
  forwardAvailable = false;
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  readonly debugger = new FakeDebugger();
  readonly navigationHistory = {
    canGoBack: (): boolean => this.backAvailable,
    canGoForward: (): boolean => this.forwardAvailable,
    goBack: vi.fn(),
    goForward: vi.fn(),
  };
  loadURL = vi.fn(async (next: string) => {
    this.url = next;
  });
  reload = vi.fn();
  stop = vi.fn();
  setZoomFactor = vi.fn();
  capturePage = vi.fn(async () => ({
    isEmpty: () => false,
    toDataURL: () => "data:image/png;base64,frozen-page",
  }));
  setWindowOpenHandler = vi.fn();
  windowOpenHandler:
    | ((details: { url: string }) => {
        action: string;
        createWindow?: (options?: { webContents?: unknown }) => unknown;
      })
    | null = null;
  on(event: string, handler: (...args: unknown[]) => void): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(handler);
    this.listeners.set(event, existing);
    return this;
  }
  once = vi.fn();
  /**
   * A real removal, not a spy.
   *
   * The pane detaches its listeners before destroying a view it is replacing, and a double that
   * only *records* the removal would let the old view's `destroyed` handler delete the tab the
   * rebuild just gave a working replacement to — turning a crash recovery test into a crash.
   */
  off(event: string, handler: (...args: unknown[]) => void): this {
    const existing = this.listeners.get(event) ?? [];
    const index = existing.indexOf(handler);
    if (index >= 0) existing.splice(index, 1);
    return this;
  }
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
  /**
   * False to model a `WebContents` that has been closed and detached but does not *say* it is
   * destroyed — which Electron does not promise, and which is why the pane cannot use
   * `isDestroyed()` alone to mean "this tab has no view".
   */
  closeDestroys = true;
  close = vi.fn(() => {
    if (!this.closeDestroys) return;
    this.destroyed = true;
    this.emit("destroyed");
  });
  emit(event: string, ...args: unknown[]): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler(undefined, ...args);
  }
}

class FakeView {
  readonly webContents: FakeContents;
  setBounds = vi.fn();
  setVisible = vi.fn();
  /** A provided contents models `WebContentsView({ webContents })` adopting Chromium's guest. */
  constructor(contents?: FakeContents) {
    this.webContents = contents ?? new FakeContents();
    views.push(this);
    this.webContents.setWindowOpenHandler.mockImplementation(
      (
        handler: (details: { url: string }) => {
          action: string;
          createWindow?: (options?: { webContents?: unknown }) => unknown;
        },
      ) => {
        this.webContents.windowOpenHandler = handler;
      },
    );
  }
}

/**
 * How many more views may be built before construction starts failing.
 *
 * `new WebContentsView()` throwing is not hypothetical — no GPU process, an exhausted handle table,
 * a window torn down underneath — and it is the failure the restore path has to survive without
 * losing the pages it was rebuilding.
 */
let viewBudget: number | null = null;

vi.mock("electron", () => ({
  WebContentsView: class {
    constructor(options?: { webContents?: unknown }) {
      if (viewBudget !== null) {
        if (viewBudget <= 0) throw new Error("view creation failed");
        viewBudget -= 1;
      }
      return new FakeView(options?.webContents as FakeContents | undefined) as unknown as object;
    }
  },
  session: { fromPartition: () => ({}) },
}));

vi.mock("../src/session-partition.js", () => ({
  iabWebPreferences: () => ({}),
  clearIabSession: () => clearIabSession(),
  setDownloadDirectoryResolver: (resolver: (contents: unknown) => string | null) => {
    downloadResolver = resolver;
  },
}));

/** The resolver the pane installed, so a test can ask where a given view's downloads would go. */
let downloadResolver: ((contents: unknown) => string | null) | null = null;

const { BrowserPane, isNavigableUrl, selectFaviconUrl } = await import("../src/browser-pane.js");
type Pane = InstanceType<typeof BrowserPane>;

const tempDirs: string[] = [];

function tempCheckpoint(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iab-pane-"));
  tempDirs.push(dir);
  return path.join(dir, "tabs.json");
}

function makeWindow() {
  const resizeHandlers: Array<() => void> = [];
  return {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentSize: () => [1600, 900],
    on: (event: string, handler: () => void) => {
      if (event === "resize") resizeHandlers.push(handler);
    },
    off: vi.fn(),
    resize: () => resizeHandlers.forEach((handler) => handler()),
  };
}

function makePane(
  options: {
    checkpointPath?: string;
    log?: (message: string) => void;
    initialBackends?: Record<string, "iab" | "extension">;
    extensionBackendAvailable?: boolean;
    onBackendChange?: (sessionId: string, backend: "iab" | "extension") => boolean;
    onBackendSelected?: (backend: "iab" | "extension") => void;
  } = {},
) {
  const states: Array<Record<string, unknown>> = [];
  const closedByUser: Array<Record<string, unknown>> = [];
  const window = makeWindow();
  const pane = new (BrowserPane as unknown as new (opts: unknown) => Pane)({
    window: window as never,
    onState: (state: unknown) => states.push(state as Record<string, unknown>),
    onTabClosedByUser: (notice: unknown) => closedByUser.push(notice as Record<string, unknown>),
    ...options,
  });
  return { pane, states, window, closedByUser };
}

/**
 * The common setup: one conversation on screen, the pane measured and open, and the harness's own
 * report that a task is running in it.
 *
 * That last part is not scaffolding — it is the authority. The pane opens tabs only for a turn the
 * harness says is live, so a test that skipped it would be testing the refusal path.
 */
async function paneWithSession(sessionId = "session-1", taskId = "task-a") {
  const harness = makePane();
  harness.pane.setActiveSession(sessionId);
  harness.pane.setRequested(true);
  harness.pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
  reportRunning(harness.pane, sessionId, taskId);
  return harness;
}

/**
 * The server's answer about one conversation, applied the way the supervisor applies it.
 *
 * The only way a task gains authority, which is the point: there is no renderer message, no flag
 * and no test seam that can make a turn live. **One** running turn per conversation, because that
 * is all a conversation can have — naming a second here ends the first, exactly as it would in the
 * app when the harness moves on.
 */
function reportRunning(
  pane: Pane,
  sessionId: string,
  running: string | null,
  lastFinished: { taskId: string; failed: boolean } | null = null,
): void {
  pane.applyTaskState([
    { sessionId, projectId: "project-1", agentId: "agent-1", running, lastFinished },
  ]);
}

beforeEach(() => {
  views.length = 0;
  viewBudget = null;
  nextDebuggerAttached = true;
  clearIabSession.mockClear();
});

afterEach(() => {
  // The directory itself, not its parent — its parent is the OS temp directory.
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
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

describe("tab favicons", () => {
  it("accepts browser-renderable image URLs and refuses executable or oversized values", () => {
    expect(selectFaviconUrl(["https://example.com/favicon.ico"])).toBe(
      "https://example.com/favicon.ico",
    );
    expect(selectFaviconUrl(["data:image/png;base64,cGVuZ3Vpbg=="])).toBe(
      "data:image/png;base64,cGVuZ3Vpbg==",
    );
    expect(
      selectFaviconUrl([
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        `data:image/png;base64,${"a".repeat(256 * 1024)}`,
      ]),
    ).toBeNull();
  });

  it("publishes the page favicon and clears it before a new main-frame navigation", () => {
    const { pane } = makePane();
    pane.setActiveSession("session-1");
    pane.openTabForUser("https://example.com/");

    views[0]!.webContents.emit("page-favicon-updated", [
      "javascript:alert(1)",
      "https://example.com/favicon.png",
    ]);
    expect(pane.state().tabs[0]?.faviconUrl).toBe("https://example.com/favicon.png");

    // A subframe does not own the tab's identity.
    views[0]!.webContents.emit("did-start-navigation", "https://ads.example/", false, false);
    expect(pane.state().tabs[0]?.faviconUrl).toBe("https://example.com/favicon.png");

    views[0]!.webContents.emit("did-start-navigation", "https://next.example/", false, true);
    expect(pane.state().tabs[0]?.faviconUrl).toBeNull();
  });
});

describe("pane visibility per conversation", () => {
  it("shows no pane when no conversation is on screen", () => {
    expect(makePane().pane.state().requested).toBe(false);
  });

  it("does not leak one conversation's open pane into another", () => {
    // The old single flag meant opening the browser anywhere opened it everywhere; a
    // conversation that never used the browser must not greet the user with an empty pane.
    const { pane } = makePane();
    pane.setActiveSession("session-1");
    pane.openTabForUser("https://ctrip.com/");
    expect(pane.state().requested).toBe(true);
    pane.setActiveSession("session-2");
    expect(pane.state().requested).toBe(false);
    pane.setActiveSession("session-1");
    expect(pane.state().requested).toBe(true);
  });

  it("dropScope removes a deleted conversation's tabs, choices and dormant pages, and no one else's", async () => {
    // Deletion is invisible to the pane without this call (issue 0009): the strip's live views,
    // their relay claims, and the per-scope choices would all outlive the conversation.
    const { pane } = await paneWithSession("session-keep", "task-keep");
    await pane.openTabForAgent({ sessionId: "session-keep", taskId: "task-keep" });
    reportRunning(pane, "session-doomed", "task-doomed");
    await pane.openTabForAgent({ sessionId: "session-doomed", taskId: "task-doomed" });
    const doomedContents = views[views.length - 1]!.webContents;

    pane.dropScope("session-doomed");
    expect(doomedContents.close).toHaveBeenCalled();
    pane.setActiveSession("session-doomed");
    expect(pane.state().tabs).toHaveLength(0);
    expect(pane.state().requested).toBe(false);
    pane.setActiveSession("session-keep");
    expect(pane.state().tabs).toHaveLength(1);
    expect(pane.state().requested).toBe(true);
  });

  it("remembers an explicit close for that conversation only", () => {
    const { pane } = makePane();
    pane.setActiveSession("session-1");
    pane.openTabForUser("https://ctrip.com/");
    pane.setRequested(false);
    pane.setActiveSession("session-2");
    pane.openTabForUser("https://fliggy.com/");
    expect(pane.state().requested).toBe(true);
    pane.setActiveSession("session-1");
    // Its pages are still there; the user said "closed", and that choice is this conversation's.
    expect(pane.state().tabs).toHaveLength(1);
    expect(pane.state().requested).toBe(false);
  });
});

describe("page zoom", () => {
  it("publishes and applies the selected tab's scale", () => {
    const { pane } = makePane();
    pane.setActiveSession("session-1");
    const tabId = pane.openTabForUser("https://ctrip.com/");

    expect(pane.state().tabs[0]?.zoomFactor).toBe(1);
    pane.setZoom(tabId, 1.25);

    expect(views[0]?.webContents.setZoomFactor).toHaveBeenLastCalledWith(1.25);
    expect(pane.state().tabs[0]?.zoomFactor).toBe(1.25);
  });

  it("restores the scale when a crashed page is rebuilt", () => {
    const { pane } = makePane();
    pane.setActiveSession("session-1");
    const tabId = pane.openTabForUser("https://ctrip.com/");
    pane.setZoom(tabId, 0.8);

    views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });

    expect(views[1]?.webContents.setZoomFactor).toHaveBeenCalledWith(0.8);
    expect(pane.state().tabs[0]?.zoomFactor).toBe(0.8);
  });

  it.each([0.49, 2.01, Number.NaN])("refuses an unsafe factor of %s", (factor) => {
    const { pane } = makePane();
    pane.setActiveSession("session-1");
    const tabId = pane.openTabForUser();
    expect(() => pane.setZoom(tabId, factor)).toThrow(/between 0.5 and 2/);
  });
});

describe("menu preview", () => {
  it("captures the visible active page without changing its bounds", async () => {
    const { pane } = makePane();
    pane.setActiveSession("session-1");
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    pane.openTabForUser("https://ctrip.com/");
    const before = views[0]?.setBounds.mock.lastCall;

    await expect(pane.captureActivePage()).resolves.toEqual({
      dataUrl: "data:image/png;base64,frozen-page",
      bounds: { x: 800, y: 40, width: 700, height: 800 },
    });
    expect(views[0]?.webContents.capturePage).toHaveBeenCalledOnce();
    expect(views[0]?.setBounds.mock.lastCall).toEqual(before);
  });

  it("does not capture a page that is hidden or belongs to the Chrome backend", async () => {
    const { pane } = makePane();
    pane.setActiveSession("session-1");
    pane.openTabForUser("https://ctrip.com/");

    await expect(pane.captureActivePage()).resolves.toBeNull();
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    await pane.setBackend("extension");
    await expect(pane.captureActivePage()).resolves.toBeNull();
    expect(views[0]?.webContents.capturePage).not.toHaveBeenCalled();
  });
});

describe("openTabForAgent", () => {
  it("returns the view's target id", async () => {
    const { pane } = await paneWithSession();
    await expect(pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" })).resolves.toBe(
      "T1",
    );
  });

  it("opens the pane so the user sees what the agent is doing", async () => {
    // The regression: the agent could drive a browser the user had never opened, invisibly.
    const { pane, states } = makePane();
    pane.setActiveSession("session-1");
    reportRunning(pane, "session-1", "a");
    pane.setRequested(false);
    expect(pane.state().requested).toBe(false);
    await pane.openTabForAgent({ url: "https://ctrip.com/", sessionId: "session-1", taskId: "a" });
    expect(pane.state().requested).toBe(true);
    expect(states.some((state) => state.requested === true)).toBe(true);
  });

  it("mints a genuinely new tab per call", async () => {
    // Phase 1 answered every call with its single view, which made `tabs.open()` idempotent by
    // accident. An agent opening a results page and a detail page must get two tabs.
    const { pane } = await paneWithSession("session-1", "a");
    views[0]?.webContents.debugger;
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    if (views[0]) views[0].webContents.debugger.targetId = "T1";
    if (views[1]) views[1].webContents.debugger.targetId = "T2";
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    expect(pane.state().tabs).toHaveLength(2);
  });

  it("discards the tab when no debugger ever attaches", async () => {
    // A tab an agent cannot address is not a tab: it is a blank view in the strip with a
    // running-task lock behind it, and the lock would hold the backend switch shut forever.
    vi.useFakeTimers();
    try {
      const { pane } = await paneWithSession();
      // Every view built from here on has a debugger that refuses to answer.
      nextDebuggerAttached = false;
      const failing = pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
      const settled = expect(failing).rejects.toThrow(/could not read a CDP target id/);
      await vi.advanceTimersByTimeAsync(2000);
      await settled;

      // The unusable view is gone rather than sitting blank in the strip.
      expect(pane.state().tabs).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to invent an identity", async () => {
    // Not a null, not a default: a tab with no session appears in no strip, and one with no task is
    // never subject to the end-of-task rules.
    const { pane } = await paneWithSession("session-1", "a");
    await expect(pane.openTabForAgent({ sessionId: "", taskId: "a" } as never)).rejects.toThrow(
      /sessionId/,
    );
    await expect(
      pane.openTabForAgent({ sessionId: "session-1", taskId: "  " } as never),
    ).rejects.toThrow(/taskId/);
  });

  it("rejects a URL it cannot navigate rather than silently opening blank", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await expect(
      pane.openTabForAgent({ url: "file:///etc/passwd", sessionId: "session-1", taskId: "a" }),
    ).rejects.toThrow(/http and https/);
  });

  it("starts hidden work in a conversation the user is not looking at", async () => {
    // The tab lands in the agent's own conversation's strip — hidden now, shown the moment the
    // user opens that conversation. The displayed conversation's chat is untouched: no tab in
    // its strip and no pane popped over it (the old gate refused this outright, and its stale
    // enforcement key locked out conversations the user *was* looking at — issue 0008).
    // The viewer has never opened the browser: the strongest form of "must not pop the pane".
    const { pane } = makePane();
    pane.setActiveSession("session-visible");
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    reportRunning(pane, "session-other", "task-elsewhere");
    await pane.openTabForAgent({ sessionId: "session-other", taskId: "task-elsewhere" });
    expect(pane.state().tabs).toHaveLength(0);
    expect(pane.state().requested).toBe(false);
    pane.setActiveSession("session-other");
    expect(pane.state().tabs).toHaveLength(1);
    expect(pane.state().requested).toBe(true);
  });

  it("scopes the tab to the agent's conversation", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    pane.setActiveSession("session-2");
    expect(pane.state().tabs).toHaveLength(0);
    pane.setActiveSession("session-1");
    expect(pane.state().tabs).toHaveLength(1);
  });

  it("keeps a running task's tabs when the user navigates away", async () => {
    // Starting hidden is refused; *continuing* while the user reads another conversation is
    // ordinary. The tabs stay in their own strip and come back when the user does.
    const { pane } = await paneWithSession("session-1");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.setActiveSession("session-2");
    expect(pane.mayDrive(views[0]!.webContents as never, "task-a")).toEqual({ allowed: true });
    pane.setActiveSession("session-1");
    expect(pane.state().tabs).toHaveLength(1);
  });
});

describe("scoping", () => {
  it("shows no tabs at all when no conversation is selected", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    pane.setActiveSession(null);
    expect(pane.state().tabs).toEqual([]);
    expect(pane.state().present).toBe(false);
  });

  it("keeps a released tab in its own conversation rather than making it global", async () => {
    const { pane } = await paneWithSession("session-1");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "committed");
    pane.endTask("task-a", { abnormal: false });

    expect(pane.state().tabs[0]?.ownedByTask).toBeNull();
    pane.setActiveSession("session-2");
    expect(pane.state().tabs).toHaveLength(0);
    pane.setActiveSession("session-1");
    expect(pane.state().tabs).toHaveLength(1);
  });

  it("remembers each conversation's selected tab", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    const first = pane.state().activeTabId;
    pane.setActiveSession("session-2");
    reportRunning(pane, "session-2", "b");
    await pane.openTabForAgent({ sessionId: "session-2", taskId: "b" });

    pane.setActiveSession("session-2");
    expect(pane.state().activeTabId).not.toBe(first);
    pane.setActiveSession("session-1");
    expect(pane.state().activeTabId).toBe(first);
  });
});

describe("browser backend choice", () => {
  it("makes IAB explicit when a desktop conversation becomes active", () => {
    const changes: Array<[string, string]> = [];
    const { pane } = makePane({
      onBackendChange: (sessionId, backend) => {
        changes.push([sessionId, backend]);
        return true;
      },
    });

    pane.setActiveSession("session-1");

    expect(pane.state().backend).toBe("iab");
    expect(changes).toEqual([["session-1", "iab"]]);
  });

  it("persists the default IAB choice before promoting a draft into its first task", () => {
    const changes: Array<[string, string]> = [];
    const { pane } = makePane({
      onBackendChange: (sessionId, backend) => {
        changes.push([sessionId, backend]);
        return true;
      },
    });
    pane.setActiveSession("draft-scope-0123456789abcdef0123456789abcdef");

    pane.reassignActiveSession("session-created");

    expect(changes).toEqual([["session-created", "iab"]]);
    expect(pane.state().backend).toBe("iab");
  });

  it("keeps a draft choice in memory and persists it only under the real conversation id", () => {
    const draft = "draft-scope-0123456789abcdef0123456789abcdef";
    const changes: Array<[string, string]> = [];
    const { pane } = makePane({
      onBackendChange: (sessionId, backend) => {
        changes.push([sessionId, backend]);
        return true;
      },
    });
    pane.setActiveSession(draft);

    pane.setBackend("extension");
    expect(changes).toEqual([]);

    pane.reassignActiveSession("session-created");
    expect(changes).toEqual([["session-created", "extension"]]);
    expect(pane.state().backend).toBe("extension");
  });

  it("keeps a stored Chrome choice visible when Chrome is temporarily unavailable", () => {
    const changes: Array<[string, string]> = [];
    const { pane } = makePane({
      initialBackends: { "session-1": "extension" },
      extensionBackendAvailable: false,
      onBackendChange: (sessionId, backend) => {
        changes.push([sessionId, backend]);
        return true;
      },
    });

    pane.setActiveSession("session-1");

    expect(pane.state()).toMatchObject({
      backend: "extension",
      extensionBackendAvailable: false,
    });
    expect(changes).toEqual([]);
  });

  it("lets the user explicitly switch an unavailable Chrome conversation back to IAB", () => {
    const changes: Array<[string, string]> = [];
    const selected: string[] = [];
    const { pane } = makePane({
      initialBackends: { "session-1": "extension" },
      extensionBackendAvailable: false,
      onBackendChange: (sessionId, backend) => {
        changes.push([sessionId, backend]);
        return true;
      },
      onBackendSelected: (backend) => selected.push(backend),
    });
    pane.setActiveSession("session-1");

    pane.setBackend("iab");

    expect(pane.state().backend).toBe("iab");
    expect(changes.at(-1)).toEqual(["session-1", "iab"]);
    expect(selected).toEqual(["iab"]);
  });

  it("does not change the UI when persistence fails", () => {
    const { pane } = makePane({
      initialBackends: { "session-1": "iab" },
      onBackendChange: () => false,
    });
    pane.setActiveSession("session-1");

    expect(() => pane.setBackend("extension")).toThrow(/could not be saved/i);
    expect(pane.state().backend).toBe("iab");
  });

  it("does not promote a draft when the real conversation choice cannot be persisted", () => {
    const draft = "draft-scope-0123456789abcdef0123456789abcdef";
    const { pane } = makePane({ onBackendChange: () => false });
    pane.setActiveSession(draft);

    expect(() => pane.reassignActiveSession("session-created")).toThrow(/could not be saved/i);
    expect(pane.state()).toMatchObject({ sessionScope: draft, backend: "iab" });
  });

  it("opens setup when the user actively selects Chrome, including reselecting it", () => {
    const selected: string[] = [];
    const changes: Array<[string, string]> = [];
    const { pane } = makePane({
      initialBackends: { "session-1": "iab" },
      onBackendChange: (sessionId, backend) => {
        changes.push([sessionId, backend]);
        return true;
      },
      onBackendSelected: (backend) => selected.push(backend),
    });
    pane.setActiveSession("session-1");

    pane.setBackend("extension");
    pane.setBackend("extension");

    expect(selected).toEqual(["extension", "extension"]);
    expect(changes).toEqual([
      ["session-1", "extension"],
      ["session-1", "extension"],
    ]);
  });
});

describe("draft browser scopes", () => {
  const draftScope = "draft-scope-0123456789abcdef0123456789abcdef";

  it("lets the user browse before a conversation exists without polling the draft as a Session", () => {
    const { pane } = makePane();
    pane.setActiveSession(draftScope);
    const tabId = pane.openTabForUser("https://example.com/before-first-message");

    expect(pane.state()).toMatchObject({ sessionScope: draftScope, activeTabId: tabId });
    expect(pane.state().tabs[0]?.url).toBe("https://example.com/before-first-message");
    expect(pane.sessionsOfInterest()).not.toContain(draftScope);
  });

  it("promotes the complete draft strip before the first task starts", () => {
    const { pane } = makePane();
    pane.setActiveSession(draftScope);
    const first = pane.openTabForUser("https://example.com/one");
    pane.openTabForUser("https://example.com/two");
    pane.selectTab(first);

    expect(pane.reassignActiveSession("session-created")).toBe("session-created");
    expect(pane.state()).toMatchObject({
      sessionScope: "session-created",
      activeTabId: first,
    });
    expect(pane.state().tabs).toHaveLength(2);
    expect(pane.sessionsOfInterest()).toContain("session-created");

    reportRunning(pane, "session-created", "task-first");
    expect(pane.state().backendLocked).toBe(true);
  });

  it("allows only the exact one-shot rollback until the route confirms the new Session", () => {
    const { pane } = makePane();
    pane.setActiveSession(draftScope);
    pane.openTabForUser("https://example.com/keep-with-draft");

    pane.reassignActiveSession("session-created");
    pane.reassignActiveSession(draftScope);
    expect(pane.state().sessionScope).toBe(draftScope);
    expect(pane.state().tabs).toHaveLength(1);

    pane.reassignActiveSession("session-created");
    pane.setActiveSession("session-created");
    expect(() => pane.reassignActiveSession(draftScope)).toThrow(/only move from the active draft/);
  });

  it("does not merge a draft into a destination that already owns tabs", () => {
    const { pane } = makePane();
    pane.setActiveSession("session-created");
    pane.openTabForUser("https://example.com/existing");
    pane.setActiveSession(draftScope);
    pane.openTabForUser("https://example.com/draft");

    expect(() => pane.reassignActiveSession("session-created")).toThrow(/already has tabs/);
    expect(pane.state().sessionScope).toBe(draftScope);
  });
});

describe("renderer-facing operations", () => {
  it("refuses a tab id from another conversation", async () => {
    // Tab ids are sequential and guessable, and every operation here is destructive or
    // navigational. A renderer must not be able to reach into a conversation that is not on screen.
    const { pane } = await paneWithSession("session-1");
    pane.setActiveSession("session-other");
    reportRunning(pane, "session-other", "a");
    await pane.openTabForAgent({ sessionId: "session-other", taskId: "a" });
    pane.setActiveSession("session-1");
    const hidden = "tab-1";
    expect(() => pane.closeTab(hidden)).toThrow(/current conversation/);
    expect(() => pane.selectTab(hidden)).toThrow(/current conversation/);
    expect(() => pane.reload(hidden)).toThrow(/current conversation/);
    await expect(pane.navigate(hidden, "https://x.example/")).rejects.toThrow();
  });

  it("refuses a new user tab when no conversation is selected", () => {
    const { pane } = makePane();
    expect(() => pane.openTabForUser()).toThrow(/no conversation/);
  });

  it("tells the transport when the user closes a tab an agent was using", async () => {
    const { pane, closedByUser } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    const tabId = pane.state().tabs[0]!.id;
    pane.closeTab(tabId);

    expect(closedByUser).toEqual([
      { tabId, targetId: "T1", sessionScope: "session-1", ownedByTask: "task-a" },
    ]);
  });

  it("says nothing when the closed tab had no owner", async () => {
    const { pane, closedByUser } = await paneWithSession();
    const tabId = pane.openTabForUser();
    pane.closeTab(tabId);
    expect(closedByUser).toEqual([]);
  });

  it("only navigates to http and https", async () => {
    const { pane } = await paneWithSession();
    const tabId = pane.openTabForUser();
    await expect(pane.navigate(tabId, "file:///etc/passwd")).rejects.toThrow(/http and https/);
  });
});

describe("ownership enforcement", () => {
  it("lets the owning task drive its own tab", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    expect(pane.mayDrive(views[0]!.webContents as never, "task-a")).toEqual({ allowed: true });
  });

  it("refuses a task that has ended, even though the tab is still alive", async () => {
    // The point of the whole mechanism: a retained tab stays open on purpose, so nothing else
    // would refuse the write — the executor is connected, the CDP session is valid, the page is
    // there. `ownedByTask` has to be enforced, not merely drawn.
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "committed");
    pane.endTask("task-a", { abnormal: false });

    expect(pane.state().tabs).toHaveLength(1);
    expect(pane.mayDrive(views[0]!.webContents as never, "task-a")).toMatchObject({
      allowed: false,
      reason: "released",
    });
  });

  it("refuses another task, which is what a reused browser session looks like", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    expect(pane.mayDrive(views[0]!.webContents as never, "task-b")).toMatchObject({
      allowed: false,
      reason: "foreign",
      owner: "task-a",
    });
  });

  it("refuses a caller with no task at all", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    expect(pane.mayDrive(views[0]!.webContents as never, undefined)).toMatchObject({
      allowed: false,
    });
  });

  it("refuses a view that is not a tab of ours", async () => {
    const { pane } = await paneWithSession();
    const stranger = new FakeContents();
    expect(pane.mayDrive(stranger as never, "task-a")).toEqual({ allowed: false, reason: "gone" });
  });

  it("lets a new task claim a released tab, and only then write to it", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "committed");
    pane.endTask("task-a", { abnormal: false });
    // The next turn of the same conversation, as the harness reports it.
    reportRunning(pane, "session-1", "task-b", { taskId: "task-a", failed: false });

    expect(pane.mayDrive(views[0]!.webContents as never, "task-b")).toMatchObject({
      allowed: false,
    });
    expect(pane.claimTab("T1", { sessionId: "session-1", taskId: "task-b" })).toMatchObject({
      claimed: true,
    });
    expect(pane.mayDrive(views[0]!.webContents as never, "task-b")).toEqual({ allowed: true });
  });

  it("hands the next turn the tab its predecessor left", async () => {
    // What replaced the old "refuses a claim on a tab another task still owns" case. Authority now
    // comes from the harness, which runs **one** turn per conversation, so a second live task in
    // the same conversation is not a state the server can report: learning about the new turn is
    // the same event as learning the old one ended, and the tab is released in that moment. The
    // `owned` refusal is kept as defence for the instant in between, and for a claim that crosses
    // it, but the reachable behaviour is this one.
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "committed");

    reportRunning(pane, "session-1", "task-b", { taskId: "task-a", failed: false });

    expect(pane.state().tabs[0]?.ownedByTask).toBeNull();
    expect(pane.claimTab("T1", { sessionId: "session-1", taskId: "task-b" })).toMatchObject({
      claimed: true,
    });
  });

  it("refuses a claim from another conversation", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "committed");
    pane.endTask("task-a", { abnormal: false });
    reportRunning(pane, "session-2", "task-b");
    expect(pane.claimTab("T1", { sessionId: "session-2", taskId: "task-b" })).toEqual({
      claimed: false,
      reason: "other-conversation",
    });
  });
});

describe("a task that has ended", () => {
  it("cannot open another tab under its name", async () => {
    // A background command the Agent started outlives the turn and keeps that turn's
    // PENGUIN_TASK_ID in its environment. The id is genuine; the authority is gone.
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.endTask("task-a", { abnormal: false });

    await expect(
      pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" }),
    ).rejects.toThrow(/IAB_TASK_ENDED/);
  });

  it("cannot claim the tab it was left holding", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "committed");
    pane.endTask("task-a", { abnormal: false });

    expect(pane.claimTab("T1", { sessionId: "session-1", taskId: "task-a" })).toEqual({
      claimed: false,
      reason: "task-ended",
    });
  });

  it("cannot be restarted by a stale report naming it as running", async () => {
    // The renderer has no way to name a task at all — its only channel is an argument-free hint —
    // so the strongest stale input the system can produce is a *server* answer that still names the
    // finished turn, from a poll that raced the turn ending. It is applied as ordinary truth, and
    // the pane's own record of the ending is what refuses it.
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.endTask("task-a", { abnormal: false });
    reportRunning(pane, "session-1", "task-a");

    await expect(
      pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" }),
    ).rejects.toThrow(/IAB_TASK_ENDED/);
  });

  it("does not stop the next task", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "committed");
    pane.endTask("task-a", { abnormal: false });
    reportRunning(pane, "session-1", "task-b");

    await expect(
      pane.openTabForAgent({ sessionId: "session-1", taskId: "task-b" }),
    ).resolves.toBeTruthy();
    expect(pane.claimTab("T1", { sessionId: "session-1", taskId: "task-b" })).toMatchObject({
      claimed: true,
    });
  });
});

describe("task authority", () => {
  it("refuses an id the harness has not reported running", async () => {
    // The authority is "is this turn live", not "have I seen this id end". A background command the
    // Agent started keeps a genuine PENGUIN_TASK_ID for as long as it runs.
    const { pane } = await paneWithSession("session-1", "task-live");
    await expect(
      pane.openTabForAgent({ sessionId: "session-1", taskId: "task-never-reported" }),
    ).rejects.toThrow(/IAB_TASK_NOT_LIVE/);
  });

  it("refuses an expired id that has fallen out of the ended-task record", async () => {
    // The record is bounded, so an old id eventually stops being *recognised* as ended. It must
    // still be refused: an earlier version treated "not recently ended" as permission.
    const { pane } = await paneWithSession("session-1", "task-old");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-old" });
    pane.endTask("task-old", { abnormal: false });
    for (let index = 0; index < 300; index += 1) {
      reportRunning(pane, "session-1", `task-filler-${index}`);
      pane.endTask(`task-filler-${index}`, { abnormal: false });
    }

    await expect(
      pane.openTabForAgent({ sessionId: "session-1", taskId: "task-old" }),
    ).rejects.toThrow(/IAB_TASK_NOT_LIVE|IAB_TASK_ENDED/);
  });

  it("refuses every id in a freshly rebuilt pane", async () => {
    // A window closing takes the pane and its tabs with it. A process still holding an id from
    // before must not find a blank slate that accepts it.
    const first = await paneWithSession("session-1", "task-a");
    await first.pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    first.pane.destroy();

    const rebuilt = makePane();
    rebuilt.pane.setActiveSession("session-1");
    rebuilt.pane.setRequested(true);
    await expect(
      rebuilt.pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" }),
    ).rejects.toThrow(/IAB_TASK_NOT_LIVE/);

    // And a turn the harness reports afresh works, so rehydration is all that is needed.
    reportRunning(rebuilt.pane, "session-1", "task-a");
    await expect(
      rebuilt.pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" }),
    ).resolves.toBeTruthy();
  });

  it("refuses a task id used in a conversation it does not belong to", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    pane.setActiveSession("session-2");
    await expect(
      pane.openTabForAgent({ sessionId: "session-2", taskId: "task-a" }),
    ).rejects.toThrow(/IAB_TASK_NOT_LIVE/);
  });

  it("refuses a claim from a task that is not running", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.endTask("task-a", { abnormal: false });

    expect(pane.claimTab("T1", { sessionId: "session-1", taskId: "task-never" })).toEqual({
      claimed: false,
      reason: "task-not-live",
    });
  });
});

describe("resolving a turn's current target (for the vault)", () => {
  it("returns the target id of the tab the turn owns", async () => {
    // What lets a vault secure_fill say `"current"` instead of naming a target.
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    expect(pane.taskTargetId("task-a")).toBe("T1");
    // And the reverse lookup the fill port uses.
    expect(pane.contentsForTarget("T1")).not.toBeNull();
  });

  it("returns null for a turn that owns no live tab — the fail-closed 'no page open'", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    expect(pane.taskTargetId("task-a")).toBeNull();
    expect(pane.taskTargetId(undefined)).toBeNull();
    expect(pane.contentsForTarget("T-nope")).toBeNull();
  });

  it("does not hand one turn's target to another", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    expect(pane.taskTargetId("task-b")).toBeNull();
  });
});

describe("the secret-phase drive gate", () => {
  it("revokes and restores a target's agent drivability, and reports a gone target", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    const contents = pane.taskContents("task-a")!;

    expect(pane.mayDrive(contents, "task-a")).toEqual({ allowed: true });
    expect(pane.setAgentDrivable({ targetId: "T1", drivable: false })).toBe(true);
    // While revoked, even the owning turn is refused — the point of the secret phase.
    expect(pane.mayDrive(contents, "task-a").allowed).toBe(false);
    expect(pane.setAgentDrivable({ targetId: "T1", drivable: true })).toBe(true);
    expect(pane.mayDrive(contents, "task-a")).toEqual({ allowed: true });

    // A target that does not exist cannot be revoked — the vault detach must fail closed on it.
    expect(pane.setAgentDrivable({ targetId: "T-gone", drivable: false })).toBe(false);
  });

  it("closes the tab that owns a target", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    expect(pane.state().tabs).toHaveLength(1);
    await pane.closeTarget("T1");
    expect(pane.state().tabs).toHaveLength(0);
  });
});

describe("downloads", () => {
  it("resolves a tab's downloads to its own conversation's directory", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    // Set by main from the *server's* answer about which Agent this conversation belongs to; the
    // renderer never states it, so a compromised or merely stale window cannot redirect a file.
    pane.setSessionDownloadDir("session-1", {
      directory: "/data/scratch/session-1/downloads",
      root: "/data",
    });
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });

    expect(downloadResolver?.(views[0]!.webContents)).toEqual({
      directory: "/data/scratch/session-1/downloads",
      root: "/data",
    });
  });

  it("keeps a background conversation's directory while another is on screen", async () => {
    // A tab can download while the user reads a different conversation, and the file belongs to the
    // Session that fetched it — not to whatever happens to be in front of the user.
    const { pane } = await paneWithSession("session-1", "task-a");
    pane.setSessionDownloadDir("session-1", {
      directory: "/data/scratch/session-1/downloads",
      root: "/data",
    });
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.setSessionDownloadDir("session-2", {
      directory: "/data/scratch/session-2/downloads",
      root: "/data",
    });
    pane.setActiveSession("session-2");

    expect(downloadResolver?.(views[0]!.webContents)).toEqual({
      directory: "/data/scratch/session-1/downloads",
      root: "/data",
    });
  });

  it("refuses a download from a view that is not a tab", async () => {
    await paneWithSession();
    expect(downloadResolver?.(new FakeContents())).toBeNull();
  });
});

describe("declared outcomes", () => {
  it("keeps the strongest declaration when a task closes several browser sessions", async () => {
    // A task can search in one session and book in another. Letting the last close win means the
    // search's `read_only` erases the booking's `committed`, and the payment page is closed.
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "committed");
    pane.declareTaskOutcome("task-a", "read_only");
    pane.endTask("task-a", { abnormal: false });
    expect(pane.state().tabs).toHaveLength(1);
  });

  it("keeps the strongest declaration in the other order too", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "read_only");
    pane.declareTaskOutcome("task-a", "committed");
    pane.endTask("task-a", { abnormal: false });
    expect(pane.state().tabs).toHaveLength(1);
  });

  it("keeps the final result when every declaration was read-only", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "read_only");
    pane.declareTaskOutcome("task-a", "read_only");
    pane.endTask("task-a", { abnormal: false });
    expect(pane.state().tabs).toHaveLength(1);
    expect(pane.state().tabs[0]?.ownedByTask).toBeNull();
  });

  it("lets an abnormal ending override a read-only declaration", async () => {
    // The agent says how its browser work went *before* the turn is over. A task that declared
    // "just a search" and then aborted did not have a clean read-only run, and the pages it left
    // are the evidence.
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "read_only");
    pane.endTask("task-a", { abnormal: true });
    expect(pane.state().tabs).toHaveLength(1);
    expect(pane.state().tabs[0]?.ownedByTask).toBeNull();
  });

  it("ignores an outcome it does not recognise", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "whatever");
    pane.endTask("task-a", { abnormal: false });
    // Unknown, which retains.
    expect(pane.state().tabs).toHaveLength(1);
  });
});

describe("end of task", () => {
  it("closes intermediate read-only tabs and keeps the final result", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    const [first, second] = pane.state().tabs;
    pane.setRetain(second!.id, true);

    pane.declareTaskOutcome("task-a", "read_only");
    pane.endTask("task-a", { abnormal: false });
    const remaining = pane.state().tabs;
    expect(remaining.map((tab) => tab.id)).toEqual([second!.id]);
    expect(remaining[0]?.ownedByTask).toBeNull();
    expect(first).toBeDefined();
  });

  it("leaves another conversation's task and tabs alone", async () => {
    // Two turns at once means two conversations: a conversation runs one turn at a time, so the
    // "other task" whose tabs must survive is another conversation's, and the end-of-task rules
    // have to stop at that boundary.
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.setActiveSession("session-2");
    reportRunning(pane, "session-2", "task-b");
    await pane.openTabForAgent({ sessionId: "session-2", taskId: "task-b" });

    pane.declareTaskOutcome("task-a", "read_only");
    pane.endTask("task-a", { abnormal: false });

    expect(pane.state().tabs.map((tab) => tab.ownedByTask)).toEqual(["task-b"]);
    pane.setActiveSession("session-1");
    expect(pane.state().tabs).toHaveLength(1);
    expect(pane.state().tabs[0]?.ownedByTask).toBeNull();
  });
});

describe("crash recovery", () => {
  it("rebuilds only the tab that died", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ url: "https://ctrip.com/", sessionId: "session-1", taskId: "a" });
    await pane.openTabForAgent({ url: "https://qunar.com/", sessionId: "session-1", taskId: "a" });
    const before = pane.state().tabs.map((tab) => tab.id);
    const viewCount = views.length;

    views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });

    expect(views.length).toBe(viewCount + 1);
    expect(pane.state().tabs.map((tab) => tab.id)).toEqual(before);
    // The replacement goes back to where the tab was, and the tab keeps its id.
    expect(views[viewCount]!.webContents.loadURL).toHaveBeenCalledWith("https://ctrip.com/");
  });

  it("does not rebuild a tab we are closing ourselves", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    const viewCount = views.length;
    pane.closeTab(pane.state().tabs[0]!.id);
    expect(views.length).toBe(viewCount);
    expect(pane.state().tabs).toEqual([]);
  });
});

describe("popups", () => {
  it("are adopted as real child views, inheriting the opener's conversation and owner", async () => {
    // `createWindow` rather than deny-and-reload: Electron hands the returned WebContents to
    // Chromium as the actual child, so the popup keeps its opener, its name, its referrer and any
    // POST body. Re-navigating a fresh view would lose all four.
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    const response = views[0]!.webContents.windowOpenHandler?.({ url: "https://results.example/" });
    expect(response?.action).toBe("allow");

    const adopted = response?.createWindow?.();
    const tabs = pane.state().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[1]?.ownedByTask).toBe("task-a");
    expect(adopted).toBe(views[1]!.webContents);
  });

  it("does not navigate an adopted popup itself", async () => {
    // Chromium performs the child's first navigation as part of the window.open it came from;
    // loading here would race it and discard the very semantics adoption preserves.
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    views[0]!.webContents
      .windowOpenHandler?.({ url: "https://results.example/" })
      ?.createWindow?.();
    expect(views[1]!.webContents.loadURL).not.toHaveBeenCalled();
  });

  it("adopts an about:blank popup, which is half of the open-then-assign flow", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    const response = views[0]!.webContents.windowOpenHandler?.({ url: "about:blank" });
    expect(response?.action).toBe("allow");
    response?.createWindow?.();
    expect(pane.state().tabs).toHaveLength(2);
  });

  it("are refused when they are not http", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    const result = views[0]!.webContents.windowOpenHandler?.({ url: "file:///etc/passwd" });
    expect(pane.state().tabs).toHaveLength(1);
    expect(result).toEqual({ action: "deny" });
  });

  it("returns Chromium's pre-created guest itself, rebuilding the tab around it (issue 0007)", async () => {
    // An opener-carrying `window.open()` arrives with the popup's WebContents already created,
    // and Electron's guest-window-manager throws in the main process unless `createWindow`
    // returns exactly that object. The pre-built view is discarded; the guest becomes the tab.
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    const guest = new FakeContents();
    const response = views[0]!.webContents.windowOpenHandler?.({ url: "https://login.example/" });
    const returned = response?.createWindow?.({ webContents: guest });
    expect(returned).toBe(guest);
    const tabs = pane.state().tabs;
    expect(tabs).toHaveLength(2);
    // views[1] is the pre-built view the handler made; views[2] wraps the guest. The pre-built
    // one must be gone from the window — an attached view nothing positions is a leak.
    expect(views[2]!.webContents).toBe(guest);
    expect(views[1]!.webContents.close).toHaveBeenCalled();
  });

  it("keeps the identity contract when the guest rebuild fails, closing the popup instead", async () => {
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    const guest = new FakeContents();
    const response = views[0]!.webContents.windowOpenHandler?.({ url: "https://login.example/" });
    viewBudget = 0; // the guest-wrapping WebContentsView construction will throw
    const returned = response?.createWindow?.({ webContents: guest });
    viewBudget = null;
    // Still the guest — anything else is an uncaught main-process exception in Electron — and the
    // popup fails closed: the placeholder tab is gone and the guest is closed on the next tick.
    expect(returned).toBe(guest);
    expect(pane.state().tabs).toHaveLength(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(guest.close).toHaveBeenCalled();
  });
});

describe("failed loads", () => {
  it("records a main-frame failure so the renderer can show it", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    views[0]!.webContents.emit(
      "did-fail-load",
      -105,
      "ERR_NAME_NOT_RESOLVED",
      "https://nope.example/",
      true,
    );
    expect(pane.state().tabs[0]?.failed).toEqual({
      code: -105,
      description: "ERR_NAME_NOT_RESOLVED",
      url: "https://nope.example/",
    });
  });

  it("ignores subframes and aborted navigations", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    views[0]!.webContents.emit("did-fail-load", -105, "sub", "https://ads.example/", false);
    views[0]!.webContents.emit("did-fail-load", -3, "ERR_ABORTED", "https://x.example/", true);
    expect(pane.state().tabs[0]?.failed).toBeNull();
  });

  it("clears the failure when a new load starts", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    views[0]!.webContents.emit("did-fail-load", -105, "x", "https://nope.example/", true);
    views[0]!.webContents.emit("did-start-loading");
    expect(pane.state().tabs[0]?.failed).toBeNull();
  });
});

describe("layout", () => {
  it("hides IAB views while Chrome is selected and restores them when IAB is reselected", () => {
    const { pane } = makePane({ onBackendChange: () => true });
    pane.setActiveSession("session-1");
    pane.setRequested(true);
    pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    pane.openTabForUser("https://example.com/");
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(true);

    pane.setBackend("extension");
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(false);
    expect(pane.state().visible).toBe(false);

    pane.setBackend("iab");
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(true);
  });

  it("positions and shows only the active tab", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });

    expect(views[1]!.setVisible).toHaveBeenLastCalledWith(true);
    expect(views[1]!.setBounds).toHaveBeenLastCalledWith({
      x: 800,
      y: 40,
      width: 700,
      height: 800,
    });
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("swaps which view paints when the selection changes", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    pane.selectTab(pane.state().tabs[0]!.id);

    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(true);
    expect(views[1]!.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("hides the view while the renderer says it is occluded", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    pane.setOccluded(true);
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("hides the view when the renderer says the hole is gone", async () => {
    // The regression: main kept the last rectangle, so a closed pane left the view sitting on top
    // of the conversation, and a later reopen flashed at the stale bounds.
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    pane.setMeasurement(null);
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("positions a rebuilt view even at identical bounds", async () => {
    // The regression: lastLayout survived the old view, so an identical rectangle was skipped as
    // "unchanged" and the fresh view was never positioned or shown.
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });
    const rebuilt = views[views.length - 1]!;
    expect(rebuilt.setBounds).toHaveBeenCalledWith({ x: 800, y: 40, width: 700, height: 800 });
    expect(rebuilt.setVisible).toHaveBeenLastCalledWith(true);
  });
});

describe("shortcut entitlement", () => {
  it("claims the keyboard only with the pane open, a conversation selected and nothing over it", async () => {
    const { pane } = makePane();
    expect(pane.acceptsShortcuts()).toBe(false);
    pane.setActiveSession("session-1");
    // An untouched conversation shows no pane, so it claims no keys either.
    expect(pane.acceptsShortcuts()).toBe(false);
    pane.setRequested(true);
    expect(pane.acceptsShortcuts()).toBe(true);
    pane.setRequested(false);
    expect(pane.acceptsShortcuts()).toBe(false);
    pane.setRequested(true);
    expect(pane.acceptsShortcuts()).toBe(true);
    pane.setOccluded(true);
    expect(pane.acceptsShortcuts()).toBe(false);
    pane.setOccluded(false);
    pane.setActiveSession(null);
    expect(pane.acceptsShortcuts()).toBe(false);
  });
});

describe("profile and handoff", () => {
  it("refuses to clear the profile while a task is using the browser", async () => {
    // Closing one tab is a deliberate act on a page in front of you; signing every conversation out
    // mid-checkout is not the same thing.
    const { pane } = await paneWithSession();
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    expect(pane.state().profileResetLocked).toBe(true);
    await expect(pane.clearProfile()).rejects.toThrow(/task is running/);
    expect(pane.state().tabs).toHaveLength(1);
  });

  it("clears the session and closes every tab", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    // The profile is shared by every conversation, so a reset waits for *every* task to finish.
    pane.endTask("a", { abnormal: false });
    await pane.clearProfile();
    expect(clearIabSession).toHaveBeenCalledTimes(1);
    expect(pane.state().tabs).toEqual([]);
  });

  it("hands over the URL and nothing else", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ url: "https://ctrip.com/", sessionId: "session-1", taskId: "a" });
    expect(pane.handoff()).toEqual({ url: "https://ctrip.com/", sessionScope: "session-1" });
  });

  it("hands over nothing from a blank tab", async () => {
    const { pane } = await paneWithSession("session-1", "a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "a" });
    expect(pane.handoff()).toBeNull();
  });
});

describe("checkpoint", () => {
  const entry = (url: string, taskScope: string, extra: Record<string, unknown> = {}) => ({
    id: `t-${url}`,
    url,
    taskScope,
    active: false,
    retain: false,
    ...extra,
  });
  const writeCheckpoint = (path: string, tabs: ReturnType<typeof entry>[]) =>
    fs.writeFileSync(path, JSON.stringify({ version: 1, tabs }));

  it("brings a conversation's pages back when that conversation is opened", async () => {
    // A tab is conversation state, the same kind of thing as the message list. Opening the
    // conversation is what asks for its pages, so there is nothing to prompt about.
    const checkpointPath = tempCheckpoint();
    writeCheckpoint(checkpointPath, [entry("https://ctrip.com/", "session-1", { active: true })]);
    const { pane } = makePane({ checkpointPath });

    expect(views).toHaveLength(0);
    pane.setActiveSession("session-1");

    expect(pane.state().tabs.map((tab) => tab.url)).toEqual(["https://ctrip.com/"]);
  });

  it("leaves the other conversations' pages where they are", async () => {
    // The reported bug in its original form: a global count with a per-conversation view. Seven
    // pages were announced and three appeared, because the other four belonged elsewhere.
    const checkpointPath = tempCheckpoint();
    writeCheckpoint(checkpointPath, [
      entry("https://a.example/", "session-1"),
      entry("https://b.example/", "session-2"),
      entry("https://c.example/", "session-3"),
    ]);
    const { pane } = makePane({ checkpointPath });
    pane.setActiveSession("session-1");

    expect(pane.state().tabs.map((tab) => tab.url)).toEqual(["https://a.example/"]);
    expect(views).toHaveLength(1);

    // And they are still there to be found, rather than having been consumed by the first switch.
    pane.setActiveSession("session-2");
    expect(pane.state().tabs.map((tab) => tab.url)).toEqual(["https://b.example/"]);
  });

  it("keeps the pages of conversations this run never opened", async () => {
    // Writing a checkpoint from open tabs alone deletes everything the user has not visited yet —
    // silently, and only noticed the next time one of those conversations is opened.
    vi.useFakeTimers();
    try {
      const checkpointPath = tempCheckpoint();
      writeCheckpoint(checkpointPath, [
        entry("https://opened.example/", "session-1"),
        entry("https://never-opened.example/", "session-2"),
      ]);
      const { pane } = makePane({ checkpointPath });
      pane.setActiveSession("session-1");
      pane.closeTab(pane.state().tabs[0]!.id);
      vi.advanceTimersByTime(5000);

      const written = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as {
        tabs: { url: string }[];
      };
      expect(written.tabs.map((tab) => tab.url)).toEqual(["https://never-opened.example/"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("brings them back unowned, so a fresh task has to claim before it can write", async () => {
    const checkpointPath = tempCheckpoint();
    writeCheckpoint(checkpointPath, [
      entry("https://ctrip.com/", "session-1", {
        active: true,
        ownedByTask: "task-from-a-dead-run",
      }),
    ]);
    const { pane } = makePane({ checkpointPath });
    pane.setActiveSession("session-1");

    const [tab] = pane.state().tabs;
    expect(tab?.ownedByTask).toBeNull();
    expect(pane.mayDrive(views[0]!.webContents as never, "task-from-a-dead-run")).toMatchObject({
      allowed: false,
      reason: "released",
    });
  });

  it("materializes a conversation once, not every time it is shown again", async () => {
    const checkpointPath = tempCheckpoint();
    writeCheckpoint(checkpointPath, [entry("https://ctrip.com/", "session-1")]);
    const { pane } = makePane({ checkpointPath });

    pane.setActiveSession("session-1");
    pane.setActiveSession("session-2");
    pane.setActiveSession("session-1");

    expect(pane.state().tabs).toHaveLength(1);
    expect(views).toHaveLength(1);
  });

  it("survives a clean shutdown, because pages are not evidence of how a run ended", async () => {
    // The file used to be cleared on the way out so that finding it meant "the last run crashed".
    // Nothing asks that question any more: these pages belong to their conversations either way.
    const checkpointPath = tempCheckpoint();
    writeCheckpoint(checkpointPath, [entry("https://ctrip.com/", "session-1")]);
    const first = makePane({ checkpointPath });
    first.pane.setActiveSession("session-1");
    first.pane.destroy();

    const second = makePane({ checkpointPath });
    second.pane.setActiveSession("session-1");
    expect(second.pane.state().tabs.map((tab) => tab.url)).toEqual(["https://ctrip.com/"]);
  });

  it("drops the unopened conversations' pages when the profile is cleared", async () => {
    // They were signed in with the profile that was just wiped. Bringing them back later would
    // reopen a set of pages that are all logged out.
    vi.useFakeTimers();
    try {
      const checkpointPath = tempCheckpoint();
      writeCheckpoint(checkpointPath, [entry("https://never-opened.example/", "session-2")]);
      const { pane } = makePane({ checkpointPath });
      pane.setActiveSession("session-1");
      await pane.clearProfile();
      vi.advanceTimersByTime(5000);

      const written = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as { tabs: unknown[] };
      expect(written.tabs).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes nothing more after being destroyed", async () => {
    // The regression: destroy cleared the timer, then closing the tabs armed a new one, which wrote
    // an empty checkpoint half a second after teardown — taking the pages with it.
    vi.useFakeTimers();
    try {
      const checkpointPath = tempCheckpoint();
      const { pane } = makePane({ checkpointPath });
      pane.setActiveSession("session-1");
      reportRunning(pane, "session-1", "a");
      await pane.openTabForAgent({
        url: "https://ctrip.com/",
        sessionId: "session-1",
        taskId: "a",
      });
      vi.advanceTimersByTime(5000);
      const before = fs.readFileSync(checkpointPath, "utf8");

      pane.destroy();
      vi.advanceTimersByTime(5000);
      expect(fs.readFileSync(checkpointPath, "utf8")).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes the window's resize listener off on the way out", () => {
    const { pane, window } = makePane();
    pane.destroy();
    expect(window.off).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});

describe("the supervisor's answers", () => {
  it("ends a turn while the user is reading another conversation", async () => {
    // The defect this replaced a renderer-side watcher for: the chat page holds one session stream
    // and drops it when the route changes, so a turn that finished after the user moved on reported
    // nothing. Its tabs stayed owned and the backend switch stayed shut until somebody happened to
    // wander back into that conversation.
    const { pane, states } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    pane.declareTaskOutcome("task-a", "committed");
    pane.setActiveSession("session-2");

    // The conversation the user left is still one the shell asks about — which is what makes the
    // ending reachable at all.
    expect(pane.sessionsOfInterest()).toContain("session-1");

    reportRunning(pane, "session-1", null, { taskId: "task-a", failed: false });

    pane.setActiveSession("session-1");
    expect(pane.state().tabs[0]?.ownedByTask).toBeNull();
  });

  it("unlocks the backend in the state it publishes, not only in the one it is asked for", async () => {
    // The regression: `endTask` published *before* deleting the running task and never published
    // again, so the renderer's last word on the conversation said a task was still running. The
    // menu stayed disabled until some unrelated event happened to publish another state — and
    // `pane.state()` looked fine the whole time, which is why this asserts what was *received*.
    const { pane, states } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    expect(states.at(-1)?.backendLocked).toBe(true);

    reportRunning(pane, "session-1", null, { taskId: "task-a", failed: false });

    expect(states.at(-1)?.backendLocked).toBe(false);
    expect(states.at(-1)?.profileResetLocked).toBe(false);
  });

  it("tells main where a conversation's downloads go, from the server's own answer", async () => {
    const resolved: Array<{ sessionId: string; projectId: string; agentId: string }> = [];
    const { pane } = makePane();
    pane.setActiveSession("session-1");
    (pane as unknown as { options: { onSessionResolved?: unknown } }).options.onSessionResolved =
      (ids: { sessionId: string; projectId: string; agentId: string }) => resolved.push(ids);

    reportRunning(pane, "session-1", "task-a");

    expect(resolved).toEqual([
      { sessionId: "session-1", projectId: "project-1", agentId: "agent-1" },
    ]);
  });
});

describe("a failed handshake", () => {
  it("leaves the turn's authority alone, so the retry it suggests can work", async () => {
    // The rollback used to release the *task* when a view's debugger never answered — so the retry
    // the error message asks for was refused with IAB_TASK_NOT_LIVE, and the turn could never open
    // another tab. The failure is about one view; the turn is still running, and the server says so.
    vi.useFakeTimers();
    try {
      const { pane } = await paneWithSession("session-1", "task-a");
      nextDebuggerAttached = false;
      const failing = pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
      const settled = expect(failing).rejects.toThrow(/could not read a CDP target id/);
      await vi.advanceTimersByTimeAsync(2000);
      await settled;
      expect(pane.state().tabs).toEqual([]);

      nextDebuggerAttached = true;
      await expect(
        pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" }),
      ).resolves.toBeTruthy();
      expect(pane.state().tabs).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the backend locked for the rest of the turn", async () => {
    vi.useFakeTimers();
    try {
      const { pane, states } = await paneWithSession("session-1", "task-a");
      nextDebuggerAttached = false;
      const failing = pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
      const settled = expect(failing).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(2000);
      await settled;
      // Still the turn's conversation, and the turn is still running.
      expect(states.at(-1)?.backendLocked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("materializing a conversation's pages", () => {
  it("does not block the switch when a view cannot be built", async () => {
    // This runs inside a conversation switch. Throwing would stop the user from arriving at the
    // conversation they asked for, which is a worse failure than one page missing from its strip.
    const checkpointPath = tempCheckpoint();
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify({
        version: 1,
        tabs: [
          { id: "t1", url: "https://first.example/", taskScope: "session-1" },
          { id: "t2", url: "https://second.example/", taskScope: "session-1" },
        ],
      }),
    );
    const { pane } = makePane({ checkpointPath });

    viewBudget = 0;
    expect(() => pane.setActiveSession("session-1")).not.toThrow();
    viewBudget = null;

    expect(pane.state().sessionScope).toBe("session-1");
    expect(pane.state().tabs).toEqual([]);
  });

  it("opens the pages it can when only some views fail", async () => {
    const checkpointPath = tempCheckpoint();
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify({
        version: 1,
        tabs: [
          { id: "t1", url: "https://first.example/", taskScope: "session-1" },
          { id: "t2", url: "https://second.example/", taskScope: "session-1" },
        ],
      }),
    );
    const { pane } = makePane({ checkpointPath });

    viewBudget = 1;
    pane.setActiveSession("session-1");
    viewBudget = null;

    expect(pane.state().tabs.map((tab) => tab.url)).toEqual(["https://first.example/"]);
  });

  it("does not retry a scope it has already drained", async () => {
    // The entries are taken before the views are built, so a failure cannot leave work that would
    // be attempted again on every switch back into the conversation.
    const checkpointPath = tempCheckpoint();
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify({
        version: 1,
        tabs: [{ id: "t1", url: "https://first.example/", taskScope: "session-1" }],
      }),
    );
    const { pane } = makePane({ checkpointPath });

    viewBudget = 0;
    pane.setActiveSession("session-1");
    viewBudget = null;

    pane.setActiveSession("session-2");
    pane.setActiveSession("session-1");
    expect(pane.state().tabs).toEqual([]);
  });
});

describe("a view that will not build", () => {
  it("does not throw out of the crash handler, and keeps the page for a retry", async () => {
    // `recoverFromCrash` runs inside Chromium's `render-process-gone` listener. An exception
    // escaping it is an uncaught exception in the *main* process — the whole app goes down because
    // one tab could not be rebuilt, which is the failure crash recovery exists to prevent.
    const { pane, states } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({
      url: "https://ctrip.com/",
      sessionId: "session-1",
      taskId: "task-a",
    });
    const tabId = pane.state().tabs[0]!.id;
    const viewsBefore = views.length;

    viewBudget = 0;
    expect(() =>
      views[0]!.webContents.emit("render-process-gone", { reason: "crashed" }),
    ).not.toThrow();
    viewBudget = null;

    // Still in the strip, still pointed at the page it lost, and marked as something to retry.
    const tab = pane.state().tabs.find((entry) => entry.id === tabId);
    expect(tab?.url).toBe("https://ctrip.com/");
    expect(tab?.failed?.description).toMatch(/view creation failed/);
    expect(states.at(-1)?.tabs).toHaveLength(1);
    // Nothing half-built was left attached to the window.
    expect(views.length).toBe(viewsBefore);
  });

  it("rebuilds on the user's retry, at the URL it was showing", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({
      url: "https://ctrip.com/",
      sessionId: "session-1",
      taskId: "task-a",
    });
    const tabId = pane.state().tabs[0]!.id;

    viewBudget = 0;
    views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });
    viewBudget = null;
    expect(pane.state().tabs[0]?.failed).not.toBeNull();

    // The retry button is `reload`, and on a dead view reloading *is* rebuilding: doing nothing
    // here is what made a failed rebuild permanent.
    pane.reload(tabId);

    expect(pane.state().tabs[0]?.failed).toBeNull();
    expect(views.at(-1)?.webContents.loadURL).toHaveBeenCalledWith("https://ctrip.com/");
  });

  it("reports a second failure the same way rather than throwing", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({
      url: "https://ctrip.com/",
      sessionId: "session-1",
      taskId: "task-a",
    });
    const tabId = pane.state().tabs[0]!.id;

    viewBudget = 0;
    views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });
    expect(() => pane.reload(tabId)).not.toThrow();
    viewBudget = null;

    expect(pane.state().tabs[0]?.failed?.description).toMatch(/view creation failed/);
    // And the third attempt, with views available again, still works.
    pane.reload(tabId);
    expect(pane.state().tabs[0]?.failed).toBeNull();
  });

  it("takes the address bar as a retry with a destination", async () => {
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({
      url: "https://ctrip.com/",
      sessionId: "session-1",
      taskId: "task-a",
    });
    const tabId = pane.state().tabs[0]!.id;

    viewBudget = 0;
    views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });
    viewBudget = null;

    await pane.navigate(tabId, "https://qunar.com/");
    expect(views.at(-1)?.webContents.loadURL).toHaveBeenCalledWith("https://qunar.com/");
    expect(pane.state().tabs[0]?.failed).toBeNull();
  });

  it("unwinds a view that fails *after* it was attached", async () => {
    // The constructor is the easy failure. The one that actually leaks is a failure further in —
    // the transport refusing to attach its debugger, say — because by then the view has been
    // constructed *and* added to the window, and the tab may already have committed to it. All
    // three have to come back: the child view off the window, the `WebContents` closed, and the tab
    // out of the model.
    const { pane, window } = await paneWithSession("session-1", "task-a");
    const before = views.length;
    pane.setViewCreatedHandler(() => {
      throw new Error("the transport is down");
    });

    await expect(
      pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" }),
    ).rejects.toThrow(/the transport is down/);

    // It got as far as being built and attached, and then all of it was taken back.
    const orphan = views.at(-1)!;
    expect(views.length).toBe(before + 1);
    expect(window.contentView.addChildView).toHaveBeenCalledWith(orphan);
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(orphan);
    expect(orphan.webContents.close).toHaveBeenCalled();
    expect(pane.state().tabs).toEqual([]);
    expect(attachedViewCount(pane)).toBe(0);
  });

  it("keeps the tab usable when a crash rebuild fails after attaching", async () => {
    // The same failure on the crash path: the tab stays, with its page and a retry, and nothing is
    // left attached to the window.
    const { pane, window } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({
      url: "https://ctrip.com/",
      sessionId: "session-1",
      taskId: "task-a",
    });
    const attachedBefore = attachedViewCount(pane);
    pane.setViewCreatedHandler(() => {
      throw new Error("the transport is down");
    });

    expect(() =>
      views[0]!.webContents.emit("render-process-gone", { reason: "crashed" }),
    ).not.toThrow();

    const orphan = views.at(-1)!;
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(orphan);
    expect(orphan.webContents.close).toHaveBeenCalled();
    // The old view went, the new one never counted: one fewer than before the crash.
    expect(attachedViewCount(pane)).toBe(attachedBefore - 1);
    expect(pane.state().tabs[0]?.url).toBe("https://ctrip.com/");
    expect(pane.state().tabs[0]?.failed?.description).toMatch(/the transport is down/);
  });

  it("leaves nothing attached when a tab's first view fails", async () => {
    // `createTab` deletes the model entry; the *view* is taken apart by `buildView` itself, which is
    // the only code that knows how far the construction got.
    const { pane } = await paneWithSession("session-1", "task-a");
    const attachedBefore = attachedViewCount(pane);

    viewBudget = 0;
    await expect(
      pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" }),
    ).rejects.toThrow(/view creation failed/);
    viewBudget = null;

    expect(pane.state().tabs).toEqual([]);
    expect(attachedViewCount(pane)).toBe(attachedBefore);
  });
});

/** How many views the pane currently has attached to the window, from the double's own counters. */
function attachedViewCount(pane: Pane): number {
  const options = (pane as unknown as { options: { window: ReturnType<typeof makeWindow> } })
    .options;
  const added = options.window.contentView.addChildView.mock.calls.length;
  const removed = options.window.contentView.removeChildView.mock.calls.length;
  return added - removed;
}

describe("a tab left with no view", () => {
  it("is not decided by isDestroyed, which a detached WebContents need not report", async () => {
    // The state after a failed rebuild is "this tab has no view", and the model says so. Inferring
    // it from `isDestroyed()` was wrong: a `WebContents` that has been closed and detached does not
    // have to report itself destroyed, and the retry would then reload a page nobody can see
    // instead of building one.
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({
      url: "https://ctrip.com/",
      sessionId: "session-1",
      taskId: "task-a",
    });
    const tabId = pane.state().tabs[0]!.id;
    const stale = views[0]!.webContents;
    stale.closeDestroys = false;

    viewBudget = 0;
    stale.emit("render-process-gone", { reason: "crashed" });
    viewBudget = null;

    expect(stale.isDestroyed()).toBe(false);
    expect(pane.state().tabs[0]?.failed).not.toBeNull();

    const before = views.length;
    pane.reload(tabId);
    expect(views.length).toBe(before + 1);
    expect(stale.reload).not.toHaveBeenCalled();
  });

  it("keeps its page in the checkpoint, so a restart can still offer it", async () => {
    // Read from the file itself, after the debounce has actually run. The page a failed rebuild
    // left behind only survives a crash of the *app* if it reaches disk, and a tab with no view is
    // exactly the case where a checkpoint written from live `WebContents` would have written
    // nothing.
    vi.useFakeTimers();
    try {
      const checkpointPath = tempCheckpoint();
      const harness = makePane({ checkpointPath });
      harness.pane.setActiveSession("session-1");
      harness.pane.setRequested(true);
      reportRunning(harness.pane, "session-1", "task-a");
      await harness.pane.openTabForAgent({
        url: "https://ctrip.com/",
        sessionId: "session-1",
        taskId: "task-a",
      });

      viewBudget = 0;
      views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });
      viewBudget = null;
      expect(harness.pane.state().tabs[0]?.failed).not.toBeNull();

      await vi.advanceTimersByTimeAsync(1000);

      const written = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as {
        tabs: Array<{ url: string; taskScope: string | null }>;
      };
      expect(written.tabs).toHaveLength(1);
      expect(written.tabs[0]).toMatchObject({
        url: "https://ctrip.com/",
        taskScope: "session-1",
      });

      // And a clean shutdown leaves it there: the page belongs to its conversation, so it comes
      // back the next time that conversation is opened rather than being an offer that expires.
      harness.pane.destroy();
      const afterShutdown = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as {
        tabs: Array<{ url: string }>;
      };
      expect(afterShutdown.tabs.map((tab) => tab.url)).toEqual(["https://ctrip.com/"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no longer answers to the target id of the page it lost", async () => {
    // A stale id still matching this tab would hand a command a page that no longer exists — and
    // the relay has already been told that target closed.
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });
    expect(pane.state().tabs[0]?.targetId).toBe("T1");

    viewBudget = 0;
    views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });
    viewBudget = null;

    expect(pane.state().tabs[0]?.targetId).toBeNull();
    expect(pane.claimTab("T1", { sessionId: "session-1", taskId: "task-a" })).toEqual({
      claimed: false,
      reason: "gone",
    });
  });

  it("keeps the final result even when its view is missing", async () => {
    // A read-only turn releases its final result. One with no view must do the same without
    // throwing on a `WebContents` that is not there.
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });

    viewBudget = 0;
    views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });
    viewBudget = null;
    expect(pane.state().tabs).toHaveLength(1);

    pane.declareTaskOutcome("task-a", "read_only");
    expect(() => pane.endTask("task-a", { abnormal: false })).not.toThrow();
    expect(pane.state().tabs).toHaveLength(1);
    expect(pane.state().tabs[0]?.ownedByTask).toBeNull();
  });

  it("keeps the page it lost when a retry fails again", async () => {
    // The remembered URL is what the strip shows and what the checkpoint would restore, so a failed
    // retry must not overwrite it — including the retry that comes with its own destination.
    const { pane } = await paneWithSession("session-1", "task-a");
    await pane.openTabForAgent({
      url: "https://ctrip.com/",
      sessionId: "session-1",
      taskId: "task-a",
    });
    const tabId = pane.state().tabs[0]!.id;

    viewBudget = 0;
    views[0]!.webContents.emit("render-process-gone", { reason: "crashed" });
    await expect(pane.navigate(tabId, "https://qunar.com/")).rejects.toThrow(/IAB_REBUILD_FAILED/);
    viewBudget = null;

    expect(pane.state().tabs[0]?.url).toBe("https://ctrip.com/");
    expect(pane.state().tabs[0]?.failed?.url).toBe("https://ctrip.com/");
  });
});

describe("a logger that throws", () => {
  it("does not take the crash handler down with it", async () => {
    // `log` is called from inside Chromium event listeners, and the sink is injected — a stream
    // that has been closed, a writer somebody else owns. A throw there would quietly undo every
    // "this path never throws" guarantee that reports what it did.
    const harness = makePane({
      log: () => {
        throw new Error("the log stream is closed");
      },
    });
    harness.pane.setActiveSession("session-1");
    harness.pane.setRequested(true);
    harness.pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    reportRunning(harness.pane, "session-1", "task-a");
    await harness.pane.openTabForAgent({
      url: "https://ctrip.com/",
      sessionId: "session-1",
      taskId: "task-a",
    });

    viewBudget = 0;
    expect(() =>
      views[0]!.webContents.emit("render-process-gone", { reason: "crashed" }),
    ).not.toThrow();
    viewBudget = null;

    // And the tab still ends up in the state the failure is supposed to leave it in.
    expect(harness.pane.state().tabs[0]?.failed?.description).toMatch(/view creation failed/);
  });

  it("does not stop a state push from reaching the renderer", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const harness = makePane({
      log: () => {
        throw new Error("the log stream is closed");
      },
    });
    (
      harness.pane as unknown as { options: { onState: (state: unknown) => void } }
    ).options.onState = (state: unknown) => seen.push(state as Record<string, unknown>);
    harness.pane.setActiveSession("session-1");
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("a renderer that has gone", () => {
  it("does not take the crash handler down when the state push throws", async () => {
    // `webContents.send` throws once the window is destroyed — which is exactly when a crashing
    // view's `render-process-gone` is most likely to arrive.
    const harness = makePane();
    harness.pane.setActiveSession("session-1");
    harness.pane.setRequested(true);
    harness.pane.setMeasurement({ x: 800, y: 40, width: 700, height: 800 });
    reportRunning(harness.pane, "session-1", "task-a");
    await harness.pane.openTabForAgent({ sessionId: "session-1", taskId: "task-a" });

    (harness.pane as unknown as { options: { onState: () => void } }).options.onState = () => {
      throw new Error("Object has been destroyed");
    };

    expect(() =>
      views[0]!.webContents.emit("render-process-gone", { reason: "crashed" }),
    ).not.toThrow();
  });
});

/**
 * Issue 0008 — the pane reported a scope exactly one conversation behind, twice in the wild, and no
 * writer could be pinned because every writer was permitted: `setActiveSession` took whatever
 * arrived last. Ordering knowledge lived only in the renderer, which numbered its switches to tell
 * which *reply* was current, while main held the state that got corrupted.
 *
 * Both shapes below reproduce the two states the issue recorded, and both were green — that is,
 * wrong — before the stamp existed.
 */
describe("stale conversation announces", () => {
  const active = (pane: Pane): string | null => pane.state().sessionScope;
  const stamp = (seq: number, epoch = "doc-1") => ({ epoch, seq });

  it("refuses an announce for the draft scope that has already been promoted", () => {
    const { pane } = makePane();
    pane.setActiveSession("draft-scope-aaa", stamp(2));
    pane.setRequested(true);
    pane.reassignActiveSession("session-B");
    expect(active(pane)).toBe("session-B");

    // The layout effect's announce for the draft, still in flight when the send promoted it.
    pane.setActiveSession("draft-scope-aaa", stamp(1));
    expect(active(pane)).toBe("session-B");
  });

  it("refuses an announce naming the conversation left two switches ago", () => {
    const { pane } = makePane();
    pane.setActiveSession("session-A", stamp(1));
    pane.setRequested(true);
    pane.setActiveSession("draft-scope-bbb", stamp(2));
    pane.reassignActiveSession("session-B");
    expect(active(pane)).toBe("session-B");

    pane.setActiveSession("session-A", stamp(1));
    expect(active(pane)).toBe("session-B");
  });

  it("adopts a fresh sequence from a new document instead of refusing it", () => {
    const { pane } = makePane();
    pane.setActiveSession("session-A", stamp(7));
    // A reload restarts the count. Refusing this would leave the pane stuck on the old conversation
    // for the rest of the session — a worse failure than the one the stamp guards against.
    pane.setActiveSession("session-B", stamp(1, "doc-2"));
    expect(active(pane)).toBe("session-B");
  });

  it("still applies an unstamped announce, so internal callers are unaffected", () => {
    const { pane } = makePane();
    pane.setActiveSession("session-A", stamp(5));
    pane.setActiveSession("session-B");
    expect(active(pane)).toBe("session-B");
  });
});
