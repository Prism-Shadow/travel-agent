/**
 * The wire between the server and the desktop main process (design/003 §11).
 *
 * This channel carries the three operations that touch personal data or money, so it is built on
 * the assumption 003 §11.1 states plainly: **there is a hostile caller on this machine**. Before
 * isolation that caller is the agent itself; after it, any other process running as the same user.
 * Everything below follows from that:
 *
 * | Requirement | How |
 * | --- | --- |
 * | authentication | a one-shot token minted by main at launch, handed to the server only through its fork environment |
 * | capability | every call carries a `grantId` / `capabilityId`; there is no "I am the server, therefore I may" |
 * | binding | every call names its turn, its domain and its target, and main re-checks each |
 * | minimal surface | exactly three named operations, no generic forwarding, strict parsing |
 * | audit | every call and every refusal is recorded (without values) |
 *
 * What it does **not** buy, stated here so no UI copy overstates it (003 §11.3): while the agent
 * runtime is not isolated, the token is readable by anything that can read the server process's
 * environment or memory — which includes the agent. The authentication is then a guard against
 * *other* software on the machine, not against the agent, and the real boundary is the one 003 §0.3
 * asks for.
 *
 * Shared by both ends on purpose: a protocol described twice is a protocol with two meanings.
 */

/** Where the socket is, and the token to present. Set by the shell when it forks the server. */
export const BROKER_SOCKET_ENV = "PENGUIN_BROKER_SOCKET";
export const BROKER_TOKEN_ENV = "PENGUIN_BROKER_TOKEN";

/** Newline-delimited JSON, one request per line. Frames are capped so a peer cannot exhaust main. */
export const BROKER_MAX_FRAME_BYTES = 64 * 1024;

/** The only three operations. Adding a fourth is a design decision, not a convenience. */
export type BrokerOp = "request_grant" | "secure_fill" | "execute_payment";

interface BrokerCallBase {
  /** The turn on whose behalf this call is made. Checked against the capability being presented. */
  taskId: string;
  /** The conversation. Used for the secret-phase and handover state that hangs off a session. */
  sessionId: string;
  /** eTLD+1 of the page the call is about. Main re-derives its own view and compares. */
  domain: string;
}

/** Ask the person for access to some fields. Returns handles or a projection — never both. */
export interface RequestGrantCall extends BrokerCallBase {
  op: "request_grant";
  purpose: string;
  fields: string[];
  mode: "projection" | "handle";
}

/** Type one stored value into one element. The value never crosses this wire. */
export interface SecureFillCall extends BrokerCallBase {
  op: "secure_fill";
  /** `pv:<grantId>:<field>` — the capability being presented. */
  handle: string;
  targetId: string;
  selector: string;
}

/** Spend a one-shot payment permission. The agent never holds the credential it spends. */
export interface ExecutePaymentCall extends BrokerCallBase {
  op: "execute_payment";
  capabilityId: string;
  /** Stable action name for the journal, e.g. `ctrip.payFlightOrder`. */
  action: string;
  /** The plan as read from the page right now. Compared against the confirmed one. */
  actualPlan: Record<string, unknown>;
}

export type BrokerRequest = RequestGrantCall | SecureFillCall | ExecutePaymentCall;

export type BrokerResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; code: BrokerRefusalCode; message: string; detail?: string[] };

export type BrokerRefusalCode =
  | "unauthorized"
  | "malformed"
  | "unsupported_op"
  | "rate_limited"
  | "unavailable"
  | "refused"
  | "internal";

export class BrokerProtocolError extends Error {
  readonly code: BrokerRefusalCode;
  constructor(code: BrokerRefusalCode, message: string) {
    super(message);
    this.name = "BrokerProtocolError";
    this.code = code;
  }
}

function str(record: Record<string, unknown>, key: string, max = 300): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new BrokerProtocolError(
      "malformed",
      `${key} is required and must be a non-empty string.`,
    );
  }
  if (value.length > max) {
    throw new BrokerProtocolError("malformed", `${key} is longer than ${max} characters.`);
  }
  return value;
}

