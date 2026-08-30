/**
 * `GET /api/sessions/:sessionId/usage` — the chat header's cost reconcile.
 *
 * The narrow read that survived the developer console's removal: one conversation's cumulative
 * Token buckets and cost, nothing project-wide. Two properties matter here:
 *
 *   - **`usage: null` and zeroes stay distinguishable.** The header treats "nothing recorded"
 *     as "leave the display alone", not as "the session cost $0".
 *   - **Non-disclosure.** A conversation that does not exist and one the caller may not see
 *     answer identically (404), exactly like every other session-level route.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { UsageRepo } from "../src/db/repos/usage.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-31-10-00-00-ddee0001";

describe("session usage route", () => {
  let t: TestApp;
  let ownerCookie: string;
  let outsiderCookie: string;
  let usage: UsageRepo;

  const rowFor = (sessionId: string, projectId: string): SessionRow => ({
    sessionId,
    projectId,
    agentId: "default_agent",
    modelId: "m1",
    provider: "custom",
    workspace: "/tmp/w",
    approvalMode: "always-ask",
    title: null,
    createdAt: new Date().toISOString(),
  });

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie: ownerCookie } = await provisionUser(t.app, "usage_owner"));
    ({ cookie: outsiderCookie } = await provisionUser(t.app, "usage_outsider"));
    t.deps.sessionsRepo.insert(rowFor(SID, "usage_owner-default_project"));
    usage = new UsageRepo(t.deps.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const record = (sessionId: string, total: number): void => {
    usage.insert({
      ts: "2026-08-31T00:00:00.000Z",
      date: "2026-08-31",
      projectId: "usage_owner-default_project",
      agentId: "default_agent",
      sessionId,
      originSessionId: null,
      provider: "custom",
      modelId: "m1",
      cacheRead: 10,
      cacheWrite: 1,
      output: 5,
      total,
    });
  };

  it("answers the session's cumulative buckets; cost is null with hasUncosted while no pricing is configured", async () => {
    record(SID, 100);
    record(SID, 50);
    const res = await apiClient(t.app, ownerCookie).get(`/api/sessions/${SID}/usage`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      usage: {
        cacheRead: 20,
        cacheWrite: 2,
        output: 10,
        total: 150,
        requests: 2,
        cost: null,
        hasUncosted: true,
      },
    });
  });

  it("answers usage: null before anything is recorded — not a zero row", async () => {
    const res = await apiClient(t.app, ownerCookie).get(`/api/sessions/${SID}/usage`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usage: null });
  });

  it("a session the caller may not see and one that does not exist answer identically", async () => {
    record(SID, 100);
    const outsider = await apiClient(t.app, outsiderCookie).get(`/api/sessions/${SID}/usage`);
    expect(outsider.status).toBe(404);
    const missing = await apiClient(t.app, ownerCookie).get(
      "/api/sessions/session-2026-08-31-10-00-00-00000000/usage",
    );
    expect(missing.status).toBe(404);
  });
});
