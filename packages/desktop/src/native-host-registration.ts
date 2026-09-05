/** User-level host registration. The helper runs Electron normally, with its security fuses intact. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  NATIVE_HOST_NAME,
  TRAVEL_EXTENSION_ID,
} from "penguin-browser/dist/shared/desktop-connection.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function nativeHostLauncher(options: {
  executable: string;
  appPath?: string;
  baseDir: string;
  platform: NodeJS.Platform;
}): string {
  const args = [
    options.executable,
    ...(options.appPath ? [options.appPath] : []),
    "--travel-browser-native-host",
  ];
  if (options.platform === "win32") {
    if ([...args, options.baseDir].some((value) => /[\r\n"%]/.test(value)))
      throw new Error("Unsupported native host path");
    return [
      "@echo off",
      "setlocal",
      'set "ELECTRON_RUN_AS_NODE="',
      `set "PENGUIN_BROWSER_HOME=${options.baseDir}"`,
      `${args.map((arg) => `"${arg}"`).join(" ")} %*`,
      "exit /b %errorlevel%",
      "",
    ].join("\r\n");
  }
  return `#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexport PENGUIN_BROWSER_HOME=${quote(options.baseDir)}\nexec ${args.map(quote).join(" ")} "$@"\n`;
}

export function nativeHostManifestPaths(
  platform: NodeJS.Platform,
  home: string,
  configHome?: string,
): string[] {
  const name = `${NATIVE_HOST_NAME}.json`;
  if (platform === "darwin")
    return ["Google/Chrome", "Google/ChromeForTesting", "Chromium"].map((browser) =>
      path.join(home, "Library/Application Support", browser, "NativeMessagingHosts", name),
    );
  if (platform === "linux")
    return ["google-chrome", "google-chrome-for-testing", "chromium"].map((browser) =>
      path.join(configHome || path.join(home, ".config"), browser, "NativeMessagingHosts", name),
    );
  return [];
}

export function registerNativeHost(options: {
  executable: string;
  appPath?: string;
  baseDir: string;
  platform?: NodeJS.Platform;
  home?: string;
}): void {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const directory = path.join(options.baseDir, "native-host");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const launcher = path.join(
    directory,
    platform === "win32" ? "travel-browser.cmd" : "travel-browser",
  );
  fs.writeFileSync(launcher, nativeHostLauncher({ ...options, platform }), { mode: 0o700 });
  if (platform !== "win32") fs.chmodSync(launcher, 0o700);
  const manifest =
    JSON.stringify(
      {
        name: NATIVE_HOST_NAME,
        description: "Connect Travel Browser to Travel Agent",
        path: launcher,
        type: "stdio",
        allowed_origins: [`chrome-extension://${TRAVEL_EXTENSION_ID}/`],
      },
      null,
      2,
    ) + "\n";
  const manifests =
    platform === "win32"
      ? [path.join(directory, `${NATIVE_HOST_NAME}.json`)]
      : nativeHostManifestPaths(platform, home, process.env.XDG_CONFIG_HOME);
  for (const file of manifests) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, manifest, { mode: 0o600 });
  }
  if (platform === "win32")
    execFileSync(
      "reg.exe",
      [
        "add",
        `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        manifests[0]!,
        "/f",
      ],
      { windowsHide: true, stdio: "pipe" },
    );
}

/** Explicit removal before uninstalling; another installation's repaired registration is retained. */
export function unregisterNativeHost(options: {
  executable: string;
  appPath?: string;
  baseDir: string;
  platform?: NodeJS.Platform;
  home?: string;
}): boolean {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const directory = path.join(options.baseDir, "native-host");
  const launcher = path.join(
    directory,
    platform === "win32" ? "travel-browser.cmd" : "travel-browser",
  );
  try {
    if (fs.readFileSync(launcher, "utf8") !== nativeHostLauncher({ ...options, platform }))
      return false;
  } catch {
    return false;
  }
  const manifests =
    platform === "win32"
      ? [path.join(directory, `${NATIVE_HOST_NAME}.json`)]
      : nativeHostManifestPaths(platform, home, process.env.XDG_CONFIG_HOME);
  for (const file of manifests) {
    try {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      if (manifest.name !== NATIVE_HOST_NAME || manifest.path !== launcher) continue;
      if (platform === "win32") {
        const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
        const current = execFileSync("reg.exe", ["query", key, "/ve"], {
          windowsHide: true,
          encoding: "utf8",
        });
        if (current.split(/\r?\n/).some((line) => line.trim().endsWith(file))) {
          execFileSync("reg.exe", ["delete", key, "/f"], { windowsHide: true, stdio: "pipe" });
        }
      }
      fs.unlinkSync(file);
    } catch {
      /* A missing or independently changed registration is not ours to remove. */
    }
  }
  fs.unlinkSync(launcher);
  return true;
}
