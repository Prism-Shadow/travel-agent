/**
 * The three things an agent may ask the main process to do.
 *
 * Each is a thin, strictly-shaped tool call that turns into one broker request. What makes them
 * safe is not what happens here — it is what *cannot* happen here:
 *
 * - `request_grant` asks a person for access. It returns handles or a projection; the server never
 *   sees a stored value on either path.
 * - `secure_fill` types one stored value into one element. The **argument is a handle**, so a
 *   compromised agent asking for a fill is asking the main process to use something it does not
 *   have, on a page main checks for itself.
 * - `execute_payment` spends a one-shot capability by **id**. An id is not a permission: every
 *   check runs in main, against the object main holds.
 *
 * Trace safety is a property of the argument shapes, not of a redaction pass: the
 * arguments a model writes contain handles, ids and selectors, and the outputs contain outcomes
 * and refusals. There is no path here that can carry a value into a trace, because no value ever
 * reaches this process.
 *
 * When there is no shell — `penguin web`, the CLI, a test — these tools are simply not offered.
 * A capability that is absent is easier to reason about than one that is present and always fails.
 */
import type {
  BuiltinTool,
  HostTool,
  ToolDefinitionConfig,
  ToolExecutionContext,
} from "@prismshadow/penguin-core";
import { partialToolCallOutput, type OmniMessage } from "@prismshadow/penguin-core";

import type { BrokerClient } from "../broker/client.js";
import type { BrokerRequest, BrokerResponse } from "../broker/protocol.js";

/** How a tool learns which conversation and turn it is running in. */
export interface ToolIdentity {
  sessionId: string;
  taskId: string | null;
}

export interface VaultToolDeps {
  broker: BrokerClient;
  /** Read at call time: a tool instance outlives any single turn. */
  identity: () => ToolIdentity;
  /**
   * The page the agent is on, as the *shell* sees it, when the shell has told this process.
   *
   * Preferred over anything the model writes. When it is null the model's own `domain` argument is
   * sent instead — as a **claim**, which the main process compares against the page it is actually
   * about to act on and refuses on mismatch. Either way the binding check happens where the truth
   * is, and a model that names the wrong site produces a refusal rather than a fill.
   */
  currentDomain: () => string | null;
}

const GRANT_TOOL: ToolDefinitionConfig = {
  name: "request_profile_grant",
  description:
    "Ask the person for permission to use specific saved profile fields on the site you are on. " +
    "Returns a projection of the fields you may read, plus opaque handles for the ones you may " +
    "only have typed for you. Field names are exact; there is no wildcard, and a grant covers one " +
    "site and one turn.",
  permission: "rw",
  parameters: {
    type: "object",
    properties: {
      purpose: {
        type: "string",
        description: "Why, in the person's words. Shown on the card and kept in the audit log.",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description: 'Exact field names, e.g. ["given_name", "id_number"].',
      },
      mode: {
        type: "string",
        enum: ["projection", "handle"],
        description:
          "projection: values you may read (L1 only). handle: opaque references you can only " +
          "pass to fill_saved_field.",
      },
      domain: {
        type: "string",
        description: "The eTLD+1 the grant is for, e.g. ctrip.com. Checked against the open page.",
      },
    },
    required: ["purpose", "fields", "mode"],
  },
};

const FILL_TOOL: ToolDefinitionConfig = {
  name: "fill_saved_field",
  description:
    "Type a saved value into one form field, without ever seeing it. Takes a handle from " +
    "request_profile_grant (pv:<grantId>:<field>) and a CSS selector. The application checks the " +
    "grant against the page you are actually on, types the value, and tells you only whether it " +
    "worked.",
  permission: "rw",
  parameters: {
    type: "object",
    properties: {
      handle: { type: "string", description: "The opaque handle, e.g. pv:g-7f2a:id_number." },
      selector: { type: "string", description: "CSS selector of the input, in the current tab." },
      targetId: {
        type: "string",
        description: "The tab's target id. Omit to use the tab this turn is working in.",
      },
      domain: {
        type: "string",
        description:
          "The eTLD+1 you believe the page is on, e.g. ctrip.com. Checked against the page the " +
          "application is actually looking at; a mismatch is refused.",
      },
    },
    required: ["handle", "selector"],
  },
};

const PAY_TOOL: ToolDefinitionConfig = {
  name: "execute_payment",
  description:
    "Spend a payment permission the person confirmed on a card. Takes the capability id you were " +
    "given and the plan exactly as the payment page shows it now. The application re-checks the " +
    "merchant domain, the amount, the turn and the expiry, and pays at most once. A refusal is a " +
    "normal answer: report it, do not retry it, and never look for another way to pay.",
  permission: "rw",
  parameters: {
    type: "object",
    properties: {
      capabilityId: { type: "string" },
      action: {
        type: "string",
        description: "Stable name for what is being paid, e.g. ctrip.payFlightOrder.",
      },
      actualPlan: {
        type: "object",
        description:
          "What the page says now: merchantDomain, item, amount, currency, cancellation.",
      },
      domain: {
        type: "string",
        description: "The eTLD+1 of the payment page. Checked against what the application sees.",
      },
    },
    required: ["capabilityId", "action", "actualPlan"],
  },
};

