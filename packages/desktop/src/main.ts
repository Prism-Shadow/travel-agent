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
import nodeFs from "node:fs";
import { app, BrowserWindow, dialog, safeStorage, shell } from "electron";
import { resolveRoot, resolveFlagsFromEnv } from "@prismshadow/penguin-core";
import { liveServerLock } from "@prismshadow/penguin-server/lock";
import { planBoot } from "./boot-plan.js";
import { resolveWindowIcon } from "./app-icon.js";
import { BrowserPane } from "./browser-pane.js";
import {
  IAB_KEY,
  browserRelayPort,
  iabInstallId,
  relayMovedOffConventionalPort,
  startBrowserRelay,
  stopBrowserRelay,
  revealBrowserExtension,
  revealBrowserExtensionStatus,
} from "./browser-relay.js";
import { attachShortcutRouter } from "./browser-shortcut-router.js";
// Deep subpath, like the relay discovery helper above: importing the package root would pull in
// the relay itself and its side effects.
import {
  readAllBackendPreferences,
  writeBackendPreference,
} from "penguin-browser/dist/relay-discovery.js";
import { IAB_ENABLED_SWITCH, isIabAvailable } from "./iab-switch.js";
import { IabTransport } from "./iab-transport.js";
import { installBrowserIpc } from "./ipc.js";
import { batchSessions, parseBrowserTaskState, TaskSupervisor } from "./task-supervisor.js";
import type { SessionTaskState } from "./task-supervisor.js";
import { resolveSessionDownloadDir } from "./session-partition.js";
import { installCliCommand, maybeOfferCliInstall, currentCliInstallKind } from "./cli-install.js";
import { installAppMenu } from "./menu.js";
import { startEmbeddedServer, stopEmbeddedServer } from "./server-process.js";
import { startVaultShell } from "./vault-shell.js";
import { paneTargetResolver } from "./vault/pane-target-resolver.js";
import { DebuggerFillPort } from "./vault/debugger-fill-port.js";
import { LoginService } from "./browser-import/login-service.js";
import { BrowserImporter } from "./browser-import/importer.js";
import { electronSafeStorage, judgeStorage, readStorageFacts } from "./vault/safe-storage.js";
import { iabSession } from "./session-partition.js";
import { fileCrashSink, installCrashReporting } from "./crash-reporting.js";
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
let taskSupervisor: TaskSupervisor | null = null;
/**
 * The vault side of the shell (design/004 Phase 4), when this build's flags and this machine's
 * keychain allow it. Null everywhere it is off — the tools that depend on it are then simply not
 * offered to the agent, which is the honest shape of a disabled capability.
 */
let vaultShell: Awaited<ReturnType<typeof startVaultShell>> = null;

/**
 * Importing from the user's own Chrome, and the two stores that import fills.
 *
 * Lives beside the pane rather than inside it: the history store it owns outlives any one tab, and
 * the credential store must not be reachable from anything that renders a page.
 */
let browserImporter: BrowserImporter | null = null;

/**
 * Whether the in-app browser pane is wired this run.
 *
 * Resolved once at startup from the feature flags (design/004 §5). The pane is a product default,
 * so `pnpm desktop` wires it without an environment override; `PENGUIN_FLAGS=iab.enabled=false`
 * remains an explicit diagnostic opt-out. When it is off, no view, IPC handlers or IAB transport
 * are constructed, so the capability is genuinely absent rather than merely hidden.
 */
const resolvedFlags = resolveFlagsFromEnv(process.env).flags;
const iabEnabled = resolvedFlags["iab.enabled"];
/**
 * Whether the Chrome extension backend may be offered as an alternative to the in-app browser.
 *
 * It ships on, while IAB remains the selection for new conversations. The flag stays as a
 * diagnostic/rollback opt-out; main still enforces it because a disabled renderer control alone is
 * not a capability boundary.
 */
const chromeFallbackEnabled = resolvedFlags["chrome.fallback"];
/** App origin (embedded or attached); null until boot resolves. */
let appOrigin: string | null = null;
/**
 * The data root this app is serving, once boot has resolved it.
 *
 * Held because the in-app browser writes downloads into a Session's own scratchpad underneath it,
 * and the path must be built from what main knows rather than from anything the renderer says.
 */
let appDataRoot: string | null = null;
let quitting = false;
let stopPromise: Promise<void> | null = null;
let restartAttempts = 0;

