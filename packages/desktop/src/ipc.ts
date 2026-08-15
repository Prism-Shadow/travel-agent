/**
 * Main-process handlers for the in-app browser bridge.
 *
 * The preload declares which capabilities exist; this decides whether a given call is allowed to
 * do anything. All validation lives here because the preload shares a process with the renderer
 * and cannot be trusted to have run.
 *
 * Two rules, both from design/002 §5.1:
 *
 *   - **Reject, do not coerce.** A bad rectangle is a bug in the renderer, and silently rounding it
 *     into range would hide that bug behind a view that is subtly in the wrong place.
 *   - **Only the app window may call.** Every handler checks that the sender is the window this
 *     module was wired to. A page inside the pane has no preload and so cannot reach these channels
 *     at all, but checking the sender means that stays true even if a preload is added later by
 *     mistake.
 */
import { ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { BrowserPane } from "./browser-pane.js";
import type { PaneMeasurement } from "./browser-pane-layout.js";

/** Channels this module owns. Listed so `dispose` can remove exactly these. */
const CHANNELS = ["iab:set-open", "iab:set-bounds", "iab:set-occluded", "iab:get-state"] as const;

/** Upper bound on a reported rectangle. Larger than any real display; a bigger number is a bug. */
const MAX_DIMENSION = 100_000;

function assertFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

/**
 * Validates a renderer-supplied rectangle, or `null` for "there is no hole any more".
 *
 * `null` is a real message, not a missing one: the pane closed, the window became too narrow, or
 * the component unmounted. Accepting it explicitly is what lets main hide the view instead of
 * leaving it parked over the conversation at the last rectangle it heard about. `undefined` is
 * still a bug and still throws — the distinction is deliberate.
 */
export function parseMeasurement(value: unknown): PaneMeasurement | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("bounds must be an object or null");
  const record = value as Record<string, unknown>;
  const rect = {
    x: assertFiniteNumber(record.x, "bounds.x"),
    y: assertFiniteNumber(record.y, "bounds.y"),
    width: assertFiniteNumber(record.width, "bounds.width"),
    height: assertFiniteNumber(record.height, "bounds.height"),
  };
  if (rect.width < 0 || rect.height < 0) throw new Error("bounds must not be negative");
  for (const [name, dimension] of Object.entries(rect)) {
    if (Math.abs(dimension) > MAX_DIMENSION) throw new Error(`bounds.${name} is out of range`);
  }
  return rect;
}

export function parseBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

export interface BrowserIpcOptions {
  window: BrowserWindow;
  pane: BrowserPane;
}

/** Installs the handlers. Returns a disposer that removes them again. */
export function installBrowserIpc({ window, pane }: BrowserIpcOptions): () => void {
  const fromAppWindow = (event: IpcMainInvokeEvent): boolean => event.sender === window.webContents;

  const guard =
    <T>(handler: (event: IpcMainInvokeEvent, payload: unknown) => T) =>
    (event: IpcMainInvokeEvent, payload: unknown): T => {
      if (!fromAppWindow(event)) {
        throw new Error("The in-app browser bridge is only available to the application window");
      }
      return handler(event, payload);
    };

  ipcMain.handle(
    "iab:set-open",
    guard((_event, payload) => {
      pane.setRequested(parseBoolean(payload, "open"));
    }),
  );

  ipcMain.handle(
    "iab:set-bounds",
    guard((_event, payload) => {
      pane.setMeasurement(parseMeasurement(payload));
    }),
  );

  ipcMain.handle(
    "iab:set-occluded",
    guard((_event, payload) => {
      pane.setOccluded(parseBoolean(payload, "occluded"));
    }),
  );

  ipcMain.handle(
    "iab:get-state",
    guard(() => pane.state()),
  );

  return () => {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  };
}
