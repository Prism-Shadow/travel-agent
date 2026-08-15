/**
 * How the shell starts (src/boot-plan.ts), and the one thing both ways up must agree on.
 *
 * `main.ts` cannot be imported here — importing it starts an Electron app — so the decision it
 * makes lives in its own module and is asserted directly. That separation is not tidiness: the
 * defect this file exists for was a branch in `boot()` that returned before assigning the data
 * root, which does not fail loudly. It silently cancelled **every** download in attached shells,
 * because a download directory is resolved from that root and a null root resolves to nothing.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { planBoot } from "../src/boot-plan.js";
import { resolveSessionDownloadDir } from "../src/session-partition.js";

describe("planBoot", () => {
  it("attaches to a server that is already running for this data root", () => {
    expect(planBoot("/data", { port: 7369 })).toEqual({
      mode: "attach",
      dataRoot: "/data",
      origin: "http://localhost:7369",
    });
  });

  it("spawns when nothing is running, and learns its origin later", () => {
    // Null rather than a guess: the port is not known until the server has bound one.
    expect(planBoot("/data", null)).toEqual({ mode: "spawn", dataRoot: "/data", origin: null });
  });

  it("carries the data root in **both** modes", () => {
    // The regression. The lock that reveals a running server lives inside this root, so an attached
    // server is by construction the server for it — and its Sessions' scratchpads are where this
    // shell's downloads belong.
    for (const existing of [null, { port: 7369 }]) {
      expect(planBoot("/data", existing).dataRoot).toBe("/data");
    }
  });

  it("gives an attached shell somewhere to put a download", () => {
    // Stated as the consequence rather than as the field, because the field is not what broke: an
    // attached shell resolved `null` for every conversation and cancelled the download.
    const plan = planBoot("/data", { port: 7369 });
    expect(
      resolveSessionDownloadDir(plan.dataRoot, {
        projectId: "proj",
        agentId: "default_agent",
        sessionId: "session-1",
      }),
    ).toBe(
      path.join("/data", "proj", "agents", "default_agent", "scratchpad", "session-1", "downloads"),
    );
  });
});
