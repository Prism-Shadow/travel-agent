/**
 * The build-time security guards, tested at their decision points.
 *
 * These are the two leaks that "a code reviewer will notice" does not actually prevent: a debug
 * switch left in shipped source, and a packaged binary missing the fuses that keep it from being
 * relaunched as Node. The scanner and the fuse-diff are pure, so the interesting cases — a switch
 * hiding in a help string, a comment that names a switch to explain avoiding it, a fuse the wire
 * reports as removed rather than set — are all exercised here rather than only against a real
 * artifact.
 */
import { describe, expect, it } from "vitest";

import {
  diffFuses,
  EXPECTED_FUSES,
  interpretFuseWire,
  matchesSwitch,
  scanForDebugSwitches,
  type DebugSwitchFinding,
} from "../scripts/security-guards.mjs";

describe("the debug-switch scanner", () => {
  it("flags a command-line switch used in code", () => {
    const findings = scanForDebugSwitches([
      {
        path: "src/main.ts",
        content: `app.commandLine.appendSwitch("remote-debugging-port", "9222")`,
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "src/main.ts", switch: "remote-debugging-port" });
  });

  it("flags the bare --flag form and an =value form", () => {
    const findings = scanForDebugSwitches([
      { path: "a.ts", content: `const args = ["--remote-debugging-port=9222"]` },
      { path: "b.ts", content: `spawn(bin, ["--inspect"])` },
    ]);
    expect(findings.map((f: DebugSwitchFinding) => f.switch)).toEqual([
      "remote-debugging-port",
      "inspect",
    ]);
  });

  it("does not flag a comment that names a switch to explain avoiding it", () => {
    // iab-transport.ts does exactly this; it must stay clean.
    const content = [
      "// opening Chromium's own --remote-debugging-port would have worked, but Phase 0",
      "// confirmed the port exposes every target to any local caller.",
      " * see --inspect for why we do not use it",
    ].join("\n");
    expect(scanForDebugSwitches([{ path: "src/iab-transport.ts", content }])).toEqual([]);
  });

  it("does not flag a switch named inside a help sentence, in the command-line-only pass", () => {
    // browser-cli tells a person to launch *their own* Chrome for the direct-CDP backend. That is
    // a feature, and the repo-wide pass only flags the appendSwitch form.
    const help = `'Launch Chrome with --remote-debugging-port=9222 or use chrome://inspect'`;
    expect(
      scanForDebugSwitches([{ path: "src/cli.ts", content: help }], { apiOnly: true }),
    ).toEqual([]);
    // …but the same help string in the desktop package (full matching) would be flagged.
    expect(scanForDebugSwitches([{ path: "src/cli.ts", content: help }])).toHaveLength(1);
  });

  it("still flags the appendSwitch form even in the command-line-only pass", () => {
    const findings = scanForDebugSwitches(
      [{ path: "src/relay.ts", content: `chrome.appendArgument('inspect-brk')` }],
      { apiOnly: true },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.switch).toBe("inspect-brk");
  });

  it("honours the allow marker for a line that is genuinely safe", () => {
    const content = `const flag = "--inspect" // penguin-allow-debug-switch: doc fixture only`;
    expect(scanForDebugSwitches([{ path: "src/x.ts", content }])).toEqual([]);
  });

  it("reports the more specific switch when two overlap on a line", () => {
    // inspect-brk contains inspect; the scanner should name inspect-brk.
    expect(matchesSwitch(`spawn(["--inspect-brk"])`, "inspect-brk")).toBe(true);
    const findings = scanForDebugSwitches([{ path: "a.ts", content: `["--inspect-brk"]` }]);
    expect(findings[0]!.switch).toBe("inspect-brk");
  });

  it("does not fire on an unrelated substring", () => {
    const content = "const introspectRemote = true; // introspection, not inspection";
    expect(scanForDebugSwitches([{ path: "a.ts", content }])).toEqual([]);
  });
});

describe("the fuse check", () => {
  it("passes a wire that matches the expectation", () => {
    // Build a wire object the way getCurrentFuseWire returns one: index → state byte (49 = on,
    // 48 = off). runAsNode(0)=off, cookieEncryption(1)=on, nodeOptions(2)=off, cliInspect(3)=off,
    // asarIntegrity(4)=off, onlyLoadAppFromAsar(5)=off.
    const wire = { version: "1", 0: 48, 1: 49, 2: 48, 3: 48, 4: 48, 5: 48 };
    expect(diffFuses(interpretFuseWire(wire))).toEqual([]);
  });

  it("fails when RunAsNode is left enabled", () => {
    const wire = { version: "1", 0: 49, 1: 49, 2: 48, 3: 48, 4: 48, 5: 48 };
    const mismatches = diffFuses(interpretFuseWire(wire));
    expect(mismatches).toEqual([{ fuse: "runAsNode", expected: false, actual: true }]);
  });

  it("fails when the inspector fuse is enabled", () => {
    const wire = { version: "1", 0: 48, 1: 49, 2: 48, 3: 49, 4: 48, 5: 48 };
    expect(diffFuses(interpretFuseWire(wire))).toEqual([
      { fuse: "enableNodeCliInspectArguments", expected: false, actual: true },
    ]);
  });

  it("fails when cookie encryption was not turned on", () => {
    const wire = { version: "1", 0: 48, 1: 48, 2: 48, 3: 48, 4: 48, 5: 48 };
    expect(diffFuses(interpretFuseWire(wire))).toEqual([
      { fuse: "enableCookieEncryption", expected: true, actual: false },
    ]);
  });

  it("treats a removed/inherit fuse byte as a mismatch, not as satisfied", () => {
    // 114 = REMOVED. A fuse that is not definitively set is not the state we asked for.
    const wire = { version: "1", 0: 114, 1: 49, 2: 48, 3: 48, 4: 48, 5: 48 };
    expect(diffFuses(interpretFuseWire(wire))).toEqual([
      { fuse: "runAsNode", expected: false, actual: null },
    ]);
  });

  it("reports a fuse absent from the wire rather than assuming it", () => {
    const wire = { version: "1", 1: 49, 2: 48, 3: 48, 4: 48, 5: 48 }; // index 0 missing
    expect(diffFuses(interpretFuseWire(wire))).toEqual([
      { fuse: "runAsNode", expected: false, actual: "absent" },
    ]);
  });

  it("ignores fuses this build does not opine on", () => {
    // A newer Electron carrying extra fuses (index 6/7) must not fail the check.
    const wire = { version: "1", 0: 48, 1: 49, 2: 48, 3: 48, 4: 48, 5: 48, 6: 49, 7: 49 };
    expect(diffFuses(interpretFuseWire(wire))).toEqual([]);
  });

  it("keeps onlyLoadAppFromAsar off, because this app ships asar off", () => {
    expect(EXPECTED_FUSES.onlyLoadAppFromAsar).toBe(false);
    expect(EXPECTED_FUSES.enableEmbeddedAsarIntegrityValidation).toBe(false);
  });
});
