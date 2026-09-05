/**
 * The server's end of the broker channel: the dial, the frame, and every way a call can fail that
 * is *not* a refusal.
 *
 * The distinction under test is the one the callers depend on. A refusal — "that grant expired" —
 * comes back as a value and is reported to the agent. A broken channel — no shell, a socket that
 * went away mid-call, something on the path that does not speak this protocol — throws, because the
 * tool has to say something different in that case: not "you may not", but "this build cannot".
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BrokerClient, brokerFromEnv } from "../src/broker/client.js";
import {
  BROKER_SOCKET_ENV,
  BROKER_TOKEN_ENV,
  brokerSocketPath,
  encodeFrame,
  parseBrokerRequest,
  BrokerProtocolError,
} from "../src/broker/protocol.js";

const FILL = {
  op: "secure_fill" as const,
  taskId: "task-1755000000000-aaaa1111",
  sessionId: "s-1",
  domain: "ctrip.com",
  handle: "pv:g-test001:id_number",
  targetId: "T-1",
  selector: "#idNumber",
};

let dir: string;
let socketPath: string;
let server: net.Server | null = null;
let received: Array<{ token?: unknown; request?: unknown }>;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "broker-client-"));
  // The production shape, not a file under the temp dir: on Windows a local socket is a named
  // pipe under \\.\pipe\, and a filesystem path there neither listens nor connects.
  socketPath = brokerSocketPath({ dataRoot: dir, id: randomBytes(6).toString("hex") });
  received = [];
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/** A stub broker that answers with whatever the test says, or misbehaves on purpose. */
async function listen(reply: (line: string, socket: net.Socket) => void): Promise<void> {
  server = net.createServer((socket) => {
    let buffer = "";
    // The client hangs up as soon as it has an answer (or gives up), so a stub that is still
    // writing sees ECONNRESET. That is the scenario, not a fault.
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      try {
        received.push(JSON.parse(line) as { token?: unknown; request?: unknown });
      } catch {
        received.push({});
      }
      reply(line, socket);
    });
  });
  await new Promise<void>((resolve) => server!.listen(socketPath, () => resolve()));
}

function client(timeoutMs = 2_000): BrokerClient {
  return new BrokerClient({ socketPath, token: "test-token", timeoutMs });
}

describe("one call", () => {
  it("presents the token and the request, and returns the answer", async () => {
    await listen((_line, socket) => {
      socket.end(encodeFrame({ ok: true, result: { filled: true } }));
    });

    expect(await client().call(FILL)).toEqual({ ok: true, result: { filled: true } });
    expect(received[0]).toEqual({ token: "test-token", request: FILL });
  });

  it("returns a refusal as a value rather than throwing", async () => {
    await listen((_line, socket) => {
      socket.end(encodeFrame({ ok: false, code: "refused", message: "grant expired" }));
    });
    expect(await client().call(FILL)).toEqual({
      ok: false,
      code: "refused",
      message: "grant expired",
    });
  });

  it("throws when nothing is listening — the shell is gone", async () => {
    await expect(client().call(FILL)).rejects.toThrow(/ENOENT|connect/i);
  });

  it("throws when the peer hangs up without answering", async () => {
    await listen((_line, socket) => socket.destroy());
    await expect(client().call(FILL)).rejects.toThrow(/without answering/);
  });

  it("throws when the answer is not JSON", async () => {
    await listen((_line, socket) => socket.end("not json\n"));
    await expect(client().call(FILL)).rejects.toThrow(/not JSON/);
  });

  it("gives up rather than hanging when the peer never answers", async () => {
    await listen(() => {
      /* deliberately silent */
    });
    await expect(client(150).call(FILL)).rejects.toThrow(/did not answer within 150ms/);
  });

  it("refuses a peer that floods the connection instead of answering", async () => {
    await listen((_line, socket) => {
      socket.write("x".repeat(200_000));
    });
    await expect(client().call(FILL)).rejects.toThrow(/more than one frame/);
  });
});

describe("whether there is a broker at all", () => {
  it("is absent for a standalone server, which is an ordinary state", () => {
    expect(brokerFromEnv({})).toBeNull();
    expect(brokerFromEnv({ [BROKER_SOCKET_ENV]: "/tmp/x.sock" })).toBeNull();
    expect(brokerFromEnv({ [BROKER_TOKEN_ENV]: "t" })).toBeNull();
  });

  it("is built from the environment the shell forked us with", async () => {
    await listen((_line, socket) => socket.end(encodeFrame({ ok: true, result: 1 })));
    const fromEnv = brokerFromEnv({
      [BROKER_SOCKET_ENV]: socketPath,
      [BROKER_TOKEN_ENV]: "env-token",
    });
    expect(fromEnv).not.toBeNull();
    await fromEnv!.call(FILL);
    expect(received[0]).toMatchObject({ token: "env-token" });
  });
});

describe("the socket path", () => {
  it("is derived from the data root, never supplied by a caller", () => {
    const derived = brokerSocketPath({ dataRoot: "/home/me/.penguin/data", id: "abc123" });
    expect(
      derived === "\\\\.\\pipe\\penguin-broker-abc123" || derived.startsWith("/home/me/"),
    ).toBe(true);
  });
});

describe("parsing, from the side that has to be strict", () => {
  it("accepts each of the two operations", () => {
    expect(parseBrokerRequest(FILL).op).toBe("secure_fill");
    expect(
      parseBrokerRequest({
        op: "request_grant",
        taskId: "t",
        sessionId: "s",
        domain: "ctrip.com",
        purpose: "p",
        fields: ["id_number"],
        mode: "handle",
      }).op,
    ).toBe("request_grant");
  });

  it("refuses anything else, by code", () => {
    expect(() => parseBrokerRequest(null)).toThrow(BrokerProtocolError);
    expect(() => parseBrokerRequest({ op: "read_vault" })).toThrow(/not one of the two/);
    expect(() => parseBrokerRequest({ ...FILL, extra: 1 })).toThrow(/not part of this operation/);
    expect(() => parseBrokerRequest({ ...FILL, taskId: 7 })).toThrow(/taskId/);
    expect(() => parseBrokerRequest({ ...FILL, handle: "310101199001011234" })).toThrow(
      /vault handle/,
    );
  });

  it("caps every string it accepts", () => {
    expect(() => parseBrokerRequest({ ...FILL, selector: "x".repeat(501) })).toThrow(/longer than/);
  });

  it("refuses to encode a frame larger than the channel allows", () => {
    expect(() => encodeFrame({ blob: "x".repeat(70_000) })).toThrow(/larger than the channel/);
  });
});
