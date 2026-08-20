/**
 * Local crash reporting for the three processes the shell runs.
 *
 * The desktop app is really three processes — the Electron main process, each renderer (the window
 * and every in-app browser view), and the utilityProcess the server is forked into — and a crash in
 * any of them is worth a record. Electron's built-in `crashReporter` uploads minidumps to a server;
 * there is no such server here, and a minidump can contain anything that was in memory. So this
 * writes a **local, structured, value-free** report instead: what crashed, where, and why, scrubbed
 * through the same secret-redaction the logs use, and nothing more.
 *
 * The invariant is unchanged: **no values**. A crash payload is exactly where a stray
 * secret would otherwise end up — an exception message quoting a request, a stack frame with an
 * argument, an environment dump — so every string that goes into a report passes `redactSecrets`
 * first, and the report shape carries only metadata fields, never a captured object.
 *
 * The report builder is a pure function so the "no values" property is unit-tested against the
 * kinds of dirty input a real crash produces; the `installCrashReporting` wiring is the thin part
 * that attaches Electron's events to it.
 */
import { redactSecrets } from "@prismshadow/penguin-core";

/** Which process produced the report. */
export type CrashLayer = "main" | "renderer" | "utility";

/** The value-free record written to disk. Every string field is redacted before it lands here. */
export interface CrashReport {
  schema: "penguin.crash/1";
  at: string;
  layer: CrashLayer;
  /** `uncaughtException`, `render-process-gone`, `child-process-gone`, `unhandledRejection`. */
  event: string;
  /** A short reason: an exception name, a `render-process-gone` reason, an exit code phrase. */
  reason: string;
  /** The exception message, redacted. Absent when the event carries none. */
  message?: string;
  /** The stack, redacted and line-capped. Absent when the event carries none. */
  stack?: string;
  /** For a renderer crash: which surface (the app window, or an in-app browser view). */
  surface?: string;
  /** App and runtime versions, so a report is placeable without any user data. */
  versions: { app: string; electron?: string; chrome?: string; platform: string };
}

export interface CrashInput {
  layer: CrashLayer;
  event: string;
  reason?: string;
  message?: string;
  stack?: string;
  surface?: string;
  versions: { app: string; electron?: string; chrome?: string; platform: string };
  now?: () => Date;
}

/** How many stack lines are kept. Enough to place the crash; not the whole heap's worth of frames. */
const MAX_STACK_LINES = 40;

/**
 * Builds a value-free crash report from whatever an Electron event handed over.
 *
 * Pure and defensive: every string is redacted, the stack is capped, and a missing field simply
 * does not appear rather than becoming `"undefined"`. Nothing here reads a file or the environment,
 * so the same dirty input produces the same report in a test as in the app.
 */
export function buildCrashReport(input: CrashInput): CrashReport {
  const at = (input.now?.() ?? new Date()).toISOString();
  const report: CrashReport = {
    schema: "penguin.crash/1",
    at,
    layer: input.layer,
    event: input.event,
    reason: redactSecrets(input.reason ?? deriveReason(input) ?? "unknown"),
    versions: {
      app: input.versions.app,
      platform: input.versions.platform,
      ...(input.versions.electron ? { electron: input.versions.electron } : {}),
      ...(input.versions.chrome ? { chrome: input.versions.chrome } : {}),
    },
  };
  if (input.message) report.message = redactSecrets(input.message);
  if (input.surface) report.surface = redactSecrets(input.surface);
  if (input.stack) {
    report.stack = redactSecrets(input.stack).split("\n").slice(0, MAX_STACK_LINES).join("\n");
  }
  return report;
}

function deriveReason(input: CrashInput): string | undefined {
  if (input.message) {
    const firstLine = input.message.split("\n")[0] ?? "";
    return firstLine.slice(0, 200);
  }
  return undefined;
}

/**
 * The filesystem + Electron dependencies the wiring needs, as a port.
 *
 * A port so `installCrashReporting` can be exercised without Electron, and so the one place that
 * writes a crash file is a named, reviewable surface. `write` appends one JSON line; it must never
 * throw — a crash reporter that crashes the crash is the worst outcome — so the implementation
 * swallows its own errors.
 */
export interface CrashSink {
  write(report: CrashReport): void;
}

/** Where appends stop. Reports past the cap are dropped: the earliest ones place the failure. */
const MAX_CRASH_FILE_BYTES = 5 * 1024 * 1024;

/**
 * A JSONL sink under a directory, each report one line, best-effort, capped.
 *
 * The cap is not hypothetical: an uncaught-exception loop once appended the same line at ~5k/s
 * until the file reached 9.2 GB. The loop itself is fixed (the handler detaches before its one
 * rethrow), but the sink must still refuse unbounded growth on its own — the earliest reports are
 * the diagnostic ones, so writes stop rather than rotate.
 */
export function fileCrashSink(input: {
  dir: string;
  appendFileSync: (path: string, data: string) => void;
  mkdirSync: (path: string) => void;
  statSync: (path: string) => { size: number };
  join: (...parts: string[]) => string;
  maxBytes?: number;
  log?: (line: string) => void;
}): CrashSink {
  const maxBytes = input.maxBytes ?? MAX_CRASH_FILE_BYTES;
  let capped = false;
  return {
    write(report) {
      try {
        input.mkdirSync(input.dir);
        const file = input.join(input.dir, "crashes.jsonl");
        let size = 0;
        try {
          size = input.statSync(file).size;
        } catch {
          // No file yet: size stays 0 and the append below creates it.
        }
        if (size >= maxBytes) {
          if (!capped) {
            capped = true;
            input.log?.(
              `[crash] crashes.jsonl reached ${maxBytes} bytes; dropping further reports\n`,
            );
          }
          return;
        }
        input.appendFileSync(file, `${JSON.stringify(report)}\n`);
      } catch (error) {
        // Never rethrow: the report is a courtesy, and failing to write one must not turn a
        // recoverable renderer crash into a main-process failure.
        input.log?.(`[crash] could not write report: ${(error as Error).message}\n`);
      }
    },
  };
}

