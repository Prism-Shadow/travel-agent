/**
 * Subagent identity and Task-boundary helpers (pure, no React/DOM; unit-tested in
 * test/subagent-meta.test.ts). What survives of the retired subagents side panel: the chip in
 * the stream still resolves a child's display label, and the cost tracker still counts
 * Task-starting user items. The topology extraction and layered-tree layout went with the
 * panel that rendered them.
 */
import type { ChatItem } from "../../lib/omni/stream-model";

/**
 * Count of Task-starting user items (the reducer's startTask predicate: user_text/user_image —
 * steering chips and internal injections such as compaction summaries never become such items,
 * so they never count). The cost tracker reads an INCREASE as a Task boundary
 * (header-stats.ts).
 */
export function taskStartCount(items: readonly ChatItem[]): number {
  let n = 0;
  for (const item of items) {
    if (item.kind === "user_text" || item.kind === "user_image") n += 1;
  }
  return n;
}

/** Lenient string-field read from run_subagent arguments (complete JSON by the time a child is bound; unparseable/absent → null). */
function runSubagentArg(argsJson: string, field: string): string | null {
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed !== null && typeof parsed === "object") {
      const value = (parsed as Record<string, unknown>)[field];
      if (typeof value === "string" && value.length > 0) return value;
    }
  } catch {
    // Arguments still streaming or malformed: nothing to offer.
  }
  return null;
}

/** Lenient `agent_id` extraction from run_subagent arguments. */
export function agentIdFromRunSubagentArgs(argsJson: string): string | null {
  return runSubagentArg(argsJson, "agent_id");
}

/**
 * Resolve a child's display label from the loaded lists: agent id (session_meta capture /
 * run_subagent argument, else the session list row's agentId) → the project agents list's
 * display name (name, with an EMPTY name treated as missing, falling back to the agent id
 * itself) → the child session's title.
 * Null when nothing is known — the caller falls back to a generic label plus the short session id.
 */
export function resolveAgentLabel(
  node: { sessionId: string; agentId: string | null },
  agents: readonly { agentId: string; name?: string }[],
  sessions: readonly { sessionId: string; agentId: string; title?: string }[],
): string | null {
  const row = sessions.find((s) => s.sessionId === node.sessionId);
  const agentId = node.agentId ?? row?.agentId ?? null;
  if (agentId !== null) {
    const agent = agents.find((a) => a.agentId === agentId);
    return agent ? (agent.name?.length ? agent.name : agent.agentId) : agentId;
  }
  return row?.title ?? null;
}

/** Short session-id suffix for chips (ids end in a hex run — the tail is the distinctive part). */
export function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(-8) : sessionId;
}
