/** Restricted Native Messaging entry. Discovers relays; never accepts executable code. */
import type { Readable, Writable } from "node:stream";
import { liveDesktopRecords } from "penguin-browser/dist/relay/desktop-registry.js";
import {
  TRAVEL_EXTENSION_ID,
  type NativeResponse,
} from "penguin-browser/dist/shared/desktop-connection.js";

export async function nativeResponse(request: unknown, baseDir?: string): Promise<NativeResponse> {
  if (!request || typeof request !== "object") return { protocol: 1, error: "Invalid request" };
  const input = request as { type?: string; installationId?: string };
  if (input.type !== "list" && input.type !== "connect") {
    return { protocol: 1, error: "Unsupported request" };
  }
  const records = await liveDesktopRecords(baseDir);
  if (input.type === "list") {
    return {
      protocol: 1,
      apps: records.map(({ installationId, instanceId, name }) => ({
        installationId,
        instanceId,
        name,
      })),
    };
  }
  const record = records.find((record) => record.installationId === input.installationId);
  if (!record) return { protocol: 1, error: "The paired Travel Agent is not running" };
  const { pid: _pid, ...endpoint } = record;
  return { protocol: 1, endpoint };
}

/** Length-prefixed UTF-8 JSON, with bounded frames and ordered replies. */
export function serveNativeMessages(
  input: Readable,
  output: Writable,
  baseDir?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let queue = Promise.resolve();
    let stopped = false;
    const fail = (error: Error) => {
      stopped = true;
      input.pause();
      reject(error);
    };
    input.on("error", fail);
    output.on("error", fail);
    input.on("data", (chunk: Buffer) => {
      if (stopped) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (length === 0 || length > 64 * 1024) {
          fail(new Error("Invalid native message length"));
          return;
        }
        if (buffer.length < length + 4) break;
        const frame = buffer.subarray(4, 4 + length).toString("utf8");
        buffer = buffer.subarray(4 + length);
        queue = queue.then(async () => {
          let response: NativeResponse;
          try {
            response = await nativeResponse(JSON.parse(frame), baseDir);
          } catch {
            response = { protocol: 1, error: "Unable to read application connections" };
          }
          const body = Buffer.from(JSON.stringify(response));
          const header = Buffer.alloc(4);
          header.writeUInt32LE(body.length);
          await new Promise<void>((done, error) =>
            output.write(Buffer.concat([header, body]), (err) => (err ? error(err) : done())),
          );
        });
        queue.catch(fail);
      }
    });
    input.on("end", () => {
      if (buffer.length) {
        fail(new Error("Incomplete native message"));
        return;
      }
      void queue.then(resolve, reject);
    });
  });
}

export async function runNativeHost(): Promise<void> {
  const origin = `chrome-extension://${TRAVEL_EXTENSION_ID}/`;
  if (!process.argv.includes(origin)) throw new Error("Native host caller is not Travel Browser");
  await serveNativeMessages(process.stdin, process.stdout);
}
