/**
 * penguin-browser relay lifecycle and on-disk locations inside the desktop app.
 *
 * The agent talks to the CLI over PATH (`penguin-browser serve` / `session new`). The
 * shell starts the relay next to the embedded server so a packaged install does not
 * require a second terminal. Chrome still needs the user to load the bundled unpacked
 * extension — the OS will not inject it into their everyday profile.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, dialog, shell, utilityProcess } from "electron";
import type { BrowserWindow, UtilityProcess } from "electron";

export const BROWSER_RELAY_PORT = 19989;

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

function portOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.setTimeout(400);
    sock.once("connect", () => {
      sock.end();
      resolve(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => resolve(false));
  });
}

export async function startBrowserRelay(
  log: (chunk: string) => void,
): Promise<UtilityProcess | null> {
  const entry = browserCliEntryPath();
  if (!fs.existsSync(entry)) {
    log(`[browser] CLI missing at ${entry}; relay not started\n`);
    return null;
  }
  if (await portOpen(BROWSER_RELAY_PORT)) {
    log(`[browser] ${BROWSER_RELAY_PORT} already listening; leaving the existing relay\n`);
    return null;
  }
  const child = utilityProcess.fork(entry, ["serve", "--host", "127.0.0.1"], {
    serviceName: "penguin-browser-relay",
    stdio: "pipe",
    env: { ...process.env },
  });
  child.stdout?.on("data", (chunk: Buffer) => log(String(chunk)));
  child.stderr?.on("data", (chunk: Buffer) => log(String(chunk)));
  log(`[browser] relay starting (${entry})\n`);
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
    detail: `1. Open chrome://extensions\n2. Turn on Developer mode\n3. Load unpacked and choose:\n${dir}\n4. Click the extension icon on the tab the agent should control.`,
    buttons: ["Open folder", "OK"],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = await (win !== null
    ? dialog.showMessageBox(win, opts)
    : dialog.showMessageBox(opts));
  if (response === 0) void shell.openPath(dir);
}

export async function stopBrowserRelay(child: UtilityProcess | null): Promise<void> {
  if (child === null) return;
  await new Promise<void>((resolve) => {
    const done = (): void => resolve();
    child.once("exit", done);
    child.kill();
    setTimeout(done, 2000);
  });
}
