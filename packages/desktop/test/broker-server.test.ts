/**
 * The broker channel, tested from the position design/003 §11.1 assumes: a hostile caller on the
 * same machine, dialling the same socket.
 *
 * Attacks A3 and A4 of §12 are the two blocks below — connecting without a token or with a forged
 * one, and calling with a well-formed request whose turn, domain or target is not the one the
 * capability was issued for. Both must be refused *and recorded*, because a refusal nobody can see
 * afterwards is indistinguishable from a call that never happened.
 */
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startBrokerServer, type BrokerHandlers, type BrokerServer } from "../src/broker/server.js";

const TASK = "task-1755000000000-aaaa1111";

let dir: string;
let socketPath: string;
let broker: BrokerServer | null = null;
let handlers: BrokerHandlers;
let audited: Array<Record<string, unknown>>;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "broker-"));
  socketPath = path.join(dir, "broker.sock");
  audited = [];
  handlers = {
    request_grant: vi.fn(async () => ({ ok: true as const, result: { grantId: "g-test001" } })),
    secure_fill: vi.fn(async () => ({ ok: true as const, result: { filled: true } })),
    execute_payment: vi.fn(async () => ({ ok: true as const, result: { orderId: "E1" } })),
  };
});

afterEach(async () => {
  await broker?.close();
  broker = null;
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

async function start(options: Partial<Parameters<typeof startBrokerServer>[0]> = {}) {
  broker = await startBrokerServer({
    socketPath,
    handlers,
    token: "test-token-aaaaaaaaaaaaaaaaaaaaaaaa",
    audit: (entry) => {
      audited.push(entry as unknown as Record<string, unknown>);
    },
    ...options,
  });
  return broker;
}

/**
 * A caller that speaks the wire itself.
 *
 * Deliberately not the server package's `BrokerClient`: what is under test here is what the broker
 * accepts from *anything* that can reach the socket, and using our own well-behaved client would
 * quietly restrict the inputs to the ones it knows how to send. The client has its own test, in
 * the package it ships from.
 */
function clientWith(token: string) {
  return {
    async call(request: unknown): Promise<Record<string, unknown>> {
      const answer = await rawSend(`${JSON.stringify({ token, request })}\n`);
      return JSON.parse(answer) as Record<string, unknown>;
    },
  };
}

/** A caller that speaks the socket directly, for frames a typed client could not send. */
async function rawSend(line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    let buffer = "";
    socket.on("connect", () => socket.write(line));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\n")) {
        socket.destroy();
        resolve(buffer.trim());
      }
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(buffer.trim()));
  });
}

const fill = {
  op: "secure_fill" as const,
  taskId: TASK,
  sessionId: "s-1",
  domain: "ctrip.com",
  handle: "pv:g-test001:id_number",
  targetId: "T-1",
  selector: "#idNumber",
};

describe("the token", () => {
  it("lets this launch's server through", async () => {
    const started = await start();
    const response = await clientWith(started.token).call(fill);
    expect(response).toEqual({ ok: true, result: { filled: true } });
    expect(handlers.secure_fill).toHaveBeenCalledTimes(1);
    expect(audited.at(-1)).toMatchObject({ op: "secure_fill", outcome: "accepted" });
  });

  it("refuses a caller with no token — attack A3", async () => {
    await start();
    const response = await rawSend(`${JSON.stringify({ request: fill })}\n`);
    expect(JSON.parse(response)).toMatchObject({ ok: false, code: "unauthorized" });
    expect(handlers.secure_fill).not.toHaveBeenCalled();
    expect(audited.at(-1)).toMatchObject({ outcome: "rejected", reason: "bad or missing token" });
  });

  it("refuses a forged token, and says nothing about why — attack A3", async () => {
    await start();
    const response = await clientWith("test-token-bbbbbbbbbbbbbbbbbbbbbbbb").call(fill);
    expect(response).toMatchObject({ ok: false, code: "unauthorized" });
    expect((response as { message: string }).message).not.toMatch(/length|prefix|characters/i);
    expect(handlers.secure_fill).not.toHaveBeenCalled();
  });

  it("refuses a token of a different length without throwing", async () => {
    await start();
    expect(await clientWith("short").call(fill)).toMatchObject({ code: "unauthorized" });
  });

  it("creates the socket so that only its owner can open it", async () => {
    await start();
    const stat = await fs.stat(socketPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("takes over a socket path left behind by a killed run", async () => {
    await fs.writeFile(socketPath, "stale");
    const started = await start();
    expect(await clientWith(started.token).call(fill)).toMatchObject({ ok: true });
  });
});

describe("the surface", () => {
  it("carries exactly three operations and refuses a fourth", async () => {
    const started = await start();
    const response = await rawSend(
      `${JSON.stringify({
        token: started.token,
        request: { op: "read_vault", taskId: TASK, sessionId: "s-1", domain: "ctrip.com" },
      })}\n`,
    );
    expect(JSON.parse(response)).toMatchObject({ ok: false, code: "unsupported_op" });
  });

  it("refuses an unknown field rather than ignoring it", async () => {
    // A field that is ignored today is a field that gets read tomorrow.
    const started = await start();
    const response = await rawSend(
      `${JSON.stringify({ token: started.token, request: { ...fill, value: "310101199001011234" } })}\n`,
    );
    expect(JSON.parse(response)).toMatchObject({ ok: false, code: "malformed" });
    expect(handlers.secure_fill).not.toHaveBeenCalled();
  });

  it("refuses a fill that carries a value instead of a handle", async () => {
    const started = await start();
    const response = await rawSend(
      `${JSON.stringify({
        token: started.token,
        request: { ...fill, handle: "310101199001011234" },
      })}\n`,
    );
    expect(JSON.parse(response)).toMatchObject({ ok: false, code: "malformed" });
  });

  it("refuses a request missing its binding fields", async () => {
    const started = await start();
    for (const missing of ["taskId", "sessionId", "domain", "targetId"]) {
      const request: Record<string, unknown> = { ...fill };
      delete request[missing];
      const response = await rawSend(`${JSON.stringify({ token: started.token, request })}\n`);
      expect(JSON.parse(response)).toMatchObject({ ok: false, code: "malformed" });
    }
  });

  it("refuses a frame that is not JSON, and one that is too large", async () => {
    const started = await start();
    expect(JSON.parse(await rawSend("not json\n"))).toMatchObject({ code: "malformed" });
    const huge = JSON.stringify({
      token: started.token,
      request: { ...fill, selector: "x".repeat(70_000) },
    });
    expect(JSON.parse(await rawSend(`${huge}\n`))).toMatchObject({ code: "malformed" });
  });

  it("passes a well-formed grant request through with its fields intact", async () => {
    const started = await start();
    const response = await clientWith(started.token).call({
      op: "request_grant",
      taskId: TASK,
      sessionId: "s-1",
      domain: "ctrip.com",
      purpose: "填写乘机人证件",
      fields: ["id_number", "phone_number"],
      mode: "handle",
    });
    expect(response).toMatchObject({ ok: true });
    expect(handlers.request_grant).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ["id_number", "phone_number"], mode: "handle" }),
    );
  });

  it("refuses a wildcard field in a grant request", async () => {
    const started = await start();
    const response = await clientWith(started.token).call({
      op: "request_grant",
      taskId: TASK,
      sessionId: "s-1",
      domain: "ctrip.com",
      purpose: "everything",
      fields: ["*"],
      mode: "handle",
    });
    expect(response).toMatchObject({ ok: false, code: "malformed" });
  });
});

