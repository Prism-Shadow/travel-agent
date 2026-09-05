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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, dialog, shell, utilityProcess } from "electron";
import type { BrowserWindow, UtilityProcess } from "electron";
// Deep subpath on purpose. The package root re-exports cdp-relay, whose module body mutates
// Buffer.prototype's inspect hook and drags the whole Hono/relay dependency graph in — a heavy and
// globally visible price for reading one JSON file. relay-discovery imports only node builtins.
import { DISCOVERY_BASE_DIR } from "penguin-browser/dist/relay/relay-discovery.js";

import {
  writeDesktopRecord,
  removeDesktopRecord,
  type DesktopRecord,
} from "penguin-browser/dist/relay/desktop-registry.js";
import { registerNativeHost } from "./native-host-registration.js";

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
    if (/^[a-f0-9]{32}$/.test(existing)) return existing;
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

/** Desktop always owns a private endpoint; standalone CLI ports are unrelated. */
let relayPort: number | null = null;
let relayRecord: DesktopRecord | null = null;
let nativeHostReady = false;
const availabilityListeners = new Set<(available: boolean) => void>();
export function onBrowserExtensionAvailability(listener: (available: boolean) => void): () => void {
  availabilityListeners.add(listener);
  return () => {
    availabilityListeners.delete(listener);
  };
}
function publishAvailability(): void {
  for (const listener of availabilityListeners) listener(browserExtensionAvailable());
}

export function browserRelayPort(): number | null {
  return relayPort;
}
export function browserRelayInstanceId(): string | undefined {
  return relayRecord?.instanceId;
}
export function browserExtensionAvailable(): boolean {
  return relayPort !== null && nativeHostReady;
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
  const managed = new Set([
    "PENGUIN_BROWSER_PORT",
    "PENGUIN_BROWSER_HOST",
    "PENGUIN_BROWSER_TOKEN",
    "PENGUIN_IAB_KEY",
    "PENGUIN_EXTENSION_KEY",
    "PENGUIN_RELAY_INSTANCE_ID",
    "PENGUIN_RELAY_INSTALLATION_ID",
    "PENGUIN_RELAY_OWNER_PID",
  ]);
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (!managed.has(name.toUpperCase())) env[name] = value;
  }
  env.PENGUIN_BROWSER_PORT = String(port);
  if (iabEnabled) env.PENGUIN_IAB_KEY = IAB_KEY;
  return env;
}

/** Pin server-spawned tasks even when relay startup failed; never inherit a foreign endpoint. */
export function browserTaskEnvironment(
  base: NodeJS.ProcessEnv,
  endpoint: { port: number; instanceId: string } | null = relayRecord,
): NodeJS.ProcessEnv {
  return {
    ...relayChildEnvironment(base, endpoint?.port ?? 0, false),
    PENGUIN_RELAY_INSTANCE_ID: endpoint?.instanceId ?? "unavailable",
  };
}

