/**
 * penguin-browser relay lifecycle and on-disk locations inside the desktop app.
 *
 * The agent talks to the CLI over PATH (`penguin-browser serve` / `session new`). The
 * shell starts the relay next to the embedded server so a packaged install does not
 * require a second terminal. Chrome still needs the user to load the bundled unpacked
 * extension — the OS will not inject it into their everyday profile.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, dialog, shell, utilityProcess } from "electron";
import type { BrowserWindow, UtilityProcess } from "electron";
// Deep subpath on purpose. The package root re-exports cdp-relay, whose module body mutates
// Buffer.prototype's inspect hook and drags the whole Hono/relay dependency graph in — a heavy and
// globally visible price for reading one JSON file. relay-discovery imports only node builtins.
import {
  clearDiscoveryIfOwned,
  isPortListening,
  writeDiscovery,
} from "penguin-browser/dist/relay-discovery.js";

/**
 * Per-run secret for the relay's `/iab` transport.
 *
 * Generated once per launch and handed to the relay through its environment, never through argv —
 * a command line is readable by every process on the machine. This is exactly why the shell will
 * not reuse a relay it did not start: that relay never received this value.
 */
export const IAB_KEY = randomBytes(32).toString("hex");

/**
 * Stable identity for this installation's in-app browser.
 *
 * The relay refuses to back a persistent session with a backend that cannot identify itself across
 * reconnects. Unlike the per-run key this *is* written down, in userData, because its whole job is
 * to survive restarts. It is opaque and authorises nothing on its own.
 */
export function iabInstallId(): string {
  const file = path.join(app.getPath("userData"), "iab-install-id");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // Missing or unreadable: fall through and mint a new one.
  }
  const created = randomBytes(16).toString("hex");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, created, { mode: 0o600 });
  } catch {
    // A read-only userData still gets a working id for this run; only persistence is lost.
  }
  return created;
}

/** The port the Chrome extension has compiled in. Preferred, so the extension keeps working. */
export const CONVENTIONAL_RELAY_PORT = 19989;

/**
 * Port the shell's relay listens on this run, and the identity that owns the discovery record.
 *
 * 19989 when it is free — the extension's `PENGUIN_BROWSER_PORT` is baked in at build time, so the
 * default IAB and the optional extension backend share the conventional relay whenever possible.
 * A dynamic port is used only when 19989 is already taken.
 *
 * What the shell will *not* do is reuse a relay it did not start. The `/iab` key is minted per
 * launch and given only to the relay this process forks; attaching to a stranger's would 401 on
 * every reconnect, silently, for anyone who had run `penguin-browser serve` earlier. Nor does it
 * kill that process: it is not ours.
 */
let relayPort: number | null = null;
let relayInstanceId: string | null = null;

/** The relay port for this run, or null when the relay is not up. */
export function browserRelayPort(): number | null {
  return relayPort;
}

/**
 * True when the shell had to move off the conventional port.
 *
 * The Chrome extension cannot follow: its port is fixed at build time, so it stays connected to
 * whatever owns 19989 while this app runs its own relay elsewhere. Every command the agent runs
 * resolves *this* relay (see the CLI's `getServerUrl`), so in that state the extension backend is
 * not reachable from this app at all.
 *
 * The resolution is to say so rather than to route around it: `main.ts` passes this to the pane,
 * which refuses `setBackend('extension')` and reports the option as unavailable with a reason the
 * user can act on. Splitting a conversation across two relays — sessions on one, execution on the
 * other — was the alternative, and it fails as "session 3 not found" with nothing pointing at the
 * cause.
 */
export function relayMovedOffConventionalPort(): boolean {
  return relayPort !== null && relayPort !== CONVENTIONAL_RELAY_PORT;
}

/** penguin-browser CLI entry (packaged deploy tree, or this repo's packages/browser-cli). */
export function browserCliEntryPath(): string {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), "node_modules", "penguin-browser", "dist", "cli.js");
  }
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "browser-cli",
    "dist",
    "cli.js",
  );
}

/** Unpacked extension the user loads in chrome://extensions. */
export function extensionDistPath(): string {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), "resources", "penguin-browser-extension");
  }
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "browser-extension",
    "dist",
  );
}

/** Prepend the staged bin/ so agent exec_command finds `penguin-browser` without a login shell. */
export function pathWithPackagedBin(existing = process.env.PATH ?? ""): string {
  if (!app.isPackaged) return existing;
  const bin = path.join(app.getAppPath(), "bin");
  return `${bin}${path.delimiter}${existing}`;
}

/** Binds a port to see whether it is free, then releases it. */
function probeFreePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/** Asks the OS for any free loopback port. */
function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a loopback port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** Whether whatever holds a port answers as a penguin-browser relay. */
async function isCompatibleRelay(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string";
  } catch {
    return false;
  }
}

