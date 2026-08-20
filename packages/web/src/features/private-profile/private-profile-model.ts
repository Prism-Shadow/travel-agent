/**
 * Pure decisions for the Private Profile settings surface.
 *
 * The capability endpoint is the only source of truth available to the renderer today. In
 * particular, a standalone web server must not be presented as though it has fallen back to a
 * different storage backend: without the desktop shell there is no private profile vault.
 */
import type { CapabilityReport } from "../capabilities/capability-model";

export const PRIVATE_PROFILE_TABS = ["overview", "personal", "preferences", "privacy"] as const;

export type PrivateProfileTab = (typeof PRIVATE_PROFILE_TABS)[number];

export function parsePrivateProfileTab(value: string | null): PrivateProfileTab {
  return PRIVATE_PROFILE_TABS.includes(value as PrivateProfileTab)
    ? (value as PrivateProfileTab)
    : "overview";
}

export type PrivateProfileStorageState = "available" | "desktop_required" | "denied" | "off";

export interface PrivateProfileCapabilityState {
  storage: PrivateProfileStorageState;
  /** The runtime's own denial sentence. It must remain visible rather than becoming a generic off state. */
  storageReason?: string;
  /** L2 identifiers may only be enabled after the independent runtime-isolation gate passes. */
  l2Available: boolean;
  l2Reason?: string;
}

export function privateProfileCapabilityState(
  report: CapabilityReport,
): PrivateProfileCapabilityState {
  const denialFor = new Map(report.denials.map((denial) => [denial.flag, denial.reason]));
  const l2Reason = denialFor.get("vault.l2l3");

  if (!report.shellPresent) {
    return {
      storage: "desktop_required",
      l2Available: false,
      ...(l2Reason ? { l2Reason } : {}),
    };
  }

  const storageReason = denialFor.get("vault.enabled");
  const storage = report.flags["vault.enabled"] ? "available" : storageReason ? "denied" : "off";

  return {
    storage,
    ...(storageReason ? { storageReason } : {}),
    l2Available: report.flags["vault.l2l3"] === true,
    ...(l2Reason ? { l2Reason } : {}),
  };
}
