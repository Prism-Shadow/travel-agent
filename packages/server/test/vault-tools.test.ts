/**
 * The three host tools, from the model's side.
 *
 * What is pinned here is mostly what the tools *do not* do: they do not read the turn, the
 * conversation or the domain from the model's arguments, they do not turn a refusal into a
 * transport error (or the reverse), and they carry nothing but handles and ids — so a trace of a
 * whole booking contains no personal value, which is the no-values invariant at the
 * `builtin tool` row.
 */
import { describe, expect, it, vi } from "vitest";

import type { BrokerRequest, BrokerResponse } from "../src/broker/protocol.js";
import type { BrokerClient } from "../src/broker/client.js";
import { vaultHostTools, type VaultToolDeps } from "../src/tools/vault-tools.js";

const SESSION = "session-2026-08-16-10-00-00-aaaa0001";
const TASK = "task-1755000000000-aaaa1111";

function toolsWith(options: {
  answer?: BrokerResponse;
  fail?: Error;
  taskId?: string | null;
  domain?: string | null;
}) {
  const sent: BrokerRequest[] = [];
  const broker = {
    call: vi.fn(async (request: BrokerRequest) => {
      sent.push(request);
      if (options.fail) throw options.fail;
      return options.answer ?? { ok: true, result: { done: true } };
    }),
  } as unknown as BrokerClient;
  const deps: VaultToolDeps = {
    broker,
    // `=== undefined` rather than `??`: the case being set up *is* a null taskId, and `??` would
    // quietly replace it with the default and test nothing.
    identity: () => ({
      sessionId: SESSION,
      taskId: options.taskId === undefined ? TASK : options.taskId,
    }),
    currentDomain: () => (options.domain === undefined ? "ctrip.com" : options.domain),
  };
  const tools = vaultHostTools(deps);
  return { tools, sent, broker };
}

async function call(
  tool: ReturnType<typeof vaultHostTools>[number],
  args: Record<string, unknown>,
): Promise<{ output: string; stopReason: string }> {
  const created = tool.create(tool.definition);
  const chunks: string[] = [];
  const generator = created.execute(args, { workspaceDir: "/tmp", toolCallId: "call-1" });
  let result = await generator.next();
  while (!result.done) {
    const payload = result.value.payload as { output?: string };
    if (payload.output) chunks.push(payload.output);
    result = await generator.next();
  }
  return {
    output: chunks.join(""),
    stopReason: (result.value as { stopReason?: string } | undefined)?.stopReason ?? "completed",
  };
}

const byName = (tools: ReturnType<typeof vaultHostTools>, name: string) =>
  tools.find((tool) => tool.definition.name === name)!;

describe("what the host offers", () => {
  it("offers nothing at all without a shell to talk to", () => {
    expect(vaultHostTools(null)).toEqual([]);
  });

  it("offers exactly three tools, all of them writes", () => {
    const { tools } = toolsWith({});
    expect(tools.map((tool) => tool.definition.name)).toEqual([
      "request_profile_grant",
      "fill_saved_field",
      "execute_payment",
    ]);
    expect(tools.every((tool) => tool.definition.permission === "rw")).toBe(true);
  });

  it("describes the fill tool as taking a handle, never a value", () => {
    const { tools } = toolsWith({});
    const fill = byName(tools, "fill_saved_field").definition;
    expect(JSON.stringify(fill.parameters)).toContain("handle");
    expect(JSON.stringify(fill.parameters)).not.toMatch(/"value"/);
    expect(fill.description).toMatch(/without ever seeing it/);
  });
});

