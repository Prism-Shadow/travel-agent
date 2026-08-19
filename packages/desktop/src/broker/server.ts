/**
 * The main process's end of the broker channel.
 *
 * It listens on a Unix domain socket (or a Windows named pipe), and every connection has to prove
 * three separate things before anything happens:
 *
 * 1. **It holds this launch's token.** Minted here, handed to the server child through its fork
 *    environment, never written to disk and never logged. Compared in constant time.
 * 2. **It is asking for one of three named operations, spelled exactly.** Parsing is strict:
 *    unknown operations *and* unknown fields are refused rather than ignored.
 * 3. **It presents a capability, not an identity.** A grant handle or a capability id, which the
 *    handlers re-check against the turn, the domain and the target the call names.
 *
 * The permission model on the socket itself is filesystem-based: the socket is created inside the
 * application's own data directory with mode 0600, so another user cannot connect at all. Node
 * exposes no portable peer-credential API (`SO_PEERCRED` / `getpeereid` are not surfaced), so this
 * implementation does **not** claim a UID check — the file mode is the enforcement, and the token
 * is what distinguishes the forked server from anything else running as the same user. The design is
 * explicit that this last distinction is not a defence against the agent until the isolation
 * decision (D3) lands, and no code here pretends otherwise.
 *
 * Rate limiting is per turn rather than per connection, because a connection is free to make and a
 * turn is the thing a runaway loop belongs to.
 */
import fs from "node:fs";
import net from "node:net";

import {
  BROKER_MAX_FRAME_BYTES,
  BrokerProtocolError,
  encodeFrame,
  parseBrokerRequest,
  type BrokerRequest,
  type BrokerResponse,
} from "@prismshadow/penguin-server/broker-protocol";

/** Timing-safe comparison without importing the whole crypto surface into this file's mental load. */
import { randomBytes, timingSafeEqual } from "node:crypto";

/** How many broker calls one turn may make. A booking needs a handful; a loop needs stopping. */
export const BROKER_CALLS_PER_TASK = 60;

export interface BrokerHandlers {
  request_grant(call: Extract<BrokerRequest, { op: "request_grant" }>): Promise<BrokerResponse>;
  secure_fill(call: Extract<BrokerRequest, { op: "secure_fill" }>): Promise<BrokerResponse>;
  execute_payment(call: Extract<BrokerRequest, { op: "execute_payment" }>): Promise<BrokerResponse>;
}

export interface BrokerServerOptions {
  socketPath: string;
  handlers: BrokerHandlers;
  /** Records every call and every refusal, without values. */
  audit?: (entry: {
    op: string | null;
    taskId?: string;
    sessionId?: string;
    domain?: string;
    outcome: "accepted" | "rejected";
    reason?: string;
  }) => void | Promise<void>;
  /** Injected in tests. */
  token?: string;
  callsPerTask?: number;
  log?: (line: string) => void;
}

export interface BrokerServer {
  /** The token the server child must present. Passed through the fork environment only. */
  readonly token: string;
  readonly socketPath: string;
  close(): Promise<void>;
}

/**
 * Starts the broker.
 *
 * Removes a stale socket file first — a previous run that was killed leaves one behind, and
 * `listen` would otherwise fail with EADDRINUSE on a path nothing is listening to. The unlink is
 * safe because the path is derived from our own data root, not from anything a caller supplies.
 */
export async function startBrokerServer(options: BrokerServerOptions): Promise<BrokerServer> {
  const token = options.token ?? randomBytes(32).toString("base64url");
  const limit = options.callsPerTask ?? BROKER_CALLS_PER_TASK;
  const callsByTask = new Map<string, number>();

  if (process.platform !== "win32") {
    try {
      fs.unlinkSync(options.socketPath);
    } catch {
      // Nothing there, which is the normal case.
    }
  }

  const server = net.createServer((socket) => {
    let buffer = "";
    let handled = false;

    const answer = async (
      response: BrokerResponse,
      audit: Parameters<NonNullable<BrokerServerOptions["audit"]>>[0],
    ): Promise<void> => {
      if (handled) return;
      handled = true;
      try {
        await options.audit?.(audit);
      } catch {
        // An audit sink that fails must not turn a refusal into a hang; the sink reports itself.
      }
      socket.end(encodeFrame(response));
    };

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > BROKER_MAX_FRAME_BYTES) {
        void answer(
          { ok: false, code: "malformed", message: "Frame is larger than the channel allows." },
          { op: null, outcome: "rejected", reason: "oversized frame" },
        );
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      void handleLine(line);
    });

    socket.on("error", () => {
      // A peer that disappears mid-call is ordinary; nothing to clean up beyond the socket itself.
      socket.destroy();
    });

    const handleLine = async (line: string): Promise<void> => {
      let envelope: { token?: unknown; request?: unknown };
      try {
        envelope = JSON.parse(line) as { token?: unknown; request?: unknown };
      } catch {
        await answer(
          { ok: false, code: "malformed", message: "That was not a JSON frame." },
          { op: null, outcome: "rejected", reason: "unparseable frame" },
        );
        return;
      }

      if (typeof envelope.token !== "string" || !sameToken(envelope.token, token)) {
        // Deliberately says nothing about why. A caller without the token learns only that it
        // does not have it.
        await answer(
          {
            ok: false,
            code: "unauthorized",
            message:
              "This channel requires the launch token given to the application's own server.",
          },
          { op: null, outcome: "rejected", reason: "bad or missing token" },
        );
        return;
      }

      let request: BrokerRequest;
      try {
        request = parseBrokerRequest(envelope.request);
      } catch (error) {
        const code = error instanceof BrokerProtocolError ? error.code : "malformed";
        await answer(
          { ok: false, code, message: (error as Error).message },
          { op: null, outcome: "rejected", reason: (error as Error).message.slice(0, 200) },
        );
        return;
      }

      const used = (callsByTask.get(request.taskId) ?? 0) + 1;
      callsByTask.set(request.taskId, used);
      if (used > limit) {
        await answer(
          {
            ok: false,
            code: "rate_limited",
            message:
              `This turn has made ${limit} broker calls, which is well past what a booking ` +
              `needs. Nothing further will be accepted for it.`,
          },
          {
            op: request.op,
            taskId: request.taskId,
            sessionId: request.sessionId,
            domain: request.domain,
            outcome: "rejected",
            reason: "rate limited",
          },
        );
        return;
      }

      try {
        const result = await options.handlers[request.op](request as never);
        await answer(result, {
          op: request.op,
          taskId: request.taskId,
          sessionId: request.sessionId,
          domain: request.domain,
          outcome: result.ok ? "accepted" : "rejected",
          ...(result.ok ? {} : { reason: result.code }),
        });
      } catch (error) {
        options.log?.(`[broker] ${request.op} failed: ${(error as Error).message}\n`);
        await answer(
          {
            ok: false,
            code: "internal",
            message: "The request could not be completed. Nothing was changed.",
          },
          {
            op: request.op,
            taskId: request.taskId,
            outcome: "rejected",
            reason: "handler error",
          },
        );
      }
    };
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  if (process.platform !== "win32") {
    // Belt and braces with the 0700 data directory: another user cannot even open the socket.
    await fs.promises.chmod(options.socketPath, 0o600);
  }

  return {
    token,
    socketPath: options.socketPath,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== "win32") {
        try {
          await fs.promises.unlink(options.socketPath);
        } catch {
          // Already gone.
        }
      }
    },
  };
}

function sameToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