/** Builds the host tools, or none when this process has no shell to talk to. */
export function vaultHostTools(deps: VaultToolDeps | null): HostTool[] {
  if (!deps) return [];
  return [
    { definition: GRANT_TOOL, create: (definition) => grantTool(definition, deps) },
    { definition: FILL_TOOL, create: (definition) => fillTool(definition, deps) },
    { definition: PAY_TOOL, create: (definition) => payTool(definition, deps) },
  ];
}

// ---------------------------------------------------------------------------

function grantTool(definition: ToolDefinitionConfig, deps: VaultToolDeps): BuiltinTool {
  return {
    name: definition.name,
    definition,
    execute: (args, ctx) =>
      run(deps, ctx, definition.name, optionalText(args, "domain"), (base) => ({
        op: "request_grant",
        ...base,
        purpose: text(args, "purpose"),
        fields: stringList(args, "fields"),
        mode: enumOf(args, "mode", ["projection", "handle"]),
      })),
  };
}

function fillTool(definition: ToolDefinitionConfig, deps: VaultToolDeps): BuiltinTool {
  return {
    name: definition.name,
    definition,
    execute: (args, ctx) =>
      run(deps, ctx, definition.name, optionalText(args, "domain"), (base) => ({
        op: "secure_fill",
        ...base,
        handle: text(args, "handle"),
        selector: text(args, "selector"),
        targetId: optionalText(args, "targetId") ?? "current",
      })),
  };
}

function payTool(definition: ToolDefinitionConfig, deps: VaultToolDeps): BuiltinTool {
  return {
    name: definition.name,
    definition,
    execute: (args, ctx) =>
      run(deps, ctx, definition.name, optionalText(args, "domain"), (base) => ({
        op: "execute_payment",
        ...base,
        capabilityId: text(args, "capabilityId"),
        action: text(args, "action"),
        actualPlan: record(args, "actualPlan"),
      })),
  };
}

/**
 * One call, end to end.
 *
 * The turn, the conversation and the domain are supplied **here**, from what the host knows — never
 * from the model's arguments. That is what makes main's binding checks meaningful: a model that
 * writes a different `taskId` into its arguments cannot change which turn the call is made for,
 * because the argument is not read.
 */
async function* run(
  deps: VaultToolDeps,
  _ctx: ToolExecutionContext,
  toolName: string,
  claimedDomain: string | undefined,
  build: (base: { taskId: string; sessionId: string; domain: string }) => BrokerRequest,
): AsyncGenerator<OmniMessage> {
  const identity = deps.identity();
  const emit = function* (text: string): Generator<OmniMessage> {
    yield partialToolCallOutput({ eventType: "delta", toolCallId: "", output: text });
  };

  if (!identity.taskId) {
    yield* emit(
      `${toolName} can only be used inside a turn: the permission it presents is bound to one.`,
    );
    return { stopReason: "failed" as const };
  }
  // The shell's view first; the model's claim only when the shell has none. Main checks either
  // against the page it is about to act on, so a wrong claim is a refusal, never a fill.
  const domain = deps.currentDomain() ?? claimedDomain ?? null;
  if (!domain) {
    yield* emit(
      "There is no page open for this turn, so there is nothing to check the permission against. " +
        "Open the site first, or say which domain this is for.",
    );
    return { stopReason: "failed" as const };
  }

  let request: BrokerRequest;
  try {
    request = build({ taskId: identity.taskId, sessionId: identity.sessionId, domain });
  } catch (error) {
    yield* emit((error as Error).message);
    return { stopReason: "failed" as const };
  }

  let response: BrokerResponse;
  try {
    response = await deps.broker.call(request);
  } catch (error) {
    // A broken channel is not a refusal: the shell is gone or wedged, and the agent should say so
    // rather than treat it as "not allowed".
    yield* emit(
      `The application could not be reached to perform this (${(error as Error).message}). ` +
        `Nothing was changed. Tell the person rather than trying another route.`,
    );
    return { stopReason: "failed" as const };
  }

  if (!response.ok) {
    yield* emit(`${response.code}: ${response.message}`);
    // A refusal is a completed call with a "no" in it — the model has to read and report it, not
    // treat it as a transport failure to retry.
    return { stopReason: "completed" as const };
  }
  yield* emit(JSON.stringify(response.result));
  return { stopReason: "completed" as const };
}

// --- argument reading ------------------------------------------------------
// Strict, and shaped like the broker's own parser: a tool call written by a model is exactly the
// kind of input that should never be coerced.

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`"${key}" is required and must be a non-empty string.`);
  }
  return value;
}

function optionalText(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`"${key}" must be a string.`);
  return value;
}

function stringList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`"${key}" must be a non-empty list of field names.`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string") throw new Error(`"${key}" must contain only field names.`);
    return entry;
  });
}

function enumOf<T extends string>(args: Record<string, unknown>, key: string, allowed: T[]): T {
  const value = args[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`"${key}" must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function record(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`"${key}" must be an object.`);
  }
  return value as Record<string, unknown>;
}
