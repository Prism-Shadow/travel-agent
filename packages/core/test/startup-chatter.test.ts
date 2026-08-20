/**
 * Startup-chatter separation: profile output written before the command must not reach
 * model-visible output, while the command's own streams, diagnostics and exit status are
 * untouched. This is issue 0006's production half — the emitter measured there (nvm's
 * die-on-prefix warning) has no environment variable to silence it, so the separation is
 * structural: per-stream markers relying on FIFO pipe order (see startup-chatter.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StartupChatterGate } from "../src/environment/tools/command/startup-chatter.js";
import { ManagedSession } from "../src/environment/tools/command/session.js";

describe("StartupChatterGate", () => {
  const M = "__penguin_ready_deadbeefdeadbeef__";

  it("passes everything through when no marker is expected (profile-free shells)", () => {
    const g = new StartupChatterGate(null);
    expect(g.filter("hello\n")).toBe("hello\n");
    expect(g.filter("world")).toBe("world");
  });

  it("holds chatter and emits only what follows the marker line", () => {
    const g = new StartupChatterGate(M);
    expect(g.filter("Your user's .npmrc file has a `prefix` setting\n")).toBe("");
    expect(g.filter(`more chatter\n${M}\nhello\n`)).toBe("hello\n");
    expect(g.filter("world\n")).toBe("world\n");
  });

  it("finds a marker split across chunks", () => {
    const g = new StartupChatterGate(M);
    expect(g.filter("chatter\n" + M.slice(0, 10))).toBe("");
    expect(g.filter(M.slice(10) + "\nout")).toBe("out");
  });

  it("drops the marker's own line ending when it arrives in a later chunk", () => {
    const g = new StartupChatterGate(M);
    expect(g.filter(M)).toBe("");
    expect(g.filter("\nout")).toBe("out");
  });

  it("drops a CRLF line ending split across chunks (MSYS shells)", () => {
    const g = new StartupChatterGate(M);
    expect(g.filter(`${M}\r`)).toBe("");
    expect(g.filter("\nout")).toBe("out");
  });

  it("fails open when the marker never arrives: flush returns the held text", () => {
    const g = new StartupChatterGate(M);
    expect(g.filter("bash: -c: line 1: syntax error\n")).toBe("");
    expect(g.flush()).toBe("bash: -c: line 1: syntax error\n");
    // Open after the flush: a background straggler still gets through.
    expect(g.filter("late\n")).toBe("late\n");
  });

  it("fails open past the hold cap instead of buffering without bound", () => {
    const g = new StartupChatterGate(M);
    const big = "x".repeat(70 * 1024);
    expect(g.filter(big)).toBe(big);
    expect(g.filter("more")).toBe("more");
  });
});

// The shim is a POSIX shell script; there is nothing to exec it with on Windows, where the
// resolved shells (pwsh/powershell/cmd, or Git-Bash for its own profile) are covered by the
// gate the same way — the unit tests above are platform-neutral.
describe.skipIf(process.platform === "win32")(
  "ManagedSession with a chattering login shell",
  () => {
    let dir: string;
    let savedShell: string | undefined;

    beforeAll(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "penguin-chatter-"));
      // A stand-in for a machine whose profile prints on spawn (issue 0006's shape), made
      // deterministic: chatter on both streams, then the real login shell.
      const shim = path.join(dir, "chatty-bash");
      await writeFile(
        shim,
        '#!/bin/bash\necho "CHATTER-OUT must not reach the model"\n' +
          'echo "CHATTER-ERR must not reach the model" >&2\nexec /bin/bash "$@"\n',
      );
      await chmod(shim, 0o755);
      savedShell = process.env.PENGUIN_SHELL;
      // sessionShell() caches per process; this test file runs in its own worker, so the shim
      // is what every session in this file resolves.
      process.env.PENGUIN_SHELL = shim;
    });

    afterAll(async () => {
      if (savedShell === undefined) delete process.env.PENGUIN_SHELL;
      else process.env.PENGUIN_SHELL = savedShell;
      await rm(dir, { recursive: true, force: true });
    });

    async function run(cmd: string): Promise<{ output: string; code: number | null }> {
      const session = new ManagedSession({ cmd, cwd: dir, env: process.env });
      try {
        let output = "";
        for await (const chunk of session.collect(4000)) output += chunk;
        return { output, code: session.exit?.code ?? null };
      } finally {
        session.kill();
      }
    }

    it("keeps shell startup chatter out of the output, on both streams", async () => {
      const res = await run("echo real-out; echo real-err >&2");
      expect(res.output).toContain("real-out");
      expect(res.output).toContain("real-err");
      expect(res.output).not.toContain("CHATTER");
      expect(res.output).not.toContain("__penguin_ready_"); // the marker must not leak either
      expect(res.code).toBe(0);
    });

    it("preserves the command's exit status through the wrap", async () => {
      const res = await run("exit 7");
      expect(res.code).toBe(7);
    });

    it("fails open on a command the shell cannot parse: the diagnostic is delivered", async () => {
      // Measured: bash parses the whole -c string first, so the marker echos never run; the held
      // text (the shell's own syntax error) must still reach the output on exit.
      const res = await run("(");
      expect(res.output).toContain("syntax error");
      expect(res.code).not.toBe(0);
    });
  },
);
