/**
 * "Install 'penguin' Command" — PATH exposure for the bundled CLI launcher
 * (<app>/bin/penguin, generated at stage time; see launcher.ts).
 *
 * Per platform (deb is absent on purpose — its postinst ships /usr/bin/penguin, see
 * build/linux/after-install.tpl):
 * - macOS: symlink /usr/local/bin/penguin and penguin-browser → <app>/bin/…; on
 *   permission errors, escalate ONCE via osascript "with administrator privileges".
 * - Windows: append <app>\bin to the user PATH (HKCU\Environment) via reg.exe,
 *   idempotently (read + compare first); new terminals pick it up.
 * - Linux AppImage: write an executable ~/.local/bin/penguin wrapper that runs the
 *   AppImage itself as Node (see launcher.ts appImageWrapperScript).
 *
 * Everything is native UI (menu item + dialogs) in English: the main process stays
 * outside the web app's i18n, and per the design the desktop shell talks to the page
 * only through the server's HTTP API — never a private IPC channel.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app, dialog } from "electron";
import type { BrowserWindow } from "electron";
import {
  appImageWrapperScript,
  BROWSER_CLI_APPIMAGE_SEGMENTS,
  cliInstallKind,
  mergeWindowsUserPath,
} from "./launcher.js";
import type { CliInstallKind } from "./launcher.js";

const execFileAsync = promisify(execFile);

/** The staged launcher directory inside the packaged app. */
function binDir(): string {
  return path.join(app.getAppPath(), "bin");
}

/** This run's install kind, or null when there is nothing to install (dev run / deb). */
export function currentCliInstallKind(): CliInstallKind | null {
  return cliInstallKind({
    packaged: app.isPackaged,
    platform: process.platform,
    appImagePath: process.env.APPIMAGE ?? null,
  });
}

