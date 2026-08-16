/**
 * What this build may do, and why it may not do the rest.
 *
 * design/004 §5 gates every privacy and payment capability behind a flag whose value is decided by
 * a runtime probe, and requires the disabled state to be **visible**: a vault that refused to start
 * because the Linux keyring is missing must say so, or the person is left believing their data is
 * protected by something that never ran (003 §4.4).
 *
 * So this route reports the resolved flags together with the denial reasons `resolveFlags` produced
 * — the same sentences, unedited, because they were written to be read by a person. It reports no
 * secret, no path and no token, which is why it can sit behind ordinary cookie authentication and
 * be read by any logged-in user of this server.
 */
import { Hono } from "hono";
import { listFeatureFlags, resolveFlagsFromEnv } from "@prismshadow/penguin-core";
import type { FeatureFlag } from "@prismshadow/penguin-core";

import type { AppDeps } from "../../app.js";
import type { AppEnv } from "../../auth/middleware.js";
import { BROKER_SOCKET_ENV } from "../../broker/protocol.js";

/** The flags a person is meant to understand, in the order a settings page reads best. */
const PRESENTED: FeatureFlag[] = [
  "vault.enabled",
  "vault.l2l3",
  "secret_entry.contract",
  "secret_entry.live",
  "payments.execute",
  "payments.agent_click_pay",
  "audit.chain",
  "redaction.ocr",
];

export interface CapabilityReport {
  flags: Record<string, boolean>;
  /** One line per capability that was asked for and could not be granted. */
  denials: Array<{ flag: string; reason: string }>;
  /**
   * Whether this process can reach a main process holding a vault at all.
   *
   * False for `penguin web` and for the CLI, and that is not a failure: those builds have no
   * shell, so the vault, the secure fill and the payment path are absent rather than broken.
   */
  shellPresent: boolean;
  /** Flags whose spelling is not recognised, and entries whose value could not be read. */
  misconfigured: { unknown: string[]; invalid: Array<{ flag: string; value: string }> };
}

export function capabilitiesRoutes(_deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    const resolved = resolveFlagsFromEnv();
    const presented = new Set<string>(PRESENTED);
    const flags: Record<string, boolean> = {};
    for (const flag of listFeatureFlags()) {
      if (presented.has(flag)) flags[flag] = resolved.flags[flag];
    }
    const report: CapabilityReport = {
      flags,
      denials: resolved.denials
        .filter((denial) => presented.has(denial.flag))
        .map((denial) => ({ flag: denial.flag, reason: denial.reason })),
      shellPresent: Boolean(process.env[BROKER_SOCKET_ENV]),
      misconfigured: {
        unknown: resolved.unknown,
        invalid: resolved.invalid.map((entry) => ({ flag: entry.flag, value: entry.value })),
      },
    };
    return c.json(report);
  });

  return app;
}
