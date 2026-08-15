/**
 * Desktop shell main process.
 *
 * One window over the embedded server: fork penguin-server as a utilityProcess on the
 * shared data root (PENGUIN_HOME or ~/.penguin/data), learn its port (last launch's when
 * still free, so origin-scoped localStorage preferences survive restarts), and load
 * `http://localhost:<port>/api/auth/desktop-login?token=…` — the one-shot token lands
 * the window signed in as admin. The window is a plain browser environment (no preload,
 * no node integration); every capability flows through the server's HTTP API.
 *
 * Attach mode: when a live server (e.g. `penguin web`) already owns the data root, the
 * window loads that instance instead — normal login page, deliberate degradation.
 *
 * Smoke hook (PENGUIN_DESKTOP_SMOKE=1): after the first load settles, print a
 * `DESKTOP-SMOKE-RESULT {json}` line (+ screenshot when PENGUIN_DESKTOP_SMOKE_SHOT is
 * set) and quit through the regular quit path, exercising the graceful server stop.
 */
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { resolveRoot, resolveFlagsFromEnv } from "@prismshadow/penguin-core";
import { liveServerLock } from "@prismshadow/penguin-server/lock";
import { resolveWindowIcon } from "./app-icon.js";
import { BrowserPane } from "./browser-pane.js";
import {
  IAB_KEY,
  browserRelayPort,
  iabInstallId,
  startBrowserRelay,
  stopBrowserRelay,
  revealBrowserExtension,
} from "./browser-relay.js";
import { IAB_ENABLED_SWITCH, isIabAvailable } from "./iab-switch.js";
import { IabTransport } from "./iab-transport.js";
import { installBrowserIpc } from "./ipc.js";
import { installCliCommand, maybeOfferCliInstall, currentCliInstallKind } from "./cli-install.js";
import { installAppMenu } from "./menu.js";
import { startEmbeddedServer, stopEmbeddedServer } from "./server-process.js";
import type { EmbeddedServer } from "./server-process.js";
import type { UtilityProcess } from "electron";
import { initUpdater } from "./updater.js";
import {
  desktopLoginUrl,
  isAppUrl,
  isLocalSurfaceUrl,
  MAX_SERVER_RESTARTS,
  restartDelayMs,
} from "./util.js";

app.setName("PenguinHarness");
// Windows toasts (the web app's task-completion notifications) need the AppUserModelID
// of the installed shortcuts; electron-builder stamps them with the appId. Keep in sync
// with electron-builder.yml.
if (process.platform === "win32") app.setAppUserModelId("com.prismshadow.penguinharness");

let win: BrowserWindow | null = null;
let server: EmbeddedServer | null = null;
let browserRelay: UtilityProcess | null = null;
let browserPane: BrowserPane | null = null;
let iabTransport: IabTransport | null = null;
let disposeBrowserIpc: (() => void) | null = null;

/**
 * Whether the in-app browser pane is wired this run.
 *
 * Resolved once at startup from the feature flags (design/004 §5). Phase 1 ships it off by
 * default; `PENGUIN_FLAGS=iab.enabled` turns it on for development and testing. Nothing about the
 * pane — not the view, not the IPC handlers, not the relay transport — is constructed when it is
 * off, so the capability is genuinely absent rather than merely hidden.
 */
const iabEnabled = resolveFlagsFromEnv(process.env).flags["iab.enabled"];
/** App origin (embedded or attached); null until boot resolves. */
let appOrigin: string | null = null;
let quitting = false;
let stopPromise: Promise<void> | null = null;
let restartAttempts = 0;

function fatal(context: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  dialog.showErrorBox("PenguinHarness", `${context}\n\n${detail}`);
  app.exit(1);
}