describe("what reaches the broker", () => {
  it("takes the turn and the conversation from the host, never from the model", async () => {
    // A model that writes its own taskId into the arguments changes nothing: that argument is not
    // read at all, so main's binding check is against a claim the model cannot make.
    const { tools, sent } = toolsWith({});
    await call(byName(tools, "fill_saved_field"), {
      handle: "pv:g-test001:id_number",
      selector: "#idNumber",
      taskId: "task-someone-elses",
    });
    expect(sent[0]).toMatchObject({
      op: "secure_fill",
      taskId: TASK,
      sessionId: SESSION,
      domain: "ctrip.com",
      handle: "pv:g-test001:id_number",
    });
  });

  it("prefers the shell's view of the page over the model's claim about it", async () => {
    const { tools, sent } = toolsWith({});
    await call(byName(tools, "fill_saved_field"), {
      handle: "pv:g-test001:id_number",
      selector: "#idNumber",
      domain: "evil.example",
    });
    expect(sent[0]).toMatchObject({ domain: "ctrip.com" });
  });

  it("sends the model's claim only when the shell has no view, for main to check", async () => {
    // The claim is not trusted — it is compared, in the process that can see the real page. A
    // wrong claim therefore produces a refusal rather than a fill.
    const { tools, sent } = toolsWith({ domain: null });
    await call(byName(tools, "fill_saved_field"), {
      handle: "pv:g-test001:id_number",
      selector: "#idNumber",
      domain: "ctrip.com",
    });
    expect(sent[0]).toMatchObject({ domain: "ctrip.com" });
  });

  it("sends a grant request with its exact field list", async () => {
    const { tools, sent } = toolsWith({});
    await call(byName(tools, "request_profile_grant"), {
      purpose: "填写乘机人证件",
      fields: ["given_name", "id_number"],
      mode: "handle",
    });
    expect(sent[0]).toMatchObject({
      op: "request_grant",
      fields: ["given_name", "id_number"],
      mode: "handle",
    });
  });

  it("sends the payment plan as the page reported it", async () => {
    const { tools, sent } = toolsWith({});
    await call(byName(tools, "execute_payment"), {
      capabilityId: "cap-1",
      action: "ctrip.payFlightOrder",
      actualPlan: { merchantDomain: "ctrip.com", amount: 1280, currency: "CNY" },
    });
    expect(sent[0]).toMatchObject({
      op: "execute_payment",
      capabilityId: "cap-1",
      actualPlan: { amount: 1280 },
    });
  });

  it("refuses malformed arguments without dialling at all", async () => {
    const { tools, broker } = toolsWith({});
    const missingHandle = await call(byName(tools, "fill_saved_field"), { selector: "#a" });
    expect(missingHandle.stopReason).toBe("failed");
    expect(missingHandle.output).toMatch(/"handle" is required/);

    const badMode = await call(byName(tools, "request_profile_grant"), {
      purpose: "p",
      fields: ["given_name"],
      mode: "everything",
    });
    expect(badMode.output).toMatch(/must be one of/);
    expect(broker.call).not.toHaveBeenCalled();
  });

  it("refuses outside a turn, and with no page open", async () => {
    const outsideTurn = toolsWith({ taskId: null });
    const one = await call(byName(outsideTurn.tools, "execute_payment"), {
      capabilityId: "cap-1",
      action: "a",
      actualPlan: {},
    });
    expect(one.output).toMatch(/only be used inside a turn/);
    expect(outsideTurn.broker.call).not.toHaveBeenCalled();

    const noPage = toolsWith({ domain: null });
    const two = await call(byName(noPage.tools, "fill_saved_field"), {
      handle: "pv:g-test001:id_number",
      selector: "#a",
    });
    expect(two.output).toMatch(/no page open/);
    expect(noPage.broker.call).not.toHaveBeenCalled();
  });
});

describe("what comes back", () => {
  it("reports a refusal as a completed call the model has to read", async () => {
    // Not a failure: "that capability expired" is an answer, and a model that treated it as a
    // transport error would retry it.
    const { tools } = toolsWith({
      answer: { ok: false, code: "refused", message: "capability_expired: ask again" },
    });
    const result = await call(byName(tools, "execute_payment"), {
      capabilityId: "cap-1",
      action: "a",
      actualPlan: {},
    });
    expect(result.stopReason).toBe("completed");
    expect(result.output).toMatch(/capability_expired/);
  });

  it("reports a broken channel as a failure, and says nothing was changed", async () => {
    const { tools } = toolsWith({ fail: new Error("ENOENT: no such socket") });
    const result = await call(byName(tools, "fill_saved_field"), {
      handle: "pv:g-test001:id_number",
      selector: "#a",
    });
    expect(result.stopReason).toBe("failed");
    expect(result.output).toMatch(/could not be reached/);
    expect(result.output).toMatch(/Nothing was changed/);
  });

  it("passes a success through as the result object", async () => {
    const { tools } = toolsWith({ answer: { ok: true, result: { orderId: "E123456" } } });
    const result = await call(byName(tools, "execute_payment"), {
      capabilityId: "cap-1",
      action: "a",
      actualPlan: {},
    });
    expect(JSON.parse(result.output)).toEqual({ orderId: "E123456" });
  });

  it("carries no personal value in anything it sends or returns", async () => {
    const { tools, sent } = toolsWith({
      answer: { ok: true, result: { filled: true, field: "id_number" } },
    });
    const result = await call(byName(tools, "fill_saved_field"), {
      handle: "pv:g-test001:id_number",
      selector: "#idNumber",
    });
    const traced = JSON.stringify({ sent, output: result.output });
    expect(traced).toContain("pv:g-test001:id_number");
    expect(traced).not.toMatch(/\d{15,}/);
  });
});
