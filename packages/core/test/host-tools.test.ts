/**
 * Tools a host contributes, and the one thing they may not do.
 *
 * The hook exists because the desktop shell has capabilities core does not and should not learn:
 * paying for something, or typing a stored identity number into a page, are meaningless without a
 * broker to a main process holding a vault. Putting them in the built-in registry would put a
 * travel product's semantics into a product-neutral runtime — the same argument that kept the
 * payment rules out of core's goal prompt in the previous phase.
 *
 * What is pinned here: a host tool is listed to the model, is executable, carries its own
 * permission, and **cannot shadow a built-in**. The last one is a refusal rather than a precedence
 * rule, because a name that means one thing in the desktop app and another in the CLI is a bug
 * nobody can see from either side.
 */
import { describe, expect, it } from "vitest";

import { Environment } from "../src/environment/environment.js";
import type { BuiltinTool } from "../src/environment/tools/types.js";
import type { HostTool, ToolDefinitionConfig } from "../src/interfaces.js";
import { partialToolCallOutput, toolCall } from "../src/omnimessage/index.js";

const EXECUTE_PAYMENT: ToolDefinitionConfig = {
  name: "execute_payment",
  description: "Spend a one-shot payment capability the person confirmed.",
  permission: "rw",
  parameters: { type: "object", properties: { capabilityId: { type: "string" } } },
};

function hostTool(definition: ToolDefinitionConfig, onCall?: (args: unknown) => void): HostTool {
  return {
    definition,
    create: (def): BuiltinTool => ({
      name: def.name,
      definition: def,
      async *execute(args) {
        onCall?.(args);
        yield partialToolCallOutput({
          eventType: "delta",
          toolCallId: "call-1",
          output: `ran ${def.name}`,
        });
      },
    }),
  };
}

function environmentWith(hostTools: HostTool[]): Environment {
  return new Environment({
    workspaceDir: process.cwd(),
    toolConfig: { customTools: [], mcpServers: [] },
    hostTools,
  });
}

describe("host tools", () => {
  it("are listed to the model alongside the built-ins", async () => {
    const environment = environmentWith([hostTool(EXECUTE_PAYMENT)]);
    const listed = await environment.listTools();
    expect(listed).toEqual([
      {
        name: "execute_payment",
        description: EXECUTE_PAYMENT.description,
        parameters: EXECUTE_PAYMENT.parameters,
      },
    ]);
  });

  it("carry their own permission, so the approval flow treats them as what they are", () => {
    const environment = environmentWith([hostTool(EXECUTE_PAYMENT)]);
    expect(environment.toolPermission("execute_payment")).toBe("rw");
    expect(environment.toolPermission("nothing_like_this")).toBeUndefined();
  });

  it("execute", async () => {
    const seen: unknown[] = [];
    const environment = environmentWith([hostTool(EXECUTE_PAYMENT, (args) => seen.push(args))]);
    const messages = [];
    for await (const message of environment.executeTool({
      toolCall: toolCall({
        toolCallId: "call-1",
        name: "execute_payment",
        arguments: JSON.stringify({ capabilityId: "cap-1" }),
      }),
    })) {
      messages.push(message);
    }
    expect(seen).toEqual([{ capabilityId: "cap-1" }]);
    expect(JSON.stringify(messages)).toContain("ran execute_payment");
  });

  it("leave the caller's tool config untouched", () => {
    // The host's list is folded in for this Environment only; the object the caller passed is the
    // Agent's own config and is reused for every Session.
    const toolConfig = { customTools: [], mcpServers: [] };
    new Environment({
      workspaceDir: process.cwd(),
      toolConfig,
      hostTools: [hostTool(EXECUTE_PAYMENT)],
    });
    expect(toolConfig.customTools).toEqual([]);
  });

  it("refuse to shadow a built-in", () => {
    expect(() =>
      environmentWith([
        hostTool({ name: "exec_command", description: "not the real one", permission: "rw" }),
      ]),
    ).toThrow(/already a built-in/);
  });

  it("are absent when the host offers none, which is the ordinary case", async () => {
    const environment = new Environment({
      workspaceDir: process.cwd(),
      toolConfig: { customTools: [], mcpServers: [] },
    });
    expect(await environment.listTools()).toEqual([]);
  });
});
