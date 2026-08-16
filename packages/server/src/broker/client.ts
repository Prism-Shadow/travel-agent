/**
 * The server's end of the broker channel.
 *
 * Thin on purpose. Everything that decides anything — whether a grant covers this field, whether a
 * capability may still be spent — lives in the main process, because that is where the vault and
 * the keychain are. This side connects, presents the token, sends one strictly-shaped request, and
 * returns whatever came back.
 *
 * Two behaviours worth naming:
 *
 * - **Absent is a normal state.** In `penguin web` there is no desktop shell, so there is no
 *   broker, and the tools that depend on it are simply not offered. `available()` is how the
 *   composition layer asks, and the answer is "no" rather than an error at call time.
 * - **A connection per call.** These calls are rare (a fill, a payment) and a long-lived socket
 *   would need reconnect logic, heartbeats and a story for a half-open pipe. The simplest thing
 *   that cannot silently rot is to dial, ask, and hang up.
 */
import net from "node:net";

import {
  BROKER_SOCKET_ENV,
  BROKER_TOKEN_ENV,
  BROKER_MAX_FRAME_BYTES,
  encodeFrame,
  type BrokerRequest,
  type BrokerResponse,
} from "./protocol.js";

/** How long one call may take end to end, including connecting. */
const CALL_TIMEOUT_MS = 30_000;

export interface BrokerClientOptions {
  socketPath: string;
  token: string;
  timeoutMs?: number;
}

export class BrokerClient {
  private readonly socketPath: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: BrokerClientOptions) {
    this.socketPath = options.socketPath;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
  }

  /**
   * Sends one request and resolves with the answer.
   *
   * Never throws for a refusal — those are `{ok: false}` responses the caller reports to the agent.
   * It throws only when the channel itself failed, which is a different situation: the shell is
   * gone, or something is listening that does not speak this protocol.
   */
  async call<T>(request: BrokerRequest): Promise<BrokerResponse<T>> {
    return new Promise<BrokerResponse<T>>((resolve, reject) => {
      const socket = net.createConnection({ path: this.socketPath });
      let buffer = "";
      let settled = false;

      const finish = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        outcome();
      };

      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new Error(`The broker did not answer within ${this.timeoutMs}ms (${request.op}).`),
          ),
        );
      }, this.timeoutMs);
      timer.unref?.();

      socket.on("connect", () => {
        socket.write(encodeFrame({ token: this.token, request }));
      });

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        if (buffer.length > BROKER_MAX_FRAME_BYTES * 2) {
          finish(() => reject(new Error("The broker sent more than one frame's worth of data.")));
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        // Parsed before `finish`, not inside it: a throw from inside the settle callback escapes
        // the socket's data handler as an uncaught exception *and* leaves the promise pending,
        // because the first call has already marked it settled.
        let parsed: BrokerResponse<T>;
        try {
          parsed = JSON.parse(line) as BrokerResponse<T>;
        } catch (error) {
          finish(() =>
            reject(new Error(`The broker's answer was not JSON: ${(error as Error).message}`)),
          );
          return;
        }
        finish(() => resolve(parsed));
      });

      socket.on("error", (error) => {
        finish(() => reject(error));
      });

      socket.on("close", () => {
        finish(() => reject(new Error("The broker closed the connection without answering.")));
      });
    });
  }
}

/**
 * Builds a client from the environment the shell forked this process with, or returns null.
 *
 * Null is the ordinary case for a standalone server: no shell, no vault, no broker. The variables
 * are read once at startup and never logged — the token is a credential, and 003 §4.6 keeps
 * credentials out of every log line.
 */
export function brokerFromEnv(
  env: Record<string, string | undefined> = process.env,
): BrokerClient | null {
  const socketPath = env[BROKER_SOCKET_ENV];
  const token = env[BROKER_TOKEN_ENV];
  if (!socketPath || !token) return null;
  return new BrokerClient({ socketPath, token });
}
