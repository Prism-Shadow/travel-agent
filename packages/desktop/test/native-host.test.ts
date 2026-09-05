import { PassThrough } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nativeResponse, serveNativeMessages } from "../src/native-host.js";
import {
  nativeHostLauncher,
  nativeHostManifestPaths,
  registerNativeHost,
  unregisterNativeHost,
} from "../src/native-host-registration.js";

const roots: string[] = [];
function temporary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-native-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("native connection host", () => {
  it("serves fragmented and consecutive frames in order", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk) => chunks.push(chunk));
    const done = serveNativeMessages(input, output, temporary());
    const frame = (value: object) => {
      const body = Buffer.from(JSON.stringify(value));
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(body.length);
      return Buffer.concat([prefix, body]);
    };
    const first = frame({ type: "list" });
    input.write(first.subarray(0, 2));
    input.write(first.subarray(2, 7));
    input.end(
      Buffer.concat([first.subarray(7), frame({ type: "execute", code: "not executable" })]),
    );
    await done;
    const data = Buffer.concat(chunks);
    const size = data.readUInt32LE();
    expect(JSON.parse(data.subarray(4, 4 + size).toString())).toEqual({ protocol: 1, apps: [] });
    expect(JSON.parse(data.subarray(size + 8).toString())).toEqual({
      protocol: 1,
      error: "Unsupported request",
    });
  });
  it("refuses oversized frames before parsing or reading more data", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const done = serveNativeMessages(input, output, temporary());
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(1024 * 1024);
    input.end(prefix);
    await expect(done).rejects.toThrow("Invalid native message length");
  });
  it("reports a missing paired app without starting a process", async () => {
    expect(
      await nativeResponse({ type: "connect", installationId: "a".repeat(32) }, temporary()),
    ).toEqual({ protocol: 1, error: "The paired Travel Agent is not running" });
  });
  it("registers only Travel Browser and repairs a moved runtime path", () => {
    const baseDir = temporary();
    const home = temporary();
    for (const executable of [
      "/Applications/Travel Agent.app/run",
      "/Applications/Moved App/run",
    ]) {
      registerNativeHost({ executable, baseDir, home, platform: "darwin" });
    }
    for (const file of nativeHostManifestPaths("darwin", home)) {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(manifest.allowed_origins).toEqual([
        "chrome-extension://fbiciihmfbflenjjaphaljgfnlepnjdf/",
      ]);
      const script = fs.readFileSync(manifest.path, "utf8");
      expect(script).toContain("/Applications/Moved App/run");
      expect(script).toContain("unset ELECTRON_RUN_AS_NODE");
      expect(script).not.toContain("ELECTRON_RUN_AS_NODE=1");
    }
  });
  it("quotes POSIX paths and uses a restricted normal Electron entry on Windows", () => {
    expect(
      nativeHostLauncher({ executable: "/it's/app", baseDir: "/tmp/data", platform: "darwin" }),
    ).toContain("'/it'\\''s/app'");
    const script = nativeHostLauncher({
      executable: "C:\\Program Files\\Travel Agent.exe",
      baseDir: "C:\\Users\\test",
      platform: "win32",
    });
    expect(script).toContain('"--travel-browser-native-host"');
    expect(script).toContain('set "ELECTRON_RUN_AS_NODE="');
  });
  it("removes only the registration still owned by this installation", () => {
    const common = { baseDir: temporary(), home: temporary(), platform: "darwin" as const };
    registerNativeHost({ ...common, executable: "/Applications/New App/run" });
    expect(unregisterNativeHost({ ...common, executable: "/Applications/Old App/run" })).toBe(
      false,
    );
    const files = nativeHostManifestPaths("darwin", common.home);
    expect(files.every((file) => fs.existsSync(file))).toBe(true);
    expect(unregisterNativeHost({ ...common, executable: "/Applications/New App/run" })).toBe(true);
    expect(files.some((file) => fs.existsSync(file))).toBe(false);
  });
});
