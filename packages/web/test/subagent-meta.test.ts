/**
 * subagent-meta.ts unit tests (plus the stream-model identity pieces the chip leans on):
 * Task-start counting for the cost tracker, run_subagent argument parsing, session_meta
 * capture landing on the nested model, the pending-approval subtree predicate behind the
 * chip's amber dot, and display-label resolution.
 */
import { describe, expect, it } from "vitest";
import {
  assistantText,
  imageUrlMessage,
  sessionMeta,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core/omnimessage";
import type { OmniMessage, SessionMetaPayload } from "@prismshadow/penguin-core/omnimessage";
import {
  agentIdFromStatePath,
  approvalKey,
  createStreamModel,
  hasPendingWithinOrigin,
  pendingWithinOrigin,
  pushMessage,
} from "../src/lib/omni/stream-model";
import {
  agentIdFromRunSubagentArgs,
  resolveAgentLabel,
  shortSessionId,
  taskStartCount,
} from "../src/features/chat/subagent-meta";

function meta(sessionId: string, agentState = "/a"): OmniMessage<SessionMetaPayload> {
  return sessionMeta({
    session_id: sessionId,
    model_id: "m",
    provider: "custom",
    model_context_window: 200000,
    system_prompt: "",
    agent_state: agentState,
    workspace: "/w",
    source: "subagent",
  });
}

describe("subagent identity helpers", () => {
  it("taskStartCount counts Task-starting user items (text and image); steering chips never count", () => {
    const m = createStreamModel();
    expect(taskStartCount(m.items)).toBe(0);
    pushMessage(m, userText("t1"));
    pushMessage(m, assistantText("r1"));
    // Mid-run steering renders as a user_steering item — inside the running Task, not a new one.
    pushMessage(m, userText("[user_steering]\nnudge\n[/user_steering]"));
    expect(taskStartCount(m.items)).toBe(1);
    // An image sent WITH that steering message follows it directly and joins its chip, so it
    // starts nothing either; the assistant reply then closes the chip's collection window.
    pushMessage(m, imageUrlMessage("data:image/png;base64,steered"));
    expect(taskStartCount(m.items)).toBe(1);
    pushMessage(m, assistantText("r2"));
    // A standalone Prompt image (no steering message in front of it) still starts a Task.
    pushMessage(m, imageUrlMessage("data:image/png;base64,xx"));
    expect(taskStartCount(m.items)).toBe(2);
    pushMessage(m, userText("t3"));
    expect(taskStartCount(m.items)).toBe(3);
  });

  it("agentIdFromStatePath takes the parent directory name; degenerate paths give null", () => {
    expect(agentIdFromStatePath("/data/proj/agents/researcher/agent_state")).toBe("researcher");
    expect(agentIdFromStatePath("C:\\data\\proj\\agents\\win_agent\\agent_state")).toBe(
      "win_agent",
    );
    expect(agentIdFromStatePath("agent_state")).toBeNull();
    expect(agentIdFromStatePath("")).toBeNull();
  });

  it("agentIdFromRunSubagentArgs reads agent_id from complete JSON only", () => {
    expect(agentIdFromRunSubagentArgs('{"prompt": "x", "agent_id": "helper"}')).toBe("helper");
    expect(agentIdFromRunSubagentArgs('{"prompt": "x"}')).toBeNull();
    expect(agentIdFromRunSubagentArgs('{"agent_id": "hel')).toBeNull();
    expect(agentIdFromRunSubagentArgs("")).toBeNull();
  });

  it("session_meta capture lands on the nested model (agent/provider/model/source), never on the main model", () => {
    const m = createStreamModel();
    pushMessage(m, meta("main", "/data/proj/agents/main_agent/agent_state"));
    expect(m.meta).toBeNull();
    pushMessage(m, withOrigin(meta("c1", "/data/proj/agents/child_agent/agent_state"), "c1"));
    expect(m.subagents.get("c1")!.meta).toEqual({
      agentId: "child_agent",
      provider: "custom",
      modelId: "m",
      source: "subagent",
    });
  });

  it("hasPendingWithinOrigin matches keys at or below the chain, never the main session's own keys", () => {
    const keys = [
      approvalKey([], "t-main"),
      approvalKey(["c1"], "t-child"),
      approvalKey(["c1", "gc1"], "t-deep"),
    ];
    expect(hasPendingWithinOrigin(keys, ["c1"])).toBe(true);
    expect(hasPendingWithinOrigin(keys, ["c1", "gc1"])).toBe(true);
    expect(hasPendingWithinOrigin(keys, ["c2"])).toBe(false);
    expect(hasPendingWithinOrigin([approvalKey([], "t-main")], ["c1"])).toBe(false);
  });

  it("pendingWithinOrigin parses the subtree's keys back to origin + toolCallId, and only those", () => {
    const keys = [
      approvalKey([], "t-main"),
      approvalKey(["c1"], "t-child"),
      approvalKey(["c1", "gc1"], "t-deep"),
      approvalKey(["c1x"], "t-sibling"), // id merely extending the chain must not match
    ];
    expect(pendingWithinOrigin(keys, ["c1"])).toEqual([
      { origin: ["c1"], toolCallId: "t-child" },
      { origin: ["c1", "gc1"], toolCallId: "t-deep" },
    ]);
    expect(pendingWithinOrigin(keys, ["c1", "gc1"])).toEqual([
      { origin: ["c1", "gc1"], toolCallId: "t-deep" },
    ]);
    expect(pendingWithinOrigin(keys, ["c2"])).toEqual([]);
  });

  it("resolveAgentLabel: agents list name -> bare agent id -> session row's agent -> session title -> null", () => {
    const agents = [
      { agentId: "researcher", name: "Researcher" },
      { agentId: "plain" },
      { agentId: "unnamed", name: "" },
    ];
    const sessions = [
      { sessionId: "s1", agentId: "researcher", title: "Row title" },
      { sessionId: "s2", agentId: "ghost" },
    ];
    expect(resolveAgentLabel({ sessionId: "x", agentId: "researcher" }, agents, sessions)).toBe(
      "Researcher",
    );
    expect(resolveAgentLabel({ sessionId: "x", agentId: "plain" }, agents, sessions)).toBe("plain");
    // An empty display name counts as missing, not as a real (blank) label.
    expect(resolveAgentLabel({ sessionId: "x", agentId: "unnamed" }, agents, sessions)).toBe(
      "unnamed",
    );
    // Agent unknown to the list: the id itself still beats nothing.
    expect(resolveAgentLabel({ sessionId: "x", agentId: "mystery" }, agents, sessions)).toBe(
      "mystery",
    );
    // No agent id on the node: the session row supplies it.
    expect(resolveAgentLabel({ sessionId: "s1", agentId: null }, agents, sessions)).toBe(
      "Researcher",
    );
    expect(resolveAgentLabel({ sessionId: "s2", agentId: null }, agents, sessions)).toBe("ghost");
    expect(resolveAgentLabel({ sessionId: "gone", agentId: null }, agents, sessions)).toBeNull();
  });

  it("shortSessionId keeps the distinctive tail", () => {
    expect(shortSessionId("session-2026-07-14-09-05-11-1a2b3c01")).toBe("1a2b3c01");
    expect(shortSessionId("short")).toBe("short");
  });
});
