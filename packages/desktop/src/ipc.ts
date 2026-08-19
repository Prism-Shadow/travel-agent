/**
 * Main-process handlers for the in-app browser bridge.
 *
 * The preload declares which capabilities exist; this decides whether a given call is allowed to
 * do anything. All validation lives here because the preload shares a process with the renderer
 * and cannot be trusted to have run.
 *
 * Three rules:
 *
 *   - **Reject, do not coerce.** A bad rectangle is a bug in the renderer, and silently rounding it
 *     into range would hide that bug behind a view that is subtly in the wrong place.
 *   - **Only the app window may call.** Every handler checks that the sender is the window this
 *     module was wired to. A page inside the pane has no preload and so cannot reach these channels
 *     at all, but checking the sender means that stays true even if a preload is added later by
 *     mistake.
 *   - **A tab id is not a capability.** Ids are sequential and guessable, so the pane resolves every
 *     one of them within the conversation on screen and refuses the rest. That check lives in
 *     `BrowserPane`, next to the tab table it protects, rather than being re-derived here.
 */
import { ipcMain, shell } from "electron";
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { parseSourceId } from "./browser-import/chrome-profiles.js";
import type { ImportKind } from "./browser-import/chrome-profiles.js";
import type { BrowserImporter } from "./browser-import/importer.js";
import type { LoginService } from "./browser-import/login-service.js";
import type { BrowserPane, PaneBackend } from "./browser-pane.js";
import type { PaneMeasurement } from "./browser-pane-layout.js";
import type { TaskOutcome } from "./tab-lifecycle.js";

/** Channels this module owns. Listed so `dispose` can remove exactly these. */
const CHANNELS = [
  "iab:set-open",
  "iab:set-bounds",
  "iab:hide-now",
  "iab:set-occluded",
  "iab:capture-active-page",
  "iab:get-state",
  "iab:set-session",
  "iab:reassign-session",
  "iab:set-backend",
  "iab:open-tab",
  "iab:close-tab",
  "iab:select-tab",
  "iab:set-retain",
  "iab:set-zoom",
  "iab:navigate",
  "iab:go-back",
  "iab:go-forward",
  "iab:reload",
  "iab:stop",
  "iab:tasks-changed",
  "iab:clear-profile",
  "iab:handoff",
  "iab:handoff-open",
  "iab:import-sources",
  "iab:import-run",
  "iab:history-suggest",
  "iab:login-offers",
  "iab:login-fill",
] as const;

/** Upper bound on a reported rectangle. Larger than any real display; a bigger number is a bug. */
const MAX_DIMENSION = 100_000;
/** Bounds on the strings the renderer may send. Comfortably above anything real. */
const MAX_ID_LENGTH = 128;
const MAX_URL_LENGTH = 4096;
const MIN_BROWSER_ZOOM_FACTOR = 0.5;
const MAX_BROWSER_ZOOM_FACTOR = 2;

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

/** A non-empty, bounded identifier: a tab id, a session id, a task id. */
export function parseId(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.length > MAX_ID_LENGTH) throw new Error(`${name} is too long`);
  return value;
}

/** An id, or `null` for "no conversation is selected" — a state the renderer really can be in. */
export function parseOptionalId(value: unknown, name: string): string | null {
  return value === null ? null : parseId(value, name);
}

export function parseUrl(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.length > MAX_URL_LENGTH) throw new Error(`${name} is too long`);
  return value;
}

const BACKENDS: readonly PaneBackend[] = ["iab", "extension"];

export function parseBackend(value: unknown): PaneBackend {
  if (typeof value !== "string" || !BACKENDS.includes(value as PaneBackend)) {
    throw new Error(`backend must be one of: ${BACKENDS.join(", ")}`);
  }
  return value as PaneBackend;
}

/** A bounded page scale. Rejecting rather than clamping keeps renderer and page state identical. */
export function parseZoomFactor(value: unknown): number {
  const factor = assertFiniteNumber(value, "zoom factor");
  if (factor < MIN_BROWSER_ZOOM_FACTOR || factor > MAX_BROWSER_ZOOM_FACTOR) {
    throw new Error(
      `zoom factor must be between ${MIN_BROWSER_ZOOM_FACTOR} and ${MAX_BROWSER_ZOOM_FACTOR}`,
    );
  }
  return factor;
}

const IMPORT_KIND_NAMES: readonly ImportKind[] = ["passwords", "cookies", "history"];

/**
 * Validates the kinds the dialog ticked.
 *
 * Deduplicated because importing the same kind twice in one request would do the work twice and,
 * for history, double a page's visit count — a bad list is rejected, but a merely repetitive one is
 * normalised rather than refused.
 */
export function parseImportKinds(value: unknown): ImportKind[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("kinds must be a non-empty array");
  }
  if (value.length > IMPORT_KIND_NAMES.length) throw new Error("kinds has too many entries");
  const kinds = new Set<ImportKind>();
  for (const entry of value) {
    if (typeof entry !== "string" || !IMPORT_KIND_NAMES.includes(entry as ImportKind)) {
      throw new Error(`each kind must be one of: ${IMPORT_KIND_NAMES.join(", ")}`);
    }
    kinds.add(entry as ImportKind);
  }
  return [...kinds];
}

