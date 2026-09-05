/** Real Chrome → registered native host → private relay, with an occupied conventional port. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

// Both Chrome and the normal Electron native host need the Linux display boundary exercised.
if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  const result = spawnSync("xvfb-run", ["-a", process.execPath, fileURLToPath(import.meta.url)], {
    stdio: "inherit",
  });
  if (result.error) console.error("Native pairing requires a display or xvfb-run.");
  process.exit(result.status ?? 1);
}

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserDir = path.resolve(pkgDir, "../browser-cli");
const requireDesktop = createRequire(path.join(pkgDir, "package.json"));
const requireBrowser = createRequire(path.join(browserDir, "package.json"));
const { chromium } = requireBrowser("@xmorse/playwright-core");
const { writeDesktopRecord, removeDesktopRecord } = await import(
  pathToFileURL(path.join(browserDir, "dist/relay/desktop-registry.js"))
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "travel-native-pairing-"));
const profile = path.join(root, "chrome");
const registry = path.join(root, "registry");
const hostLaunches = path.join(root, "native-host-launches");
const launches = () =>
  fs.existsSync(hostLaunches) ? fs.readFileSync(hostLaunches, "utf8").trim().split(/\r?\n/) : [];
const extensionId = "fbiciihmfbflenjjaphaljgfnlepnjdf";
const nativeHost = "com.prismshadow.travel_browser";
const installationId = randomBytes(16).toString("hex");
const children = [];
let context;
let occupied;
let registryBackup;
const registryKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${nativeHost}`;
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const env = {
  ...process.env,
  PENGUIN_BROWSER_HOME: registry,
  PENGUIN_BROWSER_LOG_FILE_PATH: path.join(root, "relay.log"),
  PENGUIN_BROWSER_CDP_LOG_FILE_PATH: path.join(root, "cdp.jsonl"),
};
delete env.PENGUIN_RELAY_INSTANCE_ID;
delete env.PENGUIN_BROWSER_PORT;
delete env.PENGUIN_BROWSER_HOST;
delete env.PENGUIN_IAB_KEY;

async function until(check, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${label}`);
}
async function startDesktop() {
  const record = {
    protocol: 1,
    installationId,
    instanceId: randomBytes(16).toString("hex"),
    extensionKey: randomBytes(32).toString("hex"),
    name: "Travel Agent · isolated test",
    pid: process.pid,
    port: 0,
  };
  const child = spawn(process.execPath, [path.join(browserDir, "dist/desktop-relay-entry.js")], {
    env: {
      ...env,
      PENGUIN_RELAY_OWNER_PID: String(process.pid),
      PENGUIN_RELAY_INSTALLATION_ID: installationId,
      PENGUIN_RELAY_INSTANCE_ID: record.instanceId,
      PENGUIN_EXTENSION_KEY: record.extensionKey,
      PENGUIN_RELAY_NAME: record.name,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", () => {});
  await until(() => output.includes("TRAVEL_RELAY_READY "), "owned relay readiness");
  record.port = JSON.parse(
    output
      .split("\n")
      .find((line) => line.startsWith("TRAVEL_RELAY_READY "))
      .slice(19),
  ).port;
  writeDesktopRecord(record, registry);
  return { record, child };
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  });
}
const status = async (record) =>
  fetch(`http://127.0.0.1:${record.port}/extensions/status`).then((response) => response.json());

try {
  // Never stop a service belonging to the developer. On a clean machine this sentinel owns 19989.
  occupied = http.createServer((_, response) => response.end("unrelated service"));
  await new Promise((resolve) => {
    occupied.once("error", resolve);
    occupied.listen(19989, "127.0.0.1", resolve);
  });
  fs.mkdirSync(path.join(profile, "NativeMessagingHosts"), { recursive: true });
  const executable = requireDesktop("electron");
  const launcher = path.join(
    root,
    process.platform === "win32" ? "native-host.cmd" : "native-host",
  );
  const script =
    process.platform === "win32"
      ? `@echo off\r\necho started>>"${hostLaunches}"\r\nset "ELECTRON_RUN_AS_NODE="\r\nset "PENGUIN_BROWSER_HOME=${registry}"\r\n"${executable}" "${pkgDir}" --travel-browser-native-host %*\r\n`
      : `#!/bin/sh\necho $$ >> ${quote(hostLaunches)}\nunset ELECTRON_RUN_AS_NODE\nexport PENGUIN_BROWSER_HOME=${quote(registry)}\nexec ${quote(executable)} ${quote(pkgDir)} --travel-browser-native-host "$@"\n`;
  fs.writeFileSync(launcher, script, { mode: 0o700 });
  const manifest = path.join(profile, "NativeMessagingHosts", `${nativeHost}.json`);
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      name: nativeHost,
      description: "Isolated pairing test",
      path: launcher,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    }),
  );
  if (process.platform === "win32") {
    try {
      registryBackup = execFileSync("reg.exe", ["query", registryKey, "/ve"], { encoding: "utf8" })
        .match(/REG_SZ\s+(.+)/)?.[1]
        ?.trim();
    } catch {}
    execFileSync("reg.exe", ["add", registryKey, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"], {
      stdio: "pipe",
    });
  }
  const extension = path.resolve(pkgDir, "../browser-extension/dist-packaged");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  let worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const native = (request) =>
    worker.evaluate(async ({ host, request }) => chrome.runtime.sendNativeMessage(host, request), {
      host: nativeHost,
      request,
    });
  await until(() => launches().length > 0, "native discovery startup");
  // Exercise multiple three-second retries with no Desktop running. Discovery must reuse its host.
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  assert.equal(launches().length, 1, "Idle discovery must not launch a helper per retry");
  const discoveryPid = Number(launches()[0]);
  if (process.platform === "darwin") {
    const policy = execFileSync(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        `ObjC.import('AppKit'); var helper = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${discoveryPid}); JSON.stringify({ pid: helper.processIdentifier, policy: Number(helper.activationPolicy) })`,
      ],
      { encoding: "utf8" },
    );
    assert.deepEqual(
      JSON.parse(policy),
      { pid: discoveryPid, policy: 2 },
      "Native discovery must be prohibited from Dock activation and windows",
    );
  }
  console.log(
    "  ✓ Chrome-before-Desktop polling reuses one background helper without Dock activation",
  );

  const first = await startDesktop();
  assert.notEqual(first.record.port, 19989);
  await until(
    async () => (await status(first.record)).extensions.length === 1,
    "automatic desktop pairing",
  );
  assert.equal(launches().length, 1, "Opening Desktop must reuse the discovery host");
  assert.deepEqual(await native({ type: "execute", code: "not executed" }), {
    protocol: 1,
    error: "Unsupported request",
  });
  // The explicit protocol-denial probe above uses its own one-shot host.
  const launchesBeforeRestart = launches().length;
  const page = context.pages()[0];
  await page.goto("about:blank");
  await page.bringToFront();
  assert.equal(
    (await worker.evaluate(() => globalThis.toggleExtensionForActiveTab())).isConnected,
    true,
  );
  await until(
    async () => (await status(first.record)).extensions[0]?.activeTargets === 1,
    "explicit tab authorization",
  );
  console.log(
    "  ✓ Native host pairs with the correct private relay and explicit tab authorization still works",
  );

  // CLI auto-start must follow the same registry as session requests, even with no inherited port.
  const cli = (extraEnv = {}) =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [path.join(browserDir, "dist/cli.js"), "session", "list"],
        { env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] },
      );
      children.push(child);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("exit", (code) => resolve({ code, output }));
    });
  assert.equal((await cli()).code, 0);
  await stop(first.child);
  removeDesktopRecord(first.record, registry);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  assert.equal(
    launches().length,
    launchesBeforeRestart,
    "Desktop exit must not restart the helper",
  );
  const stale = await cli({
    PENGUIN_BROWSER_PORT: String(first.record.port),
    PENGUIN_RELAY_INSTANCE_ID: first.record.instanceId,
  });
  assert.notEqual(stale.code, 0);
  assert.match(stale.output, /no replacement relay was started/);
  const { writeBackendPreference } = await import(
    pathToFileURL(path.join(browserDir, "dist/relay/relay-discovery.js"))
  );
  writeBackendPreference("external-dev-chat", "extension", registry);
  const external = await cli({
    PENGUIN_SESSION_ID: "external-dev-chat",
    PENGUIN_TASK_ID: "external-dev-task",
  });
  assert.notEqual(external.code, 0);
  assert.match(external.output, /no replacement relay was started/);
  console.log("  ✓ A disconnected desktop-scoped CLI refuses to spawn a replacement relay");

  const second = await startDesktop();
  assert.notEqual(second.record.instanceId, first.record.instanceId);
  removeDesktopRecord(first.record, registry);
  await until(
    async () => (await status(second.record)).extensions[0]?.activeTargets === 1,
    "reconnection to restarted app",
  );
  assert.equal((await cli()).code, 0);
  assert.equal(launches().length, launchesBeforeRestart, "Desktop restart must reuse the helper");
  console.log(
    "  ✓ Restart discovers the new authenticated endpoint and reconnects authorized tabs without replaying commands",
  );
  const externalAfterRestart = await cli({
    PENGUIN_SESSION_ID: "external-dev-chat",
    PENGUIN_TASK_ID: "external-dev-task",
    PENGUIN_BROWSER_PORT: String(first.record.port),
  });
  assert.equal(externalAfterRestart.code, 0, externalAfterRestart.output);
  console.log("  ✓ External dev-server tasks ignore an older shell's inherited port");

  // A service-worker restart must preserve the installation pairing without choosing standalone.
  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const workerTarget = targetInfos.find(
    (target) => target.type === "service_worker" && target.url.includes(extensionId),
  );
  await cdp.send("Target.closeTarget", { targetId: workerTarget.targetId });
  await page.goto(`chrome-extension://${extensionId}/src/connection.html`);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await until(
    async () => (await page.locator("#status").textContent()).includes("Connected"),
    "worker restart pairing",
  );
  console.log(
    "  ✓ Extension worker restart preserves pairing and the settings page shows the connected application",
  );
  console.log("native-pairing-e2e: passed");
} finally {
  await context?.close();
  await Promise.all(children.map(stop));
  occupied?.close();
  if (process.platform === "win32") {
    if (registryBackup)
      execFileSync(
        "reg.exe",
        ["add", registryKey, "/ve", "/t", "REG_SZ", "/d", registryBackup, "/f"],
        { stdio: "pipe" },
      );
    else execFileSync("reg.exe", ["delete", registryKey, "/f"], { stdio: "pipe" });
  }
  fs.rmSync(root, { recursive: true, force: true });
}