function showResult(win: BrowserWindow | null, ok: boolean, detail: string): void {
  const opts = {
    type: ok ? ("info" as const) : ("error" as const),
    title: "PenguinHarness",
    message: ok
      ? "The 'penguin' and 'penguin-browser' commands are installed."
      : "Could not install the CLI commands.",
    detail,
  };
  void (win !== null ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
}

/** macOS: /usr/local/bin/penguin symlink, escalating once via osascript on EACCES/EPERM. */
async function installDarwin(win: BrowserWindow | null): Promise<void> {
  const names = ["penguin", "penguin-browser"] as const;
  try {
    fs.mkdirSync("/usr/local/bin", { recursive: true });
    for (const name of names) {
      const target = path.join(binDir(), name);
      const link = `/usr/local/bin/${name}`;
      fs.rmSync(link, { force: true });
      fs.symlinkSync(target, link);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") {
      showResult(win, false, String(err));
      return;
    }
    const shellCmd = names
      .map((name) => {
        const target = path.join(binDir(), name);
        return `ln -sf '${target}' '/usr/local/bin/${name}'`;
      })
      .join(" && ");
    try {
      await execFileAsync("osascript", [
        "-e",
        `do shell script "mkdir -p /usr/local/bin && ${shellCmd.replace(/"/g, '\\"')}" with administrator privileges`,
      ]);
    } catch (escalated) {
      showResult(
        win,
        false,
        `Administrator authorization failed or was cancelled.\n${String(escalated)}`,
      );
      return;
    }
  }
  showResult(
    win,
    true,
    `/usr/local/bin/penguin and penguin-browser now point at the app's bundled CLIs.`,
  );
}

/** Windows: idempotent HKCU\Environment PATH append via reg.exe. */
async function installWindows(win: BrowserWindow | null): Promise<void> {
  const dir = binDir();
  let current: string | null = null;
  try {
    const { stdout } = await execFileAsync("reg", ["query", "HKCU\\Environment", "/v", "Path"]);
    // Output line: "    Path    REG_EXPAND_SZ    C:\foo;C:\bar"
    const m = /^\s*Path\s+REG(?:_EXPAND)?_SZ\s+(.*)$/im.exec(stdout);
    if (m) current = m[1]!.trim();
  } catch {
    current = null; // No user Path value yet.
  }
  const merged = mergeWindowsUserPath(current, dir);
  if (merged === null) {
    showResult(
      win,
      true,
      `${dir} is already on your PATH. Run 'penguin' or 'penguin-browser' from any terminal.`,
    );
    return;
  }
  try {
    // REG_EXPAND_SZ keeps any %VAR% entries of the existing value expandable.
    await execFileAsync("reg", [
      "add",
      "HKCU\\Environment",
      "/v",
      "Path",
      "/t",
      "REG_EXPAND_SZ",
      "/d",
      merged,
      "/f",
    ]);
  } catch (err) {
    showResult(win, false, String(err));
    return;
  }
  showResult(
    win,
    true,
    `${dir} was added to your user PATH. Open a NEW terminal (existing ones keep the old PATH) and run 'penguin' or 'penguin-browser'.`,
  );
}

/** Linux AppImage: executable ~/.local/bin/penguin wrapper invoking the AppImage as Node. */
function installAppImage(win: BrowserWindow | null): void {
  const appImage = process.env.APPIMAGE;
  if (!appImage) {
    showResult(win, false, "APPIMAGE is not set; this build cannot install the command.");
    return;
  }
  const dir = path.join(os.homedir(), ".local", "bin");
  const jobs = [
    { name: "penguin", segments: ["@prismshadow", "penguin-cli", "dist", "index.js"] as const },
    { name: "penguin-browser", segments: BROWSER_CLI_APPIMAGE_SEGMENTS },
  ];
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const job of jobs) {
      const wrapper = path.join(dir, job.name);
      const script = appImageWrapperScript(appImage, job.name, [...job.segments]);
      fs.writeFileSync(wrapper, script, { mode: 0o755 });
      fs.chmodSync(wrapper, 0o755);
    }
  } catch (err) {
    showResult(win, false, String(err));
    return;
  }
  showResult(
    win,
    true,
    `${dir}/penguin and penguin-browser now run the CLIs bundled in this AppImage. Make sure ~/.local/bin is on your PATH, then open a new terminal. Re-run this menu item if you move the AppImage.`,
  );
}

/** Runs the platform installer (menu item and first-launch offer both land here). */
export async function installCliCommand(win: BrowserWindow | null): Promise<void> {
  switch (currentCliInstallKind()) {
    case "darwin":
      await installDarwin(win);
      return;
    case "windows":
      await installWindows(win);
      return;
    case "appimage":
      installAppImage(win);
      return;
    case null:
      showResult(
        win,
        false,
        "This build has no bundled CLI to install (development run). Use PATH from pnpm build.",
      );
  }
}

/**
 * One-time first-launch offer: asks once per installation whether to install the
 * command, and never again (the app menu keeps the entry point available). The
 * "offered" flag persists under userData next to the shell's other state files.
 */
export async function maybeOfferCliInstall(win: BrowserWindow | null): Promise<void> {
  if (currentCliInstallKind() === null) return;
  const flag = path.join(app.getPath("userData"), "cli-install-offered");
  try {
    if (fs.existsSync(flag)) return;
    fs.mkdirSync(path.dirname(flag), { recursive: true });
    fs.writeFileSync(flag, `${new Date().toISOString()}\n`);
  } catch {
    return; // Unreadable/unwritable userData: skip rather than re-offer forever.
  }
  const opts = {
    type: "question" as const,
    title: "PenguinHarness",
    message: "Install the 'penguin' and 'penguin-browser' commands?",
    detail:
      "Puts the CLIs bundled with this app on your PATH. You can do this later from the application menu: Install CLI Commands.",
    buttons: ["Install", "Not Now"],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = await (win !== null
    ? dialog.showMessageBox(win, opts)
    : dialog.showMessageBox(opts));
  if (response === 0) await installCliCommand(win);
}