function createWindow(url: string): void {
  // Resolved before the window exists, because the preload switch and the wiring below must agree:
  // advertising the bridge from the flag alone would leave the renderer showing a control whose
  // every call rejects when the relay did not come up.
  const relayPort = browserRelayPort();
  const iabAvailable = isIabAvailable({ flagEnabled: iabEnabled, relayPort });
  if (iabEnabled && !iabAvailable) {
    process.stdout.write(
      "[iab] the pane is enabled but the relay is unavailable this run, so the in-app browser is " +
        "switched off — the renderer will not offer it\n",
    );
  }

  // Linux window/taskbar icon (and Windows dev runs); packaged Windows uses the exe
  // resources and macOS its bundle icns, so those ignore it (see app-icon.ts).
  const iconPath = resolveWindowIcon(app.getAppPath(), process.platform);
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    autoHideMenuBar: true,
    ...(iconPath !== null ? { icon: iconPath } : {}),
    webPreferences: {
      // Still a plain browser: no Node integration, sandboxed, context-isolated. The one addition
      // is a preload that exposes a fixed, named set of in-app browser calls and nothing else — a
      // WebContentsView is positioned by the main process, so the renderer has no other way to say
      // where it goes. See preload-browser.ts and ipc.ts for why the break is this narrow.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // .cjs deliberately: a sandboxed preload must be CommonJS, so tsup emits both formats and
      // this picks the one Electron can load.
      preload: path.join(import.meta.dirname, "preload-browser.cjs"),
      // The preload is sandboxed and cannot read a flag itself, so main tells it whether it may
      // advertise the bridge. Without this the preload would offer channels main never installed.
      additionalArguments: iabAvailable ? [IAB_ENABLED_SWITCH] : [],
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    disposeBrowserIpc?.();
    disposeBrowserIpc = null;
    // Stop the transport with the window, not at quit. On macOS the app outlives its window, and a
    // transport left running would keep reconnecting to the relay on behalf of a pane whose views
    // no longer exist — forever, and again for every window the user reopens.
    iabTransport?.stop();
    iabTransport = null;
    browserPane?.destroy();
    browserPane = null;
    win = null;
  });

  // The pane and its transport are wired here rather than at boot because both need the window.
  // The view itself is created lazily: nothing renders until the renderer opens the pane or an
  // agent asks for a tab, so a user who never opens it pays nothing.
  if (iabAvailable && relayPort !== null) {
    const pane = new BrowserPane({
      window: win,
      onState: (state) => win?.webContents.send("iab:state", state),
      log: (message) => process.stdout.write(message),
    });
    browserPane = pane;
    disposeBrowserIpc = installBrowserIpc({ window: win, pane });

    const transport = new IabTransport({
      port: relayPort,
      key: IAB_KEY,
      installId: iabInstallId(),
      openTab: (url) => pane.openTabForAgent(url),
      liveTargets: () => pane.liveContents(),
      log: (message) => process.stdout.write(message),
    });
    pane.setViewCreatedHandler((contents) => transport.attach(contents));
    transport.start();
    iabTransport = transport;
  }

  // "Open in a new tab" (Workspace HTML previews) is an app-origin link that mints a
  // token and 302s to the preview origin — it needs the session cookie, so it must open
  // in a window of this app; handing it to the system browser would land on a 401.
  // Denying it outright (as this did at first) made the entry silently do nothing.
  // Genuinely external links still go to the system browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isLocalSurfaceUrl(target, appOrigin)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 800,
          autoHideMenuBar: true,
          ...(iconPath !== null ? { icon: iconPath } : {}),
          // Same hardening as the main window: the preview is Agent-written, untrusted
          // HTML and must never get Node.
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    void shell.openExternal(target);
    return { action: "deny" };
  });
  // The child lands on the preview origin after the redirect, so its policy is "stay
  // within this instance's loopback surface, everything else to the system browser" —
  // the main window's stricter app-origin-only rule would bounce the preview itself out.
  win.webContents.on("did-create-window", (child) => {
    child.webContents.setWindowOpenHandler(({ url: target }) => {
      if (isLocalSurfaceUrl(target, appOrigin)) return { action: "allow" };
      void shell.openExternal(target);
      return { action: "deny" };
    });
    child.webContents.on("will-navigate", (event, target) => {
      if (!isLocalSurfaceUrl(target, appOrigin)) {
        event.preventDefault();
        void shell.openExternal(target);
      }
    });
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!isAppUrl(target, appOrigin)) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });
  win.webContents.on("render-process-gone", () => win?.webContents.reload());
  armSmokeProbe(win);
  void win.loadURL(url);
}

/** Starts (or restarts) the embedded server and points the window at desktop-login. */
async function startServerAndWindow(dataRoot: string): Promise<void> {
  const started = await startEmbeddedServer({
    dataRoot,
    portFile: path.join(app.getPath("userData"), "server-port"),
    preferredPortFile: path.join(app.getPath("userData"), "preferred-port"),
    log: (chunk) => process.stdout.write(`[server] ${chunk}`),
  });
  server = started;
  appOrigin = started.origin;
  // A run that stays up for a minute is healthy: reset the restart budget so a crash
  // days later starts a fresh 1s/2s/4s ladder instead of hitting the cap immediately.
  const healthyTimer = setTimeout(() => {
    restartAttempts = 0;
  }, 60_000);
  started.child.on("exit", (code) => {
    clearTimeout(healthyTimer);
    void handleServerExit(dataRoot, code);
  });
  const url = desktopLoginUrl(started.origin, started.token);
  if (win === null) createWindow(url);
  else void win.loadURL(url);
}