function fatal(context: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  dialog.showErrorBox("PenguinHarness", `${context}\n\n${detail}`);
  app.exit(1);
}

/**
 * Asks the server which turns are running, as the app's own window.
 *
 * Through the window's session, so the request carries the same cookie the window signed in with.
 * That is what makes this work in **both** modes the shell runs in: when it forked the server it
 * holds a desktop token, but when it attached to one somebody else started (`penguin web`) there is
 * no token and no desktop mode at all — and a token-only channel would leave that mode permanently
 * unable to release a finished turn's tabs.
 *
 * Fails closed. Before the window has signed in, and whenever the server is unreachable, this
 * throws and the supervisor applies nothing: treating "cannot ask" as "nothing is running" would
 * release the tabs of every turn still in progress.
 */
async function fetchBrowserTaskState(
  window: BrowserWindow | null,
  origin: string | null,
  sessionIds: string[],
): Promise<SessionTaskState[]> {
  if (!window || window.isDestroyed() || origin === null) {
    throw new Error("the app window is not ready to ask the server about task state");
  }
  // In batches, because the server refuses a query naming more conversations than it will answer
  // about, and the pane holds tabs across as many conversations as the user has visited. Every
  // batch must come back complete: a single failure throws, the supervisor applies nothing, and the
  // next tick asks again — which is the same fail-closed rule as an unreachable server.
  const states: SessionTaskState[] = [];
  for (const batch of batchSessions(sessionIds)) {
    const url = new URL("/api/sessions/browser-tasks", origin);
    url.searchParams.set("sessions", batch.join(","));
    // `session.fetch`, not `net.fetch`: the latter always issues from the default session, and the
    // cookie that authenticates this request belongs to the window's.
    const response = await window.webContents.session.fetch(url.toString(), {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`the server answered ${response.status} for browser task state`);
    }
    states.push(...parseBrowserTaskState((await response.json()) as unknown, batch));
  }
  return states;
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
    taskSupervisor?.stop();
    taskSupervisor = null;
    browserPane?.destroy();
    browserPane = null;
    win = null;
  });

  // The pane and its transport are wired here rather than at boot because both need the window.
  // The view itself is created lazily: nothing renders until the renderer opens the pane or an
  // agent asks for a tab, so a user who never opens it pays nothing.
  if (iabAvailable && relayPort !== null) {
    // Declared before the pane so the pane's close callback can reach it; assigned right after,
    // because the transport in turn needs the pane's ownership check.
    let transport: IabTransport | null = null;
    const pane = new BrowserPane({
      window: win,
      onState: (state) => win?.webContents.send("iab:state", state),
      // Tabs outlive a run that crashes, which is the whole point of the checkpoint: the file
      // surviving into the next launch is the evidence that the last one never shut down.
      checkpointPath: path.join(app.getPath("userData"), "iab-tabs.json"),
      // Told before the view is destroyed, because afterwards there is nothing left to look the
      // CDP session up by.
      onTabClosedByUser: (notice) => transport?.noteUserClosed(notice),
      // The choice of backend is read by a different process — the CLI, when the agent asks for an
      // in-app browser session — so it is persisted where that process looks. Per conversation,
      // because two chats can legitimately want different browsers (design/002 §6.1).
      initialBackends: readAllBackendPreferences(),
      // The extension connects to the conventional relay port, which this run may not own. Every
      // command the agent runs resolves *this* relay, so offering a backend that lives on another
      // one would produce a conversation whose browser sessions cannot be created.
      // Two conditions, both real. The flag is the product decision that the Chrome backend is
      // offered at all (design/004 §5); the port is whether it could work in this run.
      extensionBackendAvailable: chromeFallbackEnabled && !relayMovedOffConventionalPort(),
      onBackendChange: (sessionId, backend) => writeBackendPreference(sessionId, backend),
      onBackendSelected: (backend) => {
        if (backend === "extension") void revealBrowserExtensionStatus(win, relayPort);
      },
      // Feeds the address bar's completion. Goes through the importer because it owns the history
      // store's lifetime — the import fills it, ordinary browsing keeps it current.
      onVisit: (visit) => browserImporter?.historyStore()?.record(visit),
      onNotifyRelay: (method, params) => transport?.notify(method, params),
      // An agent's first command in a turn can outrun the poll; this makes the race a bounded wait.
      refreshTaskState: async () => {
        await taskSupervisor?.reconcile();
      },
      // The Session's own scratchpad, built from *our* data root and the server's own answer for
      // which Agent the conversation belongs to. The renderer never names either.
      onSessionResolved: (ids) => {
        if (appDataRoot === null) return;
        const directory = resolveSessionDownloadDir(appDataRoot, ids);
        // The root travels with the directory: containment is checked again when the file is
        // written, because between now and then anything running as the user can turn a component
        // of that path into a link pointing somewhere else.
        if (directory) {
          pane.setSessionDownloadDir(ids.sessionId, { directory, root: appDataRoot });
        }
      },
      log: (message) => process.stdout.write(message),
    });
    browserPane = pane;

    // The authority for which turns are running, owned here rather than in the renderer: the chat
    // page disposes its stream on a route change and a reload takes its bookkeeping with it, so a
    // task that finished while the user was elsewhere would never be reported. A reconcile loop
    // against the server converges after all of those without a queue, an acknowledgement or a
    // retry to lose.
    taskSupervisor = new TaskSupervisor({
      fetchState: (sessionIds) => fetchBrowserTaskState(win, appOrigin, sessionIds),
      sessionsOfInterest: () => pane.sessionsOfInterest(),
      apply: (states) => pane.applyTaskState(states),
      log: (message) => process.stdout.write(message),
    });
    taskSupervisor.start();

    // Bringing cookies, saved logins and history over from the user's own Chrome. Constructed
    // eagerly because it is cheap — it opens nothing and unlocks nothing until the dialog asks —
    // and its two stores are built lazily inside it, so a user who never imports never gets a
    // history database or a keychain prompt.
    browserImporter = new BrowserImporter({
      session: iabSession(),
      userDataDir: app.getPath("userData"),
      safeStorage: electronSafeStorage(safeStorage),
      availability: judgeStorage(readStorageFacts(safeStorage)),
      log: (message) => process.stdout.write(`[import] ${message}\n`),
    });

    // Offering an imported password on a sign-in page. Wired independently of the vault shell:
    // those credentials come from the user's own browser, not from the vault, so gating them on
    // `vault.enabled` would switch off a feature that has nothing to do with it. It gets its own
    // fill port over the same pane resolver — the port is a thin wrapper, and sharing the vault's
    // would tie this to whether the vault started.
    const loginService = new LoginService({
      credentials: () => browserImporter?.credentialStore() ?? Promise.resolve(null),
      world: new DebuggerFillPort(paneTargetResolver(pane)),
      tabs: { urlOf: (targetId) => paneTargetResolver(pane).urlOf(targetId) },
      log: (message) => process.stdout.write(`[logins] ${message}\n`),
    });

    disposeBrowserIpc = installBrowserIpc({
      window: win,
      pane,
      promptTaskRefresh: () => taskSupervisor?.prompt(),
      importer: browserImporter,
      logins: loginService,
    });

    // Cmd+L has to reach a DOM element main cannot touch: the routing table decides, the renderer
    // does the focusing.
    const shortcuts = {
      pane,
      focusAddressBar: () => win?.webContents.send("iab:focus-address"),
    };

    transport = new IabTransport({
      port: relayPort,
      key: IAB_KEY,
      installId: iabInstallId(),
      openTab: (options) => pane.openTabForAgent(options),
      liveTargets: () => pane.liveContents(),
      activeTarget: () => pane.activeContents(),
      taskTarget: (taskId) => pane.taskContents(taskId),
      mayDrive: (contents, taskId) => pane.mayDrive(contents, taskId),
      claimTab: (targetId, identity) => pane.claimTab(targetId, identity),
      ownershipOf: (contents) => pane.ownershipOf(contents),
      // Declare only. The agent says how its task went when it closes its browser session, which
      // is before the turn is actually over; the rules run at the harness's own idle boundary.
      declareOutcome: (taskId, outcome) => pane.declareTaskOutcome(taskId, outcome),
      log: (message) => process.stdout.write(message),
    });
    pane.setViewCreatedHandler((contents) => {
      transport?.attach(contents);
      // Keyboard focus can be inside a page as easily as inside the app, and the shortcuts have to
      // work either way (design/004 M9). Same table, both paths.
      attachShortcutRouter(contents, shortcuts);
    });
    attachShortcutRouter(win.webContents, shortcuts);
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
  appDataRoot = dataRoot;
  // The vault comes up before the server, because the server is forked with the broker's socket
  // and token in its environment and there is no second channel to hand them over (003 §11.2).
  // A failure here is not fatal: the vault stays off, its reason is on the settings page, and the
  // rest of the app runs. Only started once — a server restart reuses the running broker.
  if (vaultShell === null && browserPane !== null) {
    try {
      const pane = browserPane;
      vaultShell = await startVaultShell({
        dataRoot,
        targets: paneTargetResolver(pane),
        // Resolves a vault call's `"current"` target to the tab the turn is working in, so a
        // secure_fill or a payment need not name its target id. Null (no owned live tab, or one
        // without a target id yet) is the pane's own fail-closed answer, which the broker handlers
        // already turn into "no page open".
        currentTarget: async ({ taskId }) => pane.taskTargetId(taskId),
      });
    } catch (err) {
      process.stdout.write(`[shell] vault did not start: ${String((err as Error).message)}\n`);
    }
  }
  const started = await startEmbeddedServer({
    dataRoot,
    portFile: path.join(app.getPath("userData"), "server-port"),
    preferredPortFile: path.join(app.getPath("userData"), "preferred-port"),
    log: (chunk) => process.stdout.write(`[server] ${chunk}`),
    ...(vaultShell ? { extraEnv: vaultShell.env() } : {}),
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
  const root = process.env.PENGUIN_HOME ?? resolveRoot();
  const plan = planBoot(root, await liveServerLock(root));
  // Before the branch, and for both modes. Downloads are resolved from this — a mode that leaves it
  // unset does not fail loudly, it silently cancels every download in that mode, which is exactly
  // what attach mode used to do.
  appDataRoot = plan.dataRoot;
  if (plan.mode === "attach") {
    // The one-shot token only works against a server this shell spawned, so the window goes through
    // the normal login page of the existing instance. The in-app browser is unaffected: it asks the
    // server about running turns over the window's own session cookie, which both modes have.
    appOrigin = plan.origin;
    process.stdout.write(`[shell] attaching to the running server at ${plan.origin}\n`);
    createWindow(`${plan.origin}/`);
    return;
  }
  await startServerAndWindow(plan.dataRoot);
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
    const vault = vaultShell;
    server = null;
    browserRelay = null;
    vaultShell = null;
    iabTransport?.stop();
    iabTransport = null;
    // Closes the history database and wipes the credential store's master key. Synchronous and
    // immediate rather than part of the promise below: neither has anything in flight worth
    // waiting for, and a key that is still in the heap during a slow server shutdown is a key
    // that did not need to be.
    browserImporter?.dispose();
    browserImporter = null;
    stopPromise = Promise.all([
      running !== null ? stopEmbeddedServer(running) : Promise.resolve(),
      stopBrowserRelay(relay),
      // Locks the vault (wiping keys) and closes the broker. After the server is asked to stop, so
      // an in-flight fill or payment there is not cut off mid-write — its journal bracket is what
      // makes even a hard kill safe, but a clean stop is cleaner.
      vault ? vault.close().catch(() => undefined) : Promise.resolve(),
    ])
      .then(() => undefined)
      .finally(() => app.quit());
  });

  void app.whenReady().then(() =>
    (async () => {
      // Record crashes in all three processes to a local, value-free log before anything else can
      // crash (design/004 Phase 5, 003 §4.6). The payload is scrubbed through the shared secret
      // redaction; nothing user-identifying or secret is written. Best-effort and non-fatal.
      installCrashReporting({
        // Electron's `App` and Node's `Process` carry these methods; the port names just the
        // subset the reporter uses, so a structural cast is the honest bridge.
        app: app as unknown as Parameters<typeof installCrashReporting>[0]["app"],
        process: process as unknown as Parameters<typeof installCrashReporting>[0]["process"],
        sink: fileCrashSink({
          dir: path.join(app.getPath("userData"), "crash-reports"),
          mkdirSync: (dir) => nodeFs.mkdirSync(dir, { recursive: true }),
          appendFileSync: (file, data) => nodeFs.appendFileSync(file, data),
          join: path.join,
          log: (line) => process.stdout.write(`[crash] ${line}`),
        }),
        surfaceOf: (contents) =>
          browserPane?.ownershipOf(contents as never) ? "in-app browser view" : "app window",
      });

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
