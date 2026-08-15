/**
 * How the end-to-end runner reads a finished Electron process (e2e/exit-status.mjs).
 *
 * The branch under test is the one that almost never fires and fails silently when it does:
 * Electron printing every step and *then* dying. A runner that only inspects the printed steps
 * calls that a pass, which in CI is a gate going green on a process that failed.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM helper shared with the runner, which is not TypeScript.
import { checkExitStatus, redactSecrets } from "../e2e/exit-status.mjs";

describe("checkExitStatus", () => {
  it("passes a clean exit", () => {
    expect(checkExitStatus({ status: 0, signal: null, stderr: "" })).toEqual({ ok: true });
  });

  it("fails a non-zero exit even when every step printed", () => {
    const result = checkExitStatus({ status: 1, signal: null, stderr: "" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/status 1/);
    // The message has to say why this is not a pass, because the steps above it all succeeded.
    expect(result.message).toMatch(/teardown|only the steps/i);
  });

  it("fails when a signal killed the process", () => {
    const result = checkExitStatus({ status: null, signal: "SIGTERM", stderr: "" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/SIGTERM/);
  });

  it("fails when the process never launched", () => {
    const result = checkExitStatus({
      error: new Error("spawn electron ENOENT"),
      status: null,
      signal: null,
      stderr: "",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/ENOENT/);
  });

  it("attaches the tail of stderr so a failure is diagnosable", () => {
    const result = checkExitStatus({ status: 3, signal: null, stderr: "boom at line 12" });
    expect(result.message).toMatch(/boom at line 12/);
  });

  it("truncates a very long stderr rather than dumping it whole", () => {
    const result = checkExitStatus({ status: 3, signal: null, stderr: "x".repeat(50_000) });
    expect(result.message.length).toBeLessThan(4000);
  });
});

describe("redactSecrets", () => {
  it("removes the /iab key from a URL", () => {
    // The harness mints a per-run key and passes it in a WebSocket URL, so a stack trace can carry
    // it into a CI log that is frequently public.
    const redacted = redactSecrets(
      "connect ws://127.0.0.1:41234/iab?key=e2e-abc123def&id=x failed",
    );
    expect(redacted).not.toMatch(/abc123def/);
    expect(redacted).toMatch(/key=\[redacted\]/);
  });

  it("removes a bare per-run key token", () => {
    expect(redactSecrets("using e2e-9f3a2b7c1d for this run")).not.toMatch(/9f3a2b7c1d/);
  });

  it.each(["token", "secret"])("removes a %s query parameter too", (name) => {
    expect(redactSecrets(`https://x/?${name}=supersecretvalue`)).not.toMatch(/supersecretvalue/);
  });

  it("leaves ordinary text alone", () => {
    expect(redactSecrets("TypeError: cannot read properties of undefined")).toBe(
      "TypeError: cannot read properties of undefined",
    );
  });

  it("handles a missing value without throwing", () => {
    expect(redactSecrets(undefined)).toBe("");
  });
});
