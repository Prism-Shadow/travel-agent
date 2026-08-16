/**
 * The unified in-app-browser recovery vocabulary (004 Phase 5).
 *
 * Two things are pinned: every failure maps to a status whose mode matches how it actually resolves
 * (a self-healing crash is not shown as a button to press), and the classifier recognises the codes
 * the shell really raises while refusing to dress an unrelated error up as a browser-recovery
 * status.
 */
import { describe, expect, it } from "vitest";

import { classifyRecovery, recoveryStatus, type RecoveryFailure } from "../src/recovery-status.js";

describe("recoveryStatus", () => {
  it("gives a self-healing failure a recovering, auto status", () => {
    const relay = recoveryStatus("relay_crashed");
    expect(relay).toMatchObject({ mode: "recovering", autoRecovering: true });
    expect(recoveryStatus("iab_renderer_gone").autoRecovering).toBe(true);
  });

  it("gives a failure the person must act on a manual, non-auto status", () => {
    expect(recoveryStatus("iab_restore_failed")).toMatchObject({
      mode: "manual",
      autoRecovering: false,
    });
  });

  it("marks a degraded-but-usable failure without claiming it auto-recovers", () => {
    expect(recoveryStatus("extension_disconnected")).toMatchObject({
      mode: "degraded",
      autoRecovering: false,
    });
  });

  it("gives every failure a distinct, non-empty pair of string keys", () => {
    const failures: RecoveryFailure[] = [
      "relay_crashed",
      "extension_disconnected",
      "iab_renderer_gone",
      "iab_restore_failed",
    ];
    const titles = new Set<string>();
    for (const failure of failures) {
      const status = recoveryStatus(failure);
      expect(status.titleKey).toMatch(/^browser\.recovery\./);
      expect(status.detailKey).toMatch(/^browser\.recovery\./);
      titles.add(status.titleKey);
    }
    expect(titles.size).toBe(failures.length);
  });
});

describe("classifyRecovery", () => {
  it("recognises the shell's own codes", () => {
    expect(classifyRecovery("IAB_RESTORE_FAILED: pages could not reopen")).toBe(
      "iab_restore_failed",
    );
    expect(classifyRecovery("IAB_REBUILD_FAILED: view could not be built")).toBe(
      "iab_restore_failed",
    );
    expect(classifyRecovery("render-process-gone: crashed")).toBe("iab_renderer_gone");
    expect(classifyRecovery("relay exited unexpectedly")).toBe("relay_crashed");
    expect(classifyRecovery("extension connection lost")).toBe("extension_disconnected");
  });

  it("returns null for anything that is not a browser-recovery failure", () => {
    expect(classifyRecovery("IAB_TASK_NOT_LIVE")).toBeNull();
    expect(classifyRecovery("ECONNREFUSED talking to the model")).toBeNull();
    expect(classifyRecovery("")).toBeNull();
  });
});
