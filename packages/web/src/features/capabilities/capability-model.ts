/**
 * How the build's capability report becomes something a person can act on.
 *
 * The fail-closed capability rule ends at a screen: a capability that failed its probe resolves
 * off, and *the person must be able to see that and why* — otherwise "the vault refused to start
 * because Linux has no keyring" is indistinguishable from "there is no vault feature". This module
 * turns the raw report into rows with exactly three states:
 *
 * - **on** — the capability is available in this build.
 * - **denied** — it was asked for and refused, and the row carries the server's own sentence about
 *   why plus what to do. This is the state that must never be silently collapsed into the next one.
 * - **off** — nobody asked for it. The quiet default, shown without alarm.
 *
 * Pure functions, so the rules render the same in a test as on the page.
 */

/** Mirrors the server's `CapabilityReport` shape (http/routes/capabilities.ts). */
export interface CapabilityReport {
  flags: Record<string, boolean>;
  denials: Array<{ flag: string; reason: string }>;
  shellPresent: boolean;
  misconfigured: { unknown: string[]; invalid: Array<{ flag: string; value: string }> };
}

export type CapabilityState = "on" | "denied" | "off";

export interface CapabilityRow {
  flag: string;
  /** What it does, in the person's language — never the flag's internal spelling alone. */
  label: string;
  state: CapabilityState;
  /** The server's own sentence, present only in the `denied` state. */
  reason?: string;
}

/**
 * Labels, in the order the panel reads best: storage first, then what storage enables, then
 * payment. A flag the server reports that is not named here still renders, under its own spelling,
 * because hiding an unknown capability would be the opposite of this panel's job.
 */
const LABELS: Array<{ flag: string; label: string }> = [
  { flag: "vault.enabled", label: "私密资料保管库" },
  { flag: "vault.l2l3", label: "真实证件号与支付凭证（需要隔离达标）" },
  { flag: "audit.chain", label: "防篡改审计链" },
  { flag: "secret_entry.contract", label: "验证码卡片（演示形态）" },
  { flag: "secret_entry.live", label: "代填真实验证码（需要隔离达标）" },
  { flag: "payments.execute", label: "应用内代付（需要隔离达标）" },
  { flag: "payments.agent_click_pay", label: "允许点击站点付款按钮" },
  { flag: "redaction.ocr", label: "截图脱敏 OCR 兜底" },
];

export function capabilityRows(report: CapabilityReport): CapabilityRow[] {
  const denialFor = new Map(report.denials.map((denial) => [denial.flag, denial.reason]));
  const known = new Set(LABELS.map((entry) => entry.flag));
  const rows: CapabilityRow[] = [];

  for (const { flag, label } of LABELS) {
    if (!(flag in report.flags)) continue;
    rows.push(rowFor(flag, label, report.flags[flag] === true, denialFor.get(flag)));
  }
  for (const [flag, value] of Object.entries(report.flags)) {
    if (known.has(flag)) continue;
    rows.push(rowFor(flag, flag, value === true, denialFor.get(flag)));
  }
  return rows;
}

function rowFor(
  flag: string,
  label: string,
  on: boolean,
  reason: string | undefined,
): CapabilityRow {
  if (on) return { flag, label, state: "on" };
  if (reason !== undefined) return { flag, label, state: "denied", reason };
  return { flag, label, state: "off" };
}

/**
 * The one-line summary above the rows.
 *
 * The distinction it draws is the one people actually need: "this build has no shell" is an
 * ordinary state (the web server run alone), while "a capability you asked for was refused" is a
 * message about *this machine* that should not be scrolled past.
 */
export function capabilitySummary(report: CapabilityReport): {
  tone: "quiet" | "warning";
  text: string;
} {
  if (report.denials.length > 0) {
    return {
      tone: "warning",
      text: `有 ${report.denials.length} 项能力因本机条件未满足而被关闭，详情见下。`,
    };
  }
  if (!report.shellPresent) {
    return {
      tone: "quiet",
      text: "当前以独立服务器运行，没有桌面外壳，保管库与代付能力不在此形态提供。",
    };
  }
  return { tone: "quiet", text: "以下能力按本机探测结果生效。" };
}

/** Misconfiguration lines, verbatim enough that the person can find the typo. */
export function misconfigurationLines(report: CapabilityReport): string[] {
  const lines: string[] = [];
  for (const name of report.misconfigured.unknown) {
    lines.push(`「${name}」不是一个可识别的开关名，未生效。`);
  }
  for (const entry of report.misconfigured.invalid) {
    lines.push(`「${entry.flag}=${entry.value}」的取值无法识别，已按关闭处理。`);
  }
  return lines;
}