describe("what the handlers do with a bound call — attack A4", () => {
  it("hands the binding fields through unchanged, for main to check", async () => {
    // The broker does not decide whether the turn or the domain is right; it guarantees that what
    // the handler sees is exactly what the caller said, so main's check is against the real claim.
    const started = await start();
    await clientWith(started.token).call({ ...fill, taskId: "task-other", domain: "evil.example" });
    expect(handlers.secure_fill).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-other", domain: "evil.example" }),
    );
  });

  it("passes a handler's refusal back as a refusal, not an error", async () => {
    handlers.secure_fill = vi.fn(async () => ({
      ok: false as const,
      code: "refused" as const,
      message: "grant expired",
    }));
    const started = await start();
    expect(await clientWith(started.token).call(fill)).toMatchObject({
      ok: false,
      code: "refused",
      message: "grant expired",
    });
    expect(audited.at(-1)).toMatchObject({ outcome: "rejected", reason: "refused" });
  });

  it("turns a handler that throws into a refusal that says nothing changed", async () => {
    handlers.execute_payment = vi.fn(async () => {
      throw new Error("vault exploded: token=tok_1P4kJ2");
    });
    const started = await start();
    const response = await clientWith(started.token).call({
      op: "execute_payment",
      taskId: TASK,
      sessionId: "s-1",
      domain: "ctrip.com",
      capabilityId: "cap-1",
      action: "ctrip.payFlightOrder",
      actualPlan: { amount: 1280 },
    });
    expect(response).toMatchObject({ ok: false, code: "internal" });
    // The internal message never reaches the caller: it could quote anything main was holding.
    expect(JSON.stringify(response)).not.toContain("tok_1P4kJ2");
  });
});

describe("rate limiting", () => {
  it("stops a turn that keeps calling, and leaves other turns alone", async () => {
    const started = await start({ callsPerTask: 3 });
    const client = clientWith(started.token);
    for (let i = 0; i < 3; i += 1) expect(await client.call(fill)).toMatchObject({ ok: true });

    expect(await client.call(fill)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(await client.call({ ...fill, taskId: "task-1755000000002-cccc3333" })).toMatchObject({
      ok: true,
    });
    expect(audited.some((entry) => entry["reason"] === "rate limited")).toBe(true);
  });
});

describe("the audit trail", () => {
  it("records the call by operation, turn and domain — and no payload", async () => {
    const started = await start();
    await clientWith(started.token).call(fill);
    expect(audited.at(-1)).toEqual({
      op: "secure_fill",
      taskId: TASK,
      sessionId: "s-1",
      domain: "ctrip.com",
      outcome: "accepted",
    });
    expect(JSON.stringify(audited)).not.toContain("#idNumber");
  });

  it("does not let an audit sink that throws break the answer", async () => {
    const started = await start({
      audit: () => {
        throw new Error("disk full");
      },
    });
    expect(await clientWith(started.token).call(fill)).toMatchObject({ ok: true });
  });
});