/**
 * Attaches the three layers' crash events to a sink.
 *
 * Deliberately structural over Electron: `app`, `process` and a way to enumerate web contents are
 * passed in, so this composes in `main.ts` and is testable with fakes. Returns a disposer that
 * removes the listeners — used so a test does not leave `process` handlers attached, and so a
 * teardown is possible.
 *
 * `unhandledRejection` and `uncaughtException` are recorded but **not** swallowed: after writing
 * the report the handler detaches itself and re-throws on the next tick, so the platform's own
 * fatal handling (print and exit) actually runs. The detach is load-bearing: registering an
 * `uncaughtException` listener suppresses that default for as long as one is attached, so a
 * handler that rethrows while still listening re-enters itself forever — one real exception
 * became a ~5k lines/s storm and a 9.2 GB file. One record, then an honest death.
 */
export interface CrashWiring {
  app: {
    on(
      event: "child-process-gone",
      handler: (event: unknown, details: ChildGoneDetails) => void,
    ): void;
    on(
      event: "render-process-gone",
      handler: (event: unknown, contents: unknown, details: RenderGoneDetails) => void,
    ): void;
    off?: (event: string, handler: (...args: unknown[]) => void) => void;
    getVersion(): string;
  };
  process: NodeJS.EventEmitter & { platform: string; versions: Record<string, string> };
  sink: CrashSink;
  /** Names a renderer's surface (the app window vs an in-app browser view) for the report. */
  surfaceOf?: (contents: unknown) => string | undefined;
  /**
   * What to do with an uncaught main-process exception *after* it is recorded.
   *
   * Defaults to re-surfacing it on the next tick; by then the handler has detached itself, so the
   * deferred throw reaches the platform default (print and exit) instead of re-entering the
   * handler. Injected so a test can assert an exception was reported without actually throwing
   * into the test runner.
   */
  rethrow?: (error: Error) => void;
  now?: () => Date;
}

interface RenderGoneDetails {
  reason: string;
  exitCode?: number;
}
interface ChildGoneDetails {
  type: string;
  reason: string;
  exitCode?: number;
  name?: string;
}

export function installCrashReporting(wiring: CrashWiring): () => void {
  const versions = {
    app: wiring.app.getVersion(),
    platform: wiring.process.platform,
    ...(wiring.process.versions.electron ? { electron: wiring.process.versions.electron } : {}),
    ...(wiring.process.versions.chrome ? { chrome: wiring.process.versions.chrome } : {}),
  };
  const now = wiring.now;
  const rethrow =
    wiring.rethrow ??
    ((error: Error) =>
      setImmediate(() => {
        throw error;
      }));

  const onUncaught = (error: Error): void => {
    // Detach before anything else. With this listener still attached, Node keeps suppressing the
    // default fatal handling, and the deferred rethrow below would arrive right back here — the
    // storm this file's cap describes. Detached, the rethrow is the process's honest last word.
    wiring.process.off("uncaughtException", onUncaught);
    wiring.sink.write(
      buildCrashReport({
        layer: "main",
        event: "uncaughtException",
        reason: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
        versions,
        ...(now ? { now } : {}),
      }),
    );
    // Re-surface so Electron's default handling (and the OS) still see it: recording ≠ swallowing.
    rethrow(error);
  };

  const onRejection = (reason: unknown): void => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    wiring.sink.write(
      buildCrashReport({
        layer: "main",
        event: "unhandledRejection",
        reason: error.name,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
        versions,
        ...(now ? { now } : {}),
      }),
    );
  };

  const onRenderGone = (_event: unknown, contents: unknown, details: RenderGoneDetails): void => {
    wiring.sink.write(
      buildCrashReport({
        layer: "renderer",
        event: "render-process-gone",
        reason: `${details.reason}${details.exitCode !== undefined ? ` (exit ${details.exitCode})` : ""}`,
        ...(wiring.surfaceOf?.(contents) ? { surface: wiring.surfaceOf(contents)! } : {}),
        versions,
        ...(now ? { now } : {}),
      }),
    );
  };

  const onChildGone = (_event: unknown, details: ChildGoneDetails): void => {
    wiring.sink.write(
      buildCrashReport({
        layer: "utility",
        event: "child-process-gone",
        reason:
          `${details.type}: ${details.reason}` +
          `${details.exitCode !== undefined ? ` (exit ${details.exitCode})` : ""}`,
        ...(details.name ? { surface: details.name } : {}),
        versions,
        ...(now ? { now } : {}),
      }),
    );
  };

  wiring.process.on("uncaughtException", onUncaught);
  wiring.process.on("unhandledRejection", onRejection);
  wiring.app.on("render-process-gone", onRenderGone);
  wiring.app.on("child-process-gone", onChildGone);

  return () => {
    wiring.process.off("uncaughtException", onUncaught);
    wiring.process.off("unhandledRejection", onRejection);
    wiring.app.off?.("render-process-gone", onRenderGone as (...args: unknown[]) => void);
    wiring.app.off?.("child-process-gone", onChildGone as (...args: unknown[]) => void);
  };
}
