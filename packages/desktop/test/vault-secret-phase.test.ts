/**
 * The scoped secret phase, tested at the two points where it either holds or is theatre.
 *
 * **The detach happens before anything is typed, and a failed detach stops the phase.** If that
 * ordering is ever inverted, the phase becomes a comment: the code would be in a page the agent can
 * still read. The first block below asserts the ordering directly, and asserts that a port which
 * cannot detach produces a refusal rather than a fill.
 *
 * **Coming back requires a proof.** The secret phase gives exactly three exits, and only one of them
 * hands the page back. The second block walks each of them, including the case where the field
 * still holds the code and the case where the page cannot be asked at all — both of which end with
 * the agent *not* getting the target back.
 */
import { describe, expect, it, vi } from "vitest";

import { openVaultAudit, type VaultAudit } from "../src/vault/audit.js";
import { generateKey } from "../src/vault/crypto.js";
import { SecretPhaseController, type SecretPhasePort } from "../src/vault/secret-phase.js";
import { SensitiveElementRegistry } from "../src/vault/sensitive-elements.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

const OTP = "482913";
const TARGET = {
  sessionId: "s-1",
  taskId: "task-1755000000000-aaaa1111",
  targetId: "T-1",
  selector: "#otp",
  field: "otp",
};

let dir: string;
let audit: VaultAudit;
let calls: string[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "secret-phase-"));
  const key = generateKey();
  audit = await openVaultAudit({ filePath: path.join(dir, "audit.jsonl"), key: () => key });
  calls = [];
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function fakeBrowser(overrides: Partial<SecretPhasePort> = {}) {
  let fieldValue = "";
  let url = "https://ctrip.com/pay";
  let fieldPresent = true;
  const port: SecretPhasePort = {
    detachAgent: vi.fn(async () => {
      calls.push("detach");
    }),
    attachAgent: vi.fn(async () => {
      calls.push("attach");
    }),
    destroyTarget: vi.fn(async () => {
      calls.push("destroy");
    }),
    fillField: vi.fn(async ({ value }) => {
      calls.push("fill");
      fieldValue = value;
      return { filled: true, box: { x: 0, y: 0, width: 100, height: 20 } };
    }),
    submit: vi.fn(async () => {
      calls.push("submit");
      return true;
    }),
    readField: vi.fn(async () => fieldValue),
    hasField: vi.fn(async () => fieldPresent),
    currentUrl: vi.fn(async () => url),
    ...overrides,
  };
  return {
    port,
    clearField() {
      fieldValue = "";
    },
    removeField() {
      fieldPresent = false;
    },
    navigate(to: string) {
      url = to;
    },
  };
}

function controllerWith(
  port: SecretPhasePort,
  options: { live?: boolean } = {},
): { controller: SecretPhaseController; states: unknown[]; sensitive: SensitiveElementRegistry } {
  const states: unknown[] = [];
  const sensitive = new SensitiveElementRegistry();
  const controller = new SecretPhaseController({
    port,
    sensitive,
    audit,
    flags: { "secret_entry.live": options.live === true },
    onStateChange: (event) => states.push(event),
  });
  return { controller, states, sensitive };
}

describe("entering", () => {
  it("detaches the agent's channel before anything is typed", async () => {
    const browser = fakeBrowser();
    const { controller, states } = controllerWith(browser.port, { live: true });

    expect(await controller.enter(TARGET)).toEqual({ ok: true, mode: "live_fill" });
    await controller.fillFromPerson({ value: OTP });

    expect(calls).toEqual(["detach", "fill"]);
    expect(states[0]).toEqual({ type: "enter", field: "otp" });
  });

  it("types nothing at all when the channel cannot be closed", async () => {
    // Fail closed. A phase that proceeded here would put a code into a page the agent still reads.
    const browser = fakeBrowser({
      detachAgent: vi.fn(async () => {
        throw new Error("debugger already detached by another client");
      }),
    });
    const { controller } = controllerWith(browser.port, { live: true });

    const entered = await controller.enter(TARGET);
    expect(entered).toMatchObject({ ok: false, reason: "detach_failed" });
    expect(browser.port.fillField).not.toHaveBeenCalled();
    expect(controller.current).toBeNull();

    // And the attempt is on the record, with its reason.
    const written = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
    expect(written).toContain("secret_phase_enter");
    expect(written).toContain("detach failed");
  });

  it("runs one phase at a time", async () => {
    const { controller } = controllerWith(fakeBrowser().port);
    await controller.enter(TARGET);
    expect(await controller.enter({ ...TARGET, field: "cvv" })).toMatchObject({
      ok: false,
      reason: "already_active",
    });
  });

  it("still detaches for a field this application will never type", async () => {
    // A payment password is human-only, and the agent must be detached the whole time it is being
    // entered — the phase exists for the detach, not only for the fill.
    const browser = fakeBrowser();
    const { controller } = controllerWith(browser.port, { live: true });
    expect(await controller.enter({ ...TARGET, field: "payment_password" })).toEqual({
      ok: true,
      mode: "person_types",
    });
    expect(browser.port.detachAgent).toHaveBeenCalledTimes(1);
    expect(await controller.fillFromPerson({ value: "123456" })).toMatchObject({
      ok: false,
      reason: "never_filled",
    });
  });
});

