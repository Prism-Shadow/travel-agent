/**
 * The capability panel's rules: the end of the fail-closed capability chain.
 *
 * The chain is probe → flag off → **UI states why**, and the last link is the one a screenshot
 * review would miss: a denied capability that renders exactly like a quietly-off one has silently
 * dropped the reason, and with it the person's ability to fix their machine. So the tests here are
 * mostly about the three states staying three.
 */
import { describe, expect, it } from "vitest";

import {
  capabilityRows,
  capabilitySummary,
  misconfigurationLines,
  type CapabilityReport,
} from "../src/features/capabilities/capability-model";

function reportOf(overrides: Partial<CapabilityReport> = {}): CapabilityReport {
  return {
    flags: {
      "vault.enabled": false,
      "vault.l2l3": false,
      "secret_entry.contract": false,
      "secret_entry.live": false,
      "payments.execute": false,
      "payments.agent_click_pay": false,
      "audit.chain": false,
      "redaction.ocr": false,
    },
    denials: [],
    shellPresent: true,
    misconfigured: { unknown: [], invalid: [] },
    ...overrides,
  };
}

describe("the three states", () => {
  it("keeps denied and off distinct, and only denied carries a reason", () => {
    const rows = capabilityRows(
      reportOf({
        flags: { ...reportOf().flags, "vault.enabled": false, "audit.chain": false },
        denials: [
          {
            flag: "vault.enabled",
            reason: "encrypted storage is unavailable … the vault refuses to start",
          },
        ],
      }),
    );
    const vault = rows.find((row) => row.flag === "vault.enabled")!;
    const audit = rows.find((row) => row.flag === "audit.chain")!;

    expect(vault.state).toBe("denied");
    expect(vault.reason).toMatch(/the vault refuses to start/);
    expect(audit.state).toBe("off");
    expect(audit.reason).toBeUndefined();
  });

  it("shows an enabled capability as on, with no reason to explain", () => {
    const rows = capabilityRows(
      reportOf({ flags: { ...reportOf().flags, "secret_entry.contract": true } }),
    );
    expect(rows.find((row) => row.flag === "secret_entry.contract")).toEqual({
      flag: "secret_entry.contract",
      label: expect.stringContaining("验证码卡片"),
      state: "on",
    });
  });

  it("gives every known flag a human label, not its internal spelling", () => {
    for (const row of capabilityRows(reportOf())) {
      expect(row.label).not.toBe(row.flag);
    }
  });

  it("still renders a flag it has never heard of, under its own name", () => {
    // Hiding an unknown capability would be the opposite of this panel's job.
    const rows = capabilityRows(reportOf({ flags: { ...reportOf().flags, "future.thing": true } }));
    expect(rows.find((row) => row.flag === "future.thing")).toEqual({
      flag: "future.thing",
      label: "future.thing",
      state: "on",
    });
  });
});

describe("the summary line", () => {
  it("warns when something asked for was refused", () => {
    const summary = capabilitySummary(
      reportOf({ denials: [{ flag: "vault.enabled", reason: "no keyring" }] }),
    );
    expect(summary.tone).toBe("warning");
    expect(summary.text).toContain("1 项");
  });

  it("stays quiet about a standalone server, which is an ordinary state", () => {
    const summary = capabilitySummary(reportOf({ shellPresent: false }));
    expect(summary.tone).toBe("quiet");
    expect(summary.text).toMatch(/独立服务器/);
  });

  it("stays quiet when everything resolved as configured", () => {
    expect(capabilitySummary(reportOf()).tone).toBe("quiet");
  });
});

describe("misconfiguration", () => {
  it("names the typo, so the person can find it in their own config", () => {
    const lines = misconfigurationLines(
      reportOf({
        misconfigured: {
          unknown: ["vautl.enabled"],
          invalid: [{ flag: "payments.execute", value: "flase" }],
        },
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("vautl.enabled");
    expect(lines[1]).toContain("payments.execute=flase");
    expect(lines[1]).toContain("已按关闭处理");
  });

  it("says nothing when there is nothing to say", () => {
    expect(misconfigurationLines(reportOf())).toEqual([]);
  });
});
