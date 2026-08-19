/**
 * The observability rates, read-only, for the admin/settings surface.
 *
 * A snapshot of the three design signals — takeover, secret-phase, card-fallback — plus the raw
 * interaction counts behind them. It carries no session content, no user data and no value: only
 * counts and ratios, which is why it can sit behind ordinary cookie authentication like the rest of
 * the read surfaces. The numbers are per-process and reset on restart; this is a live gauge, not an
 * analytics store.
 */
import { Hono } from "hono";

import type { AppDeps } from "../../app.js";
import type { AppEnv } from "../../auth/middleware.js";

export function metricsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => c.json(deps.metrics.snapshot()));
  return app;
}