describe("the live-fill gate", () => {
  it("refuses to type a real code while secret_entry.live is off — the shipped default", async () => {
    const browser = fakeBrowser();
    const { controller } = controllerWith(browser.port, { live: false });
    expect(await controller.enter(TARGET)).toEqual({ ok: true, mode: "person_types" });

    const filled = await controller.fillFromPerson({ value: OTP });
    expect(filled).toMatchObject({ ok: false, reason: "live_disabled" });
    expect(browser.port.fillField).not.toHaveBeenCalled();
  });

  it("types and submits in one breath when it is on", async () => {
    const browser = fakeBrowser();
    const { controller, sensitive } = controllerWith(browser.port, { live: true });
    await controller.enter({ ...TARGET, submitSelector: "#submit" });

    expect(await controller.fillFromPerson({ value: OTP })).toEqual({ ok: true, submitted: true });
    expect(calls).toEqual(["detach", "fill", "submit"]);
    // Registered like any other sensitive value, so a screenshot cannot carry it out.
    expect(JSON.stringify(sensitive.publish("T-1"))).not.toContain(OTP);
    expect(sensitive.live("T-1")).toHaveLength(1);
  });

  it("says nothing was typed when the field ignored the write", async () => {
    const browser = fakeBrowser({ fillField: vi.fn(async () => ({ filled: false })) });
    const { controller, sensitive } = controllerWith(browser.port, { live: true });
    await controller.enter(TARGET);
    expect(await controller.fillFromPerson({ value: OTP })).toMatchObject({
      ok: false,
      reason: "fill_failed",
    });
    expect(sensitive.live()).toEqual([]);
  });

  it("refuses a fill with no phase open", async () => {
    const { controller } = controllerWith(fakeBrowser().port, { live: true });
    expect(await controller.fillFromPerson({ value: OTP })).toMatchObject({
      ok: false,
      reason: "not_active",
    });
  });
});

describe("the three exits", () => {
  it("(a) gives the page back only once the field is provably empty", async () => {
    const browser = fakeBrowser();
    const { controller, states } = controllerWith(browser.port, { live: true });
    await controller.enter(TARGET);
    await controller.fillFromPerson({ value: OTP });

    // Still holding the code: not an exit anyone may call "cleared".
    expect(await controller.proveCleared()).toEqual({ cleared: false, how: null });

    browser.clearField();
    expect(await controller.proveCleared()).toEqual({ cleared: true, how: "empty" });
    expect(await controller.finish()).toBe("cleared");
    expect(browser.port.attachAgent).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual({ type: "exit", exit: "cleared" });
  });

  it("(a) accepts an element that left the DOM, or a page that navigated away", async () => {
    const gone = fakeBrowser();
    const first = controllerWith(gone.port, { live: true }).controller;
    await first.enter(TARGET);
    gone.removeField();
    expect(await first.finish()).toBe("cleared");

    const moved = fakeBrowser();
    const second = controllerWith(moved.port, { live: true }).controller;
    await second.enter(TARGET);
    moved.navigate("https://ctrip.com/order/done");
    expect(await second.proveCleared()).toEqual({ cleared: true, how: "navigated" });
    expect(await second.finish()).toBe("cleared");
  });

  it("(b) keeps the page human-only when the code is still in the field", async () => {
    const browser = fakeBrowser();
    const { controller, sensitive } = controllerWith(browser.port, { live: true });
    await controller.enter(TARGET);
    await controller.fillFromPerson({ value: OTP });

    expect(await controller.finish()).toBe("unproven");
    expect(browser.port.attachAgent).not.toHaveBeenCalled();
    // The value is still on that page, so it stays registered for redaction.
    expect(sensitive.live("T-1")).toHaveLength(1);
  });

  it("(b) treats a page that cannot be asked as unproven, not as fine", async () => {
    const browser = fakeBrowser({
      hasField: vi.fn(async () => {
        throw new Error("target crashed");
      }),
      currentUrl: vi.fn(async () => {
        throw new Error("target crashed");
      }),
    });
    const { controller } = controllerWith(browser.port, { live: true });
    await controller.enter(TARGET);
    expect(await controller.proveCleared()).toEqual({ cleared: false, how: null });
    expect(await controller.finish()).toBe("unproven");
    expect(browser.port.attachAgent).not.toHaveBeenCalled();
  });

  it("(b) also covers a proven-clear field whose channel would not come back", async () => {
    const browser = fakeBrowser({
      attachAgent: vi.fn(async () => {
        throw new Error("cannot reattach");
      }),
    });
    const { controller } = controllerWith(browser.port, { live: true });
    await controller.enter(TARGET);
    browser.removeField();
    expect(await controller.finish()).toBe("unproven");
  });

  it("(c) destroys the target when the flow has to continue elsewhere", async () => {
    const browser = fakeBrowser();
    const { controller, sensitive } = controllerWith(browser.port, { live: true });
    await controller.enter(TARGET);
    await controller.fillFromPerson({ value: OTP });

    expect(await controller.destroyTarget()).toBe("target_destroyed");
    expect(browser.port.destroyTarget).toHaveBeenCalledTimes(1);
    expect(browser.port.attachAgent).not.toHaveBeenCalled();
    expect(sensitive.live("T-1")).toEqual([]);
  });

  it("records every exit with its reason, and never the code", async () => {
    const browser = fakeBrowser();
    const { controller } = controllerWith(browser.port, { live: true });
    await controller.enter(TARGET);
    await controller.fillFromPerson({ value: OTP });
    await controller.finish();

    const written = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
    expect(written).not.toContain(OTP);
    const events = written
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; outcome?: string });
    expect(events.map((entry) => entry.event)).toEqual(["secret_phase_enter", "secret_phase_exit"]);
    expect(events[1]?.outcome).toBe("unproven");
  });

  it("ends the phase without giving anything back when the turn dies mid-flight", async () => {
    const browser = fakeBrowser();
    const { controller } = controllerWith(browser.port, { live: true });
    await controller.enter(TARGET);
    expect(await controller.abandon()).toBe("unproven");
    expect(browser.port.attachAgent).not.toHaveBeenCalled();
    expect(await controller.abandon()).toBeNull();
  });
});