export type RelayPlan =
  | { action: "own"; port: number; reason: string }
  | { action: "reuse"; port: number; reason: string }
  | { action: "fail"; reason: string };

/**
 * Environment for the relay process this Desktop run owns.
 *
 * Explicitly removes inherited relay variables before writing canonical ones. The comparison is
 * case-insensitive because Windows environment names are case-insensitive: leaving a mixed-case
 * `Penguin_Iab_Key` behind could arm `/iab` even though the pane, IPC and transport were disabled.
 */
export function relayChildEnvironment(
  base: NodeJS.ProcessEnv,
  port: number,
  iabEnabled: boolean,
): NodeJS.ProcessEnv {
  const managed = new Set(["PENGUIN_BROWSER_PORT", "PENGUIN_IAB_KEY"]);
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (!managed.has(name.toUpperCase())) env[name] = value;
  }
  env.PENGUIN_BROWSER_PORT = String(port);
  if (iabEnabled) env.PENGUIN_IAB_KEY = IAB_KEY;
  return env;
}

/**
 * Decides what to do about the relay before anything is started.
 *
 * Three forces meet here, and getting any one of them wrong is a real regression:
 *
 *   - **The Chrome extension has 19989 compiled in.** It cannot follow a dynamic port, so the app
 *     must prefer the conventional one whenever it is free. Moving gratuitously would make the
 *     optional extension backend unreachable from this Desktop run.
 *   - **The `/iab` key is minted per launch.** A relay this process did not fork has never seen it,
 *     so the in-app browser cannot use a borrowed relay: the transport would 401 forever, silently.
 *   - **Someone else's process is not ours to kill.**
 *
 * Which is why the answer depends on the flag. With the pane off there is no key to honour, so a
 * healthy existing relay is reused exactly as before. With it on, a taken port forces this app onto
 * its own — and the extension backend then becomes unavailable *to this app*, which the browser
 * panel says out loud (see `relayMovedOffConventionalPort`) instead of offering a choice that
 * cannot work.
 */
export function planRelay(input: {
  iabEnabled: boolean;
  conventionalPortFree: boolean;
  existingIsCompatibleRelay: boolean;
  ephemeralPort: number;
  conventionalPort?: number;
}): RelayPlan {
  const conventional = input.conventionalPort ?? CONVENTIONAL_RELAY_PORT;

  if (input.conventionalPortFree) {
    return {
      action: "own",
      port: conventional,
      reason: "the conventional port is free, so the extension keeps working against this relay",
    };
  }

  if (!input.existingIsCompatibleRelay) {
    return {
      action: "fail",
      reason:
        `port ${conventional} is held by something that is not a penguin-browser relay. ` +
        "Free it, or stop the process using it, then restart the app.",
    };
  }

  if (!input.iabEnabled) {
    return {
      action: "reuse",
      port: conventional,
      reason:
        "a healthy relay is already running and the in-app browser is off, so this app uses it " +
        "rather than starting a second one",
    };
  }

  return {
    action: "own",
    port: input.ephemeralPort,
    reason:
      `${conventional} belongs to another relay, which never received this run's in-app browser ` +
      "key, so this app starts its own. The Chrome extension keeps using the other one.",
  };
}

/** How long the relay gets to start listening before we call it a failed launch. */
const RELAY_LISTEN_TIMEOUT_MS = 10_000;