/**
 * Validates a source id.
 *
 * The grammar check lives in `chrome-profiles.ts` next to the ids it issues, and the *resolution*
 * check happens again inside `runImport`. Both matter: this one rejects a shape that was never
 * ours, and that one rejects a shape that is ours but names a profile that is no longer there.
 */
export function parseSourceIdArgument(value: unknown): string {
  const id = parseId(value, "sourceId");
  if (parseSourceId(id) === null) throw new Error("sourceId is not a profile this app listed");
  return id;
}

/** Longest address-bar query answered. Past this the user is pasting, not searching. */
const MAX_QUERY_LENGTH = 512;

/**
 * A completion query.
 *
 * Bounded rather than rejected on length: an over-long value is a paste, and truncating it gives
 * the same (empty) answer as refusing while costing nobody an error in the address bar.
 */
export function parseQuery(value: unknown): string {
  if (typeof value !== "string") throw new Error("query must be a string");
  return value.slice(0, MAX_QUERY_LENGTH);
}

const OUTCOMES: readonly TaskOutcome[] = ["read_only", "committed", "failed", "unknown"];

export function parseOutcome(value: unknown): TaskOutcome {
  if (typeof value !== "string" || !OUTCOMES.includes(value as TaskOutcome)) {
    throw new Error(`outcome must be one of: ${OUTCOMES.join(", ")}`);
  }
  return value as TaskOutcome;
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export interface BrowserIpcOptions {
  window: BrowserWindow;
  pane: BrowserPane;
  /** Brings the supervisor's next reconcile forward. See the `iab:tasks-changed` handler. */
  promptTaskRefresh: () => void;
  /**
   * Importing from another browser. Absent when the shell did not wire one, in which case the two
   * import channels answer "nothing to import" rather than being missing — a renderer calling a
   * channel that is not registered gets an unhelpful "no handler" error instead of an empty list.
   */
  importer?: BrowserImporter | null;
  /**
   * Offering and typing saved website logins. Absent when the shell did not wire one, in which case
   * the channels answer "nothing to offer" rather than being missing.
   */
  logins?: LoginService | null;
}

/** Installs the handlers. Returns a disposer that removes them again. */
export function installBrowserIpc({
  window,
  pane,
  promptTaskRefresh,
  importer,
  logins,
}: BrowserIpcOptions): () => void {
  const fromAppWindow = (event: IpcMainInvokeEvent): boolean => event.sender === window.webContents;

  const guard =
    <T>(handler: (event: IpcMainInvokeEvent, payload: unknown) => T) =>
    (event: IpcMainInvokeEvent, payload: unknown): T => {
      if (!fromAppWindow(event)) {
        throw new Error("The in-app browser bridge is only available to the application window");
      }
      return handler(event, payload);
    };

  const on = <T>(channel: (typeof CHANNELS)[number], handler: (payload: unknown) => T): void => {
    ipcMain.handle(
      channel,
      guard((_event, payload) => handler(payload)),
    );
  };

  /**
   * The synchronous hide, and the only `on`/`sendSync` channel here.
   *
   * A conversation switch has an ordering requirement that an `invoke` cannot express: the native
   * view must stop painting the previous conversation's page *before* the renderer paints the new
   * conversation's frame. The renderer's layout effect runs inside that commit, so the only way to
   * hold the frame is to block it — which is what `sendSync` does, and nothing else in this bridge
   * needs to.
   *
   * Kept as narrow as a channel can be: no arguments, no way to *show* anything, and it answers
   * with whether main did it. Showing again happens on the ordinary asynchronous path, once the new
   * conversation has measured its own hole. A renderer that spams this can only hide its own view.
   */
  const hideNow = (event: IpcMainEvent): void => {
    if (event.sender !== window.webContents) {
      event.returnValue = false;
      return;
    }
    try {
      pane.setMeasurement(null);
      event.returnValue = true;
    } catch {
      // The window may be tearing down. `false` tells the renderer the switch is not safe to
      // continue, and it confirms no scope — which keeps every tab hidden.
      event.returnValue = false;
    }
  };
  ipcMain.on("iab:hide-now", hideNow);

  // —— panel ——
  on("iab:set-open", (payload) => pane.setRequested(parseBoolean(payload, "open")));
  on("iab:set-bounds", (payload) => pane.setMeasurement(parseMeasurement(payload)));
  on("iab:set-occluded", (payload) => pane.setOccluded(parseBoolean(payload, "occluded")));
  on("iab:capture-active-page", () => pane.captureActivePage());
  on("iab:get-state", () => pane.state());
  on("iab:set-session", (payload) => {
    // The visible browser scope only: a real conversation id, or an opaque local draft scope before
    // its first send. Where a real Session's downloads go is *not* taken from here: the project and
    // agent come from the server, through the supervisor, because a renderer-supplied triple is a
    // relationship nobody has checked.
    pane.setActiveSession(parseOptionalId(payload, "sessionId"));
    // Echoed back so the renderer can tell *which* switch this answer belongs to: two route changes
    // in quick succession would otherwise leave it unable to know whether the later one landed.
    return pane.state().sessionScope;
  });
  on("iab:reassign-session", (payload) =>
    pane.reassignActiveSession(parseId(payload, "sessionId")),
  );
  on("iab:set-backend", (payload) => pane.setBackend(parseBackend(payload)));

  // —— tabs ——
  on("iab:open-tab", (payload) => {
    // A bare "new tab" carries nothing; a payload is optional and only ever names a URL.
    if (payload === undefined || payload === null) return pane.openTabForUser();
    const record = asRecord(payload, "options");
    return pane.openTabForUser(record.url === undefined ? undefined : parseUrl(record.url, "url"));
  });
  on("iab:close-tab", (payload) => pane.closeTab(parseId(payload, "tabId")));
  on("iab:select-tab", (payload) => pane.selectTab(parseId(payload, "tabId")));
  on("iab:set-retain", (payload) => {
    const record = asRecord(payload, "retain");
    pane.setRetain(parseId(record.tabId, "tabId"), parseBoolean(record.retain, "retain"));
  });
  on("iab:set-zoom", (payload) => {
    const record = asRecord(payload, "zoom");
    pane.setZoom(parseId(record.tabId, "tabId"), parseZoomFactor(record.factor));
  });
  on("iab:navigate", async (payload) => {
    const record = asRecord(payload, "navigation");
    await pane.navigate(parseId(record.tabId, "tabId"), parseUrl(record.url, "url"));
  });
  on("iab:go-back", (payload) => pane.goBack(parseId(payload, "tabId")));
  on("iab:go-forward", (payload) => pane.goForward(parseId(payload, "tabId")));
  on("iab:reload", (payload) => pane.reload(parseId(payload, "tabId")));
  on("iab:stop", (payload) => pane.stop(parseId(payload, "tabId")));

  // —— lifecycle ——
  // A hint, carrying nothing. The renderer sees a turn start or end before the supervisor's next
  // poll would, and saying so brings that poll forward — but the answer still comes from the
  // server. This channel deliberately takes no arguments: anything it named would be a fact the
  // renderer had asserted, and a stale frame asserting a finished turn is exactly the authority a
  // leftover background command is trying to reuse.
  on("iab:tasks-changed", () => promptTaskRefresh());
  on("iab:clear-profile", () => pane.clearProfile());
  on("iab:handoff", () => pane.handoff());
  on("iab:handoff-open", async () => {
    // The URL is re-derived here from the active tab rather than accepted from the renderer.
    // `shell.openExternal` hands a string to the operating system's URL handler; a channel that
    // took one as an argument would be a "launch anything" primitive with a browser-shaped name.
    const handoff = pane.handoff();
    if (!handoff) return false;
    await shell.openExternal(handoff.url);
    return true;
  });

  // —— importing from another browser ——
  on("iab:import-sources", async () => {
    if (!importer) return { sources: [], runningBrowsers: [], credentialsAvailable: false };
    return importer.listSources();
  });
  on("iab:import-run", async (payload) => {
    if (!importer) throw new Error("Importing from another browser is not available.");
    const record = asRecord(payload, "import");
    return importer.run({
      sourceId: parseSourceIdArgument(record.sourceId),
      kinds: parseImportKinds(record.kinds),
    });
  });

  // Address-bar completion. Answers an empty list rather than throwing when there is no history
  // store: a suggestion that cannot be produced is not an error the address bar should surface.
  on("iab:history-suggest", (payload) => {
    const history = importer?.historyStore();
    if (!history) return [];
    try {
      return history.suggest(parseQuery(payload));
    } catch {
      // A corrupt or locked history database must not break typing an address.
      return [];
    }
  });

  // —— saved logins ——
  //
  // Both handlers take a **tab id**, and the service asks the pane what URL that tab is on. Neither
  // accepts an origin: a renderer that named one could ask for one site's password while the user
  // was on another. And there is deliberately no agent-facing route to either — see
  // `login-service.ts` for why that is a feature and not an omission.
  on("iab:login-offers", async (payload) => {
    if (!logins) return { formPresent: false, offers: [], unavailable: null };
    const targetId = pane.targetIdForTab(parseId(payload, "tabId"));
    if (targetId === null) return { formPresent: false, offers: [], unavailable: null };
    return logins.offersFor(targetId);
  });
  on("iab:login-fill", async (payload) => {
    if (!logins) return { ok: false, reason: "Saved logins are not available." };
    const record = asRecord(payload, "login");
    const targetId = pane.targetIdForTab(parseId(record.tabId, "tabId"));
    if (targetId === null) return { ok: false, reason: "That tab is no longer open." };
    return logins.fill({
      targetId,
      credentialId: parseId(record.credentialId, "credentialId"),
    });
  });

  return () => {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    // `handle` and `on` are different registries; the synchronous channel has to be taken off its
    // own way, or a second install would answer twice.
    ipcMain.removeListener("iab:hide-now", hideNow);
  };
}