/** Fork one owned relay and await the actual OS-assigned port, never probe-and-release. */
export async function startBrowserRelay(
  log: (chunk: string) => void,
  options: { iabEnabled: boolean },
): Promise<UtilityProcess | null> {
  const entry = path.join(path.dirname(browserCliEntryPath()), "desktop-relay-entry.js");
  if (!fs.existsSync(entry)) {
    log("[browser] Desktop relay is missing; rebuild the workspace\n");
    return null;
  }
  const installationId = iabInstallId();
  const instanceId = randomBytes(16).toString("hex");
  const extensionKey = randomBytes(32).toString("hex");
  const name = app.isPackaged
    ? "Travel Agent"
    : `Travel Agent · ${path.basename(path.resolve(app.getAppPath(), "../.."))}`;
  const child = utilityProcess.fork(entry, [], {
    serviceName: "travel-browser-relay",
    stdio: "pipe",
    env: {
      ...relayChildEnvironment(process.env, 0, options.iabEnabled),
      PENGUIN_RELAY_INSTALLATION_ID: installationId,
      PENGUIN_RELAY_INSTANCE_ID: instanceId,
      PENGUIN_RELAY_OWNER_PID: String(process.pid),
      PENGUIN_EXTENSION_KEY: extensionKey,
      PENGUIN_RELAY_NAME: name,
    },
  });
  child.stderr?.on("data", (chunk: Buffer) => log(String(chunk)));
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let pending = "";
      const timer = setTimeout(() => reject(new Error("Desktop relay startup timed out")), 10_000);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Desktop relay exited"));
      });
      child.stdout?.on("data", (chunk: Buffer) => {
        pending += String(chunk);
        let newline: number;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (!line.startsWith("TRAVEL_RELAY_READY ")) {
            log(`${line}\n`);
            continue;
          }
          try {
            const ready = JSON.parse(line.slice("TRAVEL_RELAY_READY ".length));
            if (
              ready.instanceId !== instanceId ||
              !Number.isInteger(ready.port) ||
              ready.port < 1 ||
              ready.port > 65535
            )
              throw new Error("Invalid relay readiness");
            clearTimeout(timer);
            resolve(ready.port);
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        }
      });
    });
    relayRecord = {
      protocol: 1,
      installationId,
      instanceId,
      extensionKey,
      name,
      port,
      pid: process.pid,
    };
    writeDesktopRecord(relayRecord);
    relayPort = port;
    try {
      registerNativeHost({
        executable: process.execPath,
        ...(app.isPackaged ? {} : { appPath: app.getAppPath() }),
        baseDir: DISCOVERY_BASE_DIR,
      });
      nativeHostReady = true;
    } catch (error) {
      log(`[browser] Chrome connection helper registration failed: ${String(error)}\n`);
    }
    child.once("exit", () => {
      if (relayRecord?.instanceId === instanceId) {
        removeDesktopRecord(relayRecord);
        relayRecord = null;
        relayPort = null;
      }
      publishAvailability();
      log("[browser] Desktop relay disconnected; restart the application to reconnect\n");
    });
    publishAvailability();
    log(`[browser] Desktop relay ready on 127.0.0.1:${port}\n`);
    return child;
  } catch (error) {
    if (relayRecord?.instanceId === instanceId) removeDesktopRecord(relayRecord);
    relayRecord = null;
    relayPort = null;
    nativeHostReady = false;
    publishAvailability();
    log(`[browser] ${String(error)}\n`);
    child.kill();
    return null;
  }
}

/** Tell the user how to load the bundled unpacked extension. Chrome will not accept a silent install. */
export async function revealBrowserExtension(win: BrowserWindow | null): Promise<void> {
  const dir = extensionDistPath();
  if (!fs.existsSync(path.join(dir, "manifest.json"))) {
    const opts = {
      type: "error" as const,
      title: "Travel Browser",
      message: "The bundled extension is missing.",
      detail: `Expected ${dir}. Rebuild the desktop app (pnpm -r build && stage).`,
    };
    await (win !== null ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
    return;
  }
  const opts = {
    type: "info" as const,
    title: "Load the Travel Browser extension",
    message: "Chrome cannot be given this extension automatically.",
    detail: `1. Open chrome://extensions\n2. Turn on Developer mode\n3. Load unpacked and choose:\n${dir}\n4. Choose "Chrome extension" after Budget on a new chat, or "My own Chrome" in the Browser menu of an existing chat. The agent may create its own task tabs. To let it use a tab you already opened, click the extension icon on that tab.`,
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
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const connected = port !== null && (await hasConnectedBrowserExtension(port));
  // The connection check can outlive the window or the choice that requested it.
  if (!win || win.isDestroyed() || !isCurrent()) return;
  if (connected) {
    win.webContents.send("iab:extension-ready");
    return;
  }
  await revealBrowserExtension(win);
}

export async function stopBrowserRelay(child: UtilityProcess | null): Promise<void> {
  relayPort = null;
  // Only our own record. A shell that crashed and was restarted has already published a new one,
  // and deleting unconditionally would erase the live entry on the old instance's way out.
  if (relayRecord) removeDesktopRecord(relayRecord);
  relayRecord = null;
  nativeHostReady = false;
  publishAvailability();
  if (child === null) return;
  await new Promise<void>((resolve) => {
    const done = (): void => resolve();
    child.once("exit", done);
    child.kill();
    setTimeout(done, 2000);
  });
}
