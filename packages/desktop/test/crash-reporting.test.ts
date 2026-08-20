/**
 * Crash reporting, tested for the one property that matters: no values.
 *
 * A crash payload is the classic place a secret leaks — an exception message that quoted a request,
 * a stack frame carrying an argument, an env dump. So the report builder is fed exactly that kind of
 * dirty input and the output is checked to be free of it, and the wiring is driven with fake
 * Electron events to confirm the three layers all reach the sink and that a write failure never
 * escalates a renderer crash into a main-process one.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  buildCrashReport,
  fileCrashSink,
  installCrashReporting,
  type CrashReport,
} from "../src/crash-reporting.js";

const VERSIONS = { app: "0.2.2", electron: "43.2.0", chrome: "130.0", platform: "darwin" };
const at = () => new Date("2026-08-16T10:00:00.000Z");

describe("buildCrashReport", () => {
  it("keeps a value-free record of what crashed and where", () => {
    const report = buildCrashReport({
      layer: "main",
      event: "uncaughtException",
      message: "TypeError: cannot read x",
      stack: "TypeError: cannot read x\n  at foo (main.js:1:1)",
      versions: VERSIONS,
      now: at,
    });
    expect(report).toMatchObject({
      schema: "penguin.crash/1",
      layer: "main",
      event: "uncaughtException",
      at: "2026-08-16T10:00:00.000Z",
    });
    expect(report.versions).toEqual(VERSIONS);
  });

  it("redacts a secret that rode in on an exception message", () => {
    // The failure mode this exists for: a caught error that interpolated a request.
    const report = buildCrashReport({
      layer: "main",
      event: "uncaughtException",
      message: "request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5",
      stack:
        "Error: boom\n  at post (net.js:1) PENGUIN_BROKER_TOKEN=abc123def456ghi789jkl012mno345pq",
      versions: VERSIONS,
      now: at,
    });
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain("eyJhbGci");
    expect(serialised).not.toContain("abc123def456ghi789jkl012mno345pq");
    expect(serialised).toContain("[REDACTED");
  });

  it("caps the stack so a report cannot be the whole heap of frames", () => {
    const stack = ["Error: deep", ...Array.from({ length: 200 }, (_, i) => `  at f${i} ()`)].join(
      "\n",
    );
    const report = buildCrashReport({ layer: "main", event: "x", stack, versions: VERSIONS });
    expect((report.stack ?? "").split("\n").length).toBeLessThanOrEqual(40);
  });

  it("omits absent fields instead of writing 'undefined'", () => {
    const report = buildCrashReport({
      layer: "renderer",
      event: "render-process-gone",
      reason: "crashed",
      versions: VERSIONS,
    });
    expect("message" in report).toBe(false);
    expect("stack" in report).toBe(false);
    expect("surface" in report).toBe(false);
  });

  it("derives a short reason from the message when none is given", () => {
    const report = buildCrashReport({
      layer: "main",
      event: "uncaughtException",
      message: "Error: something specific\n  at a\n  at b",
      versions: VERSIONS,
    });
    expect(report.reason).toBe("Error: something specific");
  });
});

describe("fileCrashSink", () => {
  it("appends one JSON line and creates the dir", () => {
    const writes: Array<{ path: string; data: string }> = [];
    const sink = fileCrashSink({
      dir: "/crash",
      mkdirSync: vi.fn(),
      appendFileSync: (path, data) => writes.push({ path, data }),
      statSync: () => {
        throw new Error("ENOENT"); // no file yet — the append below creates it
      },
      join: (...parts) => parts.join("/"),
    });
    sink.write(buildCrashReport({ layer: "main", event: "x", versions: VERSIONS, now: at }));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe("/crash/crashes.jsonl");
    expect(writes[0]!.data.endsWith("\n")).toBe(true);
    expect(JSON.parse(writes[0]!.data) as CrashReport).toMatchObject({ layer: "main" });
  });

  it("never throws, so a failed write cannot escalate the crash", () => {
    const logs: string[] = [];
    const sink = fileCrashSink({
      dir: "/crash",
      mkdirSync: () => {
        throw new Error("read-only fs");
      },
      appendFileSync: () => {},
      statSync: () => ({ size: 0 }),
      join: (...parts) => parts.join("/"),
      log: (line) => logs.push(line),
    });
    expect(() =>
      sink.write(buildCrashReport({ layer: "main", event: "x", versions: VERSIONS })),
    ).not.toThrow();
    expect(logs.join("")).toMatch(/could not write/);
  });

  it("stops appending at the size cap, keeping the earliest reports", () => {
    const appends: string[] = [];
    const logs: string[] = [];
    let size = 0;
    const sink = fileCrashSink({
      dir: "/crash",
      mkdirSync: vi.fn(),
      appendFileSync: (_path, data) => {
        appends.push(data);
        size += data.length;
      },
      statSync: () => ({ size }),
      join: (...parts) => parts.join("/"),
      maxBytes: 200,
      log: (line) => logs.push(line),
    });
    const report = buildCrashReport({ layer: "main", event: "x", versions: VERSIONS, now: at });
    for (let i = 0; i < 10; i++) sink.write(report);
    // The first writes land; once the file passes the cap, nothing more is appended and the
    // notice is logged exactly once — a report storm must not become a disk-filling storm.
    expect(appends.length).toBeGreaterThan(0);
    expect(appends.length).toBeLessThan(10);
    expect(size).toBeLessThan(200 + 200);
    expect(logs.filter((l) => l.includes("dropping further reports"))).toHaveLength(1);
  });
});

describe("installCrashReporting", () => {
  function harness() {
    const reports: CrashReport[] = [];
    const rethrown: Error[] = [];
    const processEmitter = Object.assign(new EventEmitter(), {
      platform: "linux",
      versions: { electron: "43.2.0", chrome: "130.0" },
    }) as unknown as NodeJS.EventEmitter & { platform: string; versions: Record<string, string> };
    const appHandlers: Record<string, (...args: unknown[]) => void> = {};
    const app = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        appHandlers[event] = handler;
      },
      off: (event: string) => {
        delete appHandlers[event];
      },
      getVersion: () => "0.2.2",
    };
    const dispose = installCrashReporting({
      app: app as never,
      process: processEmitter,
      sink: { write: (r) => reports.push(r) },
      surfaceOf: () => "in-app browser view",
      // Injected so the re-surface is observed, not thrown into the test runner.
      rethrow: (error) => rethrown.push(error),
      now: at,
    });
    return { reports, rethrown, processEmitter, appHandlers, dispose };
  }

  it("records a renderer crash with its surface", () => {
    const h = harness();
    h.appHandlers["render-process-gone"]!({}, {}, { reason: "crashed", exitCode: 133 });
    expect(h.reports[0]).toMatchObject({
      layer: "renderer",
      event: "render-process-gone",
      surface: "in-app browser view",
    });
    expect(h.reports[0]!.reason).toContain("crashed");
    h.dispose();
  });

  it("records a utilityProcess (server) death", () => {
    const h = harness();
    h.appHandlers["child-process-gone"]!(
      {},
      { type: "Utility", reason: "crashed", exitCode: 1, name: "penguin-server" },
    );
    expect(h.reports[0]).toMatchObject({ layer: "utility", surface: "penguin-server" });
    h.dispose();
  });

  it("records an uncaught main exception and re-surfaces it, rather than swallowing it", () => {
    const h = harness();
    const boom = new Error("main boom");
    h.processEmitter.emit("uncaughtException", boom);
    expect(h.reports[0]).toMatchObject({ layer: "main", event: "uncaughtException" });
    expect(h.reports[0]!.reason).toContain("Error");
    // Recorded and re-surfaced: the same error is handed to the rethrow hook, not dropped.
    expect(h.rethrown).toEqual([boom]);
    h.dispose();
  });

  it("detaches after one uncaught exception, so the rethrow cannot re-enter it", () => {
    const h = harness();
    const boom = new Error("first");
    h.processEmitter.emit("uncaughtException", boom);
    // The handler removed itself before rethrowing. While a listener is attached Node suppresses
    // its default fatal handling, so a handler that rethrows while still listening loops forever
    // — the 9.2 GB storm. Detached, the deferred rethrow reaches the default: print and exit.
    expect(h.processEmitter.listenerCount("uncaughtException")).toBe(0);
    h.processEmitter.emit("uncaughtException", new Error("second"));
    expect(h.reports).toHaveLength(1);
    expect(h.rethrown).toEqual([boom]);
    h.dispose();
  });

  it("records an unhandled rejection without re-throwing it", () => {
    const h = harness();
    h.processEmitter.emit("unhandledRejection", new Error("rejected"));
    expect(h.reports[0]).toMatchObject({ layer: "main", event: "unhandledRejection" });
    expect(h.rethrown).toEqual([]);
    h.dispose();
  });

  it("stops recording after dispose", () => {
    const h = harness();
    h.dispose();
    expect(h.appHandlers["render-process-gone"]).toBeUndefined();
  });
});