export async function startBrowserRelay(
  log: (chunk: string) => void,
  options: { iabEnabled: boolean },
): Promise<UtilityProcess | null> {
  const entry = browserCliEntryPath();
  if (!fs.existsSync(entry)) {
    log(`[browser] CLI missing at ${entry}; relay not started\n`);
    return null;
  }

  const conventionalPortFree = await probeFreePort(CONVENTIONAL_RELAY_PORT);
  const existingIsCompatibleRelay = conventionalPortFree
    ? false
    : await isCompatibleRelay(CONVENTIONAL_RELAY_PORT);

  let ephemeralPort = 0;
  if (!conventionalPortFree && existingIsCompatibleRelay && options.iabEnabled) {
    try {
      ephemeralPort = await reserveEphemeralPort();
    } catch (error) {
      log(`[browser] could not reserve a port for the relay: ${(error as Error).message}\n`);
      return null;
    }
  }

  const plan = planRelay({
    iabEnabled: options.iabEnabled,
    conventionalPortFree,
    existingIsCompatibleRelay,
    ephemeralPort,
  });
  log(`[browser] ${plan.reason}\n`);

  if (plan.action === "fail") return null;
  if (plan.action === "reuse") {
    // Deliberately leaves relayPort null: this app does not own that relay, must not publish
    // discovery pointing at it, and must not hand it a key it cannot verify.
    return null;
  }

  const port = plan.port;
  const instanceId = randomBytes(8).toString("hex");
  const child = utilityProcess.fork(entry, ["serve", "--host", "127.0.0.1"], {
    serviceName: "penguin-browser-relay",
    stdio: "pipe",
    // The relay reads its port and, only when IAB is enabled, its /iab key from the environment.
    // The port also goes to the embedded server so the agent's CLI reaches *this* relay; the key
    // does not, and never leaves processes this app forks.
    env: relayChildEnvironment(process.env, port, options.iabEnabled),
  });
  child.stdout?.on("data", (chunk: Buffer) => log(String(chunk)));
  child.stderr?.on("data", (chunk: Buffer) => log(String(chunk)));

  let exited = false;
  child.once("exit", (code) => {
    exited = true;
    log(`[browser] relay exited (code ${code})\n`);
  });

  // Publish only once the relay is actually accepting connections. Announcing straight after
  // reserving would leave a record pointing at nothing whenever the bind lost a race or the child
  // died on startup, and a reader following it would wait on a socket that never answers.
  const deadline = Date.now() + RELAY_LISTEN_TIMEOUT_MS;
  let listening = false;
  while (!exited && Date.now() < deadline) {
    if (await isPortListening(port)) {
      listening = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!listening) {
    log(`[browser] relay never started listening on ${port}; the in-app browser is unavailable\n`);
    if (!exited) child.kill();
    return null;
  }

  relayPort = port;
  relayInstanceId = instanceId;
  // Only worth publishing when this app moved off the conventional port: a reader that finds
  // nothing falls back to 19989, which is exactly right in the common case.
  if (port !== CONVENTIONAL_RELAY_PORT) {
    try {
      writeDiscovery({ port, pid: process.pid, instanceId, startedAt: new Date().toISOString() });
    } catch (error) {
      log(`[browser] could not publish relay discovery: ${(error as Error).message}\n`);
    }
  }

  log(`[browser] relay listening on 127.0.0.1:${port} (${entry})\n`);
  return child;
}

/** Tell the user how to load the bundled unpacked extension. Chrome will not accept a silent install. */
export async function revealBrowserExtension(win: BrowserWindow | null): Promise<void> {
  const dir = extensionDistPath();
  if (!fs.existsSync(path.join(dir, "manifest.json"))) {
    const opts = {
      type: "error" as const,
      title: "Penguin Browser",
      message: "The bundled extension is missing.",
      detail: `Expected ${dir}. Rebuild the desktop app (pnpm -r build && stage).`,
    };
    await (win !== null ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
    return;
  }
  const opts = {
    type: "info" as const,
    title: "Load the Penguin Browser extension",
    message: "Chrome cannot be given this extension automatically.",
    detail: `1. Open chrome://extensions\n2. Turn on Developer mode\n3. Load unpacked and choose:\n${dir}\n4. Keep "My own Chrome" selected in the Browser menu. The agent may create its own task tabs. To let it use a tab you already opened, click the extension icon on that tab.`,
    buttons: ["Open folder", "OK"],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = await (win !== null
    ? dialog.showMessageBox(win, opts)
    : dialog.showMessageBox(opts));
  if (response === 0) void shell.openPath(dir);
}

/**
 * Whether a real Chrome extension (not the reserved IAB backend) is connected to this relay.
 *
 * Selection and connection are deliberately different states: Chrome remains a valid
 * per-conversation choice while the user completes its one-time setup. This check exists only to
 * decide whether selecting it should open that setup, never to silently change the backend.
 */
export async function hasConnectedBrowserExtension(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/extensions/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { extensions?: unknown };
    return Array.isArray(body.extensions) && body.extensions.length > 0;
  } catch {
    return false;
  }
}

/** Reports a ready connection, or opens the one-time setup when Chrome has not connected yet. */
export async function revealBrowserExtensionStatus(
  win: BrowserWindow | null,
  port: number | null = browserRelayPort(),
): Promise<void> {
  if (port !== null && (await hasConnectedBrowserExtension(port))) {
    const opts = {
      type: "info" as const,
      title: "Penguin Browser",
      message: "Chrome is connected and ready for the next task.",
      detail:
        "The agent may create its own task tabs. If more than one Chrome profile is connected, it will ask which one to use. To use a tab you already opened, click the Penguin Browser extension icon on that tab.",
      buttons: ["OK"],
    };
    await (win !== null ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
    return;
  }
  await revealBrowserExtension(win);
}

export async function stopBrowserRelay(child: UtilityProcess | null): Promise<void> {
  relayPort = null;
  // Only our own record. A shell that crashed and was restarted has already published a new one,
  // and deleting unconditionally would erase the live entry on the old instance's way out.
  if (relayInstanceId) clearDiscoveryIfOwned(relayInstanceId);
  relayInstanceId = null;
  if (child === null) return;
  await new Promise<void>((resolve) => {
    const done = (): void => resolve();
    child.once("exit", done);
    child.kill();
    setTimeout(done, 2000);
  });
}