/** Unexpected server death: restart with backoff; give up with an error dialog at the cap. */
async function handleServerExit(dataRoot: string, code: number): Promise<void> {
  if (quitting) return;
  server = null;
  if (restartAttempts >= MAX_SERVER_RESTARTS) {
    fatal(`The embedded server keeps exiting (last exit code ${code}).`, "Giving up.");
    return;
  }
  const wait = restartDelayMs(restartAttempts);
  restartAttempts += 1;
  process.stdout.write(`[shell] server exited (code ${code}); restarting in ${wait}ms\n`);
  await new Promise((resolve) => setTimeout(resolve, wait));
  if (quitting) return;
  try {
    await startServerAndWindow(dataRoot);
  } catch (err) {
    fatal("The embedded server could not be restarted.", err);
  }
}

async function boot(): Promise<void> {
  const dataRoot = process.env.PENGUIN_HOME ?? resolveRoot();
  const existing = await liveServerLock(dataRoot);
  if (existing !== null) {
    // Attach mode: the one-shot token only works against a server this shell spawned,
    // so the window goes through the normal login page of the existing instance.
    appOrigin = `http://localhost:${existing.port}`;
    process.stdout.write(`[shell] attaching to the running server at ${appOrigin}\n`);
    createWindow(`${appOrigin}/`);
    return;
  }
  await startServerAndWindow(dataRoot);
}

// --- app lifecycle ---------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win !== null) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("window-all-closed", () => {
    // macOS keeps the app alive in the Dock; elsewhere closing the window quits.
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (win === null && appOrigin !== null) createWindow(`${appOrigin}/`);
  });

  // Quit path: stop the embedded server gracefully first (shutdown endpoint → kill),
  // then let the quit proceed. Attach mode has no child to stop.
  app.on("before-quit", (event) => {
    quitting = true;
    if (stopPromise !== null) return;
    if (server === null && browserRelay === null) return;
    event.preventDefault();
    const running = server;
    const relay = browserRelay;
    server = null;
    browserRelay = null;
    iabTransport?.stop();
    iabTransport = null;
    stopPromise = Promise.all([
      running !== null ? stopEmbeddedServer(running) : Promise.resolve(),
      stopBrowserRelay(relay),
    ])
      .then(() => undefined)
      .finally(() => app.quit());
  });

  void app.whenReady().then(() =>
    (async () => {
      // Standard menu plus native desktop-only actions; the window gets no IPC channel.
      installAppMenu({
        includeCliInstall: currentCliInstallKind() !== null,
        onInstallCli: () => void installCliCommand(win),
        onLoadExtension: () => void revealBrowserExtension(win),
      });
      initUpdater(() => win);
      browserRelay = await startBrowserRelay((chunk) => process.stdout.write(chunk), {
        iabEnabled,
      });
      await boot();
      // First launch only: offer the CLI commands once; the menu entry remains.
      // Skipped in smoke mode — a modal dialog would hang the automated run.
      if (process.env.PENGUIN_DESKTOP_SMOKE !== "1") await maybeOfferCliInstall(win);
    })().catch((err) => fatal("PenguinHarness failed to start.", err)),
  );
}

// --- smoke hook ------------------------------------------------------------

/** Render-settle delay before sampling the page in smoke mode. */
const SMOKE_SETTLE_MS = 2500;

function armSmokeProbe(target: BrowserWindow): void {
  if (process.env.PENGUIN_DESKTOP_SMOKE !== "1") return;
  target.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      void (async () => {
        try {
          const result = {
            title: target.webContents.getTitle(),
            url: target.webContents.getURL(),
            origin: appOrigin,
            embedded: server !== null,
          };
          const shot = process.env.PENGUIN_DESKTOP_SMOKE_SHOT;
          if (shot) {
            const image = await target.webContents.capturePage();
            const { writeFileSync } = await import("node:fs");
            writeFileSync(shot, image.toPNG());
          }
          process.stdout.write(`DESKTOP-SMOKE-RESULT ${JSON.stringify(result)}\n`);
        } catch (err) {
          process.stdout.write(`DESKTOP-SMOKE-RESULT ${JSON.stringify({ error: String(err) })}\n`);
        } finally {
          app.quit();
        }
      })();
    }, SMOKE_SETTLE_MS);
  });
}
