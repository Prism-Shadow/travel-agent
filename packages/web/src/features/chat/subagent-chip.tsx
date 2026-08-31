/**
 * Subagent shortcut row: the trace a spawned child session leaves in the main chat flow. A
 * full-width bar styled like the stream's other collapsed rows (the thinking block /
 * work-group header idiom: rounded border, muted background, left-aligned content) — agent
 * avatar + resolved agent name + short session-id suffix — with a spinner while the child runs
 * and an amber dot (also announced in the accessible name) while any approval is pending
 * anywhere in the child's subtree. Clicking opens the child's own conversation via
 * ctx.onOpenSubagent — a subagent session is an ordinary session for *reading*.
 *
 * A nested approval, though, is answered HERE, not there: the spawn runs inside the parent's
 * task, so the child's own page — rebuilt from its Trace — holds no live approval to click.
 * Each pending approval within the subtree renders as its own row under the chip (tool name +
 * Allow/Deny), submitting through the parent's ordinary approval callback.
 */
import { S } from "../../lib/strings";
import { findToolCard, pendingWithinOrigin } from "../../lib/omni/stream-model";
import type { StreamModel } from "../../lib/omni/stream-model";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { resolveAgentLabel, shortSessionId } from "./subagent-meta";
import { ApprovalButtons } from "./approval-buttons";
import type { StreamRenderContext } from "./message-stream";

export function SubagentChip({
  sessionId,
  model,
  running,
  ctx,
  agentId = null,
}: {
  sessionId: string;
  model: StreamModel;
  running: boolean;
  ctx: StreamRenderContext;
  /** Agent id from the spawning call's arguments (bound tool-card site); the child's own session_meta capture takes priority. */
  agentId?: string | null;
}) {
  const { agents } = useProject();
  const { sessions } = useSessions();
  const label =
    resolveAgentLabel({ sessionId, agentId: model.meta?.agentId ?? agentId }, agents, sessions) ??
    S.chat.subagent;
  const chain = [...ctx.origin, sessionId];
  const pending = pendingWithinOrigin(ctx.pendingApprovals.keys(), chain);
  const name = `${S.chat.subagent} ${label}${pending.length > 0 ? ` · ${S.chat.approvalWaiting}` : ""}`;

  return (
    <div className="w-full">
      {/* Full-width bar, same visual family as the work-group header / thinking row (rounded-md
          border + muted background + px-3 py-2 left-aligned content) — not a compact pill, so the
          row lines up with the stream's other collapsed step rows. */}
      <button
        type="button"
        aria-label={name}
        title={name}
        onClick={() => ctx.onOpenSubagent?.(sessionId)}
        className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900/60 dark:hover:bg-gray-800/60"
      >
        <AgentAvatar id={model.meta?.agentId ?? agentId ?? sessionId} name={label} size={16} />
        <span className="min-w-0 truncate text-xs font-medium text-gray-700 dark:text-gray-300">
          {label}
        </span>
        {sessionId && (
          <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
            {shortSessionId(sessionId)}
          </span>
        )}
        {running && (
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent"
          />
        )}
        {pending.length > 0 && (
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        )}
        <span className="min-w-0 flex-1" />
      </button>
      {pending.map((entry) => {
        // The tool card sits inside the child's nested model: the entry's origin is absolute
        // (from the main session), the chip's model is already the chain's subtree root.
        const card = findToolCard(model, entry.origin.slice(chain.length), entry.toolCallId);
        return (
          <div
            key={entry.toolCallId}
            className="mt-1 flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30"
          >
            <span className="min-w-0 truncate font-mono text-xs text-gray-700 dark:text-gray-300">
              {card?.name ?? entry.toolCallId}
            </span>
            <span className="min-w-0 flex-1" />
            <ApprovalButtons
              onDecide={(decision) => ctx.onApprove(entry.toolCallId, decision, entry.origin)}
            />
          </div>
        );
      })}
    </div>
  );
}