/**
 * Parses one request, strictly.
 *
 * Strict means three things, each of which has been a real vulnerability in some other system:
 * unknown operations are refused rather than forwarded, unknown *fields* are refused rather than
 * ignored (so a caller cannot smuggle an argument a future version will start reading), and every
 * string is bounded. Nothing here is coerced — a number where a string belongs is a malformed
 * request, not a request about the number's string form.
 */
export function parseBrokerRequest(raw: unknown): BrokerRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BrokerProtocolError("malformed", "A broker request must be an object.");
  }
  const record = raw as Record<string, unknown>;
  const op = record["op"];
  if (op !== "request_grant" && op !== "secure_fill" && op !== "execute_payment") {
    throw new BrokerProtocolError(
      "unsupported_op",
      `"${String(op)}" is not one of the three operations this channel carries. There is no ` +
        `generic forwarding here by design (003 §11.2).`,
    );
  }

  const base = {
    taskId: str(record, "taskId", 120),
    sessionId: str(record, "sessionId", 120),
    domain: str(record, "domain", 253),
  };

  switch (op) {
    case "request_grant": {
      const fields = record["fields"];
      if (!Array.isArray(fields) || fields.length === 0 || fields.length > 24) {
        throw new BrokerProtocolError("malformed", "fields must be a list of 1–24 field names.");
      }
      for (const field of fields) {
        if (typeof field !== "string" || !/^[a-z0-9_]{1,64}$/.test(field)) {
          throw new BrokerProtocolError(
            "malformed",
            `"${String(field)}" is not a field name. Names are lower-case, and there is no wildcard.`,
          );
        }
      }
      const mode = record["mode"];
      if (mode !== "projection" && mode !== "handle") {
        throw new BrokerProtocolError("malformed", "mode must be 'projection' or 'handle'.");
      }
      assertNoExtraKeys(record, [
        "op",
        "taskId",
        "sessionId",
        "domain",
        "purpose",
        "fields",
        "mode",
      ]);
      return {
        op,
        ...base,
        purpose: str(record, "purpose", 300),
        fields: fields as string[],
        mode,
      };
    }

    case "secure_fill": {
      assertNoExtraKeys(record, [
        "op",
        "taskId",
        "sessionId",
        "domain",
        "handle",
        "targetId",
        "selector",
      ]);
      const handle = str(record, "handle", 200);
      if (!handle.startsWith("pv:")) {
        throw new BrokerProtocolError(
          "malformed",
          "secure_fill takes a vault handle (pv:<grantId>:<field>). A value here would mean the " +
            "caller already had what it is asking us to type.",
        );
      }
      return {
        op,
        ...base,
        handle,
        targetId: str(record, "targetId", 200),
        selector: str(record, "selector", 500),
      };
    }

    case "execute_payment": {
      assertNoExtraKeys(record, [
        "op",
        "taskId",
        "sessionId",
        "domain",
        "capabilityId",
        "action",
        "actualPlan",
      ]);
      const plan = record["actualPlan"];
      if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
        throw new BrokerProtocolError(
          "malformed",
          "actualPlan must be an object read from the page.",
        );
      }
      return {
        op,
        ...base,
        capabilityId: str(record, "capabilityId", 120),
        action: str(record, "action", 200),
        actualPlan: plan as Record<string, unknown>,
      };
    }
  }
}

function assertNoExtraKeys(record: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new BrokerProtocolError(
        "malformed",
        `"${key}" is not part of this operation. Unknown fields are refused rather than ignored, ` +
          `so nothing can be smuggled past a version that does not read it yet.`,
      );
    }
  }
}

/** Encodes one frame. Kept here so both ends agree on the framing as well as the shape. */
export function encodeFrame(value: unknown): string {
  const line = JSON.stringify(value);
  if (Buffer.byteLength(line, "utf8") > BROKER_MAX_FRAME_BYTES) {
    throw new BrokerProtocolError("malformed", "Frame is larger than the channel allows.");
  }
  return `${line}\n`;
}

/**
 * The socket path for a data root.
 *
 * A Unix domain socket inside the app's own directory (which is 0700), or a Windows named pipe.
 * The path is derived rather than configured: a socket somewhere a caller could choose would be a
 * socket a caller could put on a world-writable directory.
 */
export function brokerSocketPath(input: { dataRoot: string; id: string }): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\penguin-broker-${input.id}`;
  }
  return `${input.dataRoot}/broker-${input.id}.sock`;
}
