/**
 * The debugger fill port, against a fake CDP session that behaves like the real one.
 *
 * What matters here is the *shape of the write path*: the fill runs in an isolated world (never
 * the page's own context), the value travels as a call argument (never interpolated into script
 * source, where it would sit in any CDP log that records `functionDeclaration`), and a session
 * that was already attached — a secret phase holding it — is not detached out from under it.
 */
import { describe, expect, it, vi } from "vitest";

import {
  DebuggerFillPort,
  type DebuggerLike,
  type TargetResolver,
} from "../src/vault/debugger-fill-port.js";

const ID_NUMBER = "310101199001011234";

function fakeSession(options: { fillResult?: unknown; throwOn?: string } = {}) {
  let attached = false;
  const commands: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const session: DebuggerLike = {
    attach: vi.fn(() => {
      attached = true;
    }),
    detach: vi.fn(() => {
      attached = false;
    }),
    isAttached: () => attached,
    sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      commands.push({ method, ...(params ? { params } : {}) });
      if (options.throwOn === method) throw new Error(`${method} failed`);
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "frame-1" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: options.fillResult ?? {
              filled: true,
              box: { x: 1, y: 2, width: 100, height: 20 },
            },
          },
        };
      }
      return {};
    }),
  };
  return { session, commands, attachedNow: () => attached };
}

function resolverWith(session: DebuggerLike | null): TargetResolver {
  return {
    debuggerFor: () => session,
    urlOf: () => "https://ctrip.com/booking",
    destroy: vi.fn(async () => {}),
    detachAgent: vi.fn(async () => {}),
    attachAgent: vi.fn(async () => {}),
  };
}

describe("the write path", () => {
  it("fills through an isolated world, and hands back where the element is", async () => {
    const { session, commands } = fakeSession();
    const port = new DebuggerFillPort(resolverWith(session));

    const outcome = await port.fillField({ targetId: "T-1", selector: "#id", value: ID_NUMBER });
    expect(outcome).toEqual({ filled: true, box: { x: 1, y: 2, width: 100, height: 20 } });

    const world = commands.find((entry) => entry.method === "Page.createIsolatedWorld");
    expect(world?.params).toMatchObject({ worldName: "penguin-vault", frameId: "frame-1" });
    const call = commands.find((entry) => entry.method === "Runtime.callFunctionOn");
    expect(call?.params).toMatchObject({ executionContextId: 7, returnByValue: true });
  });

  it("passes the value as a call argument, never inside the script source", async () => {
    // `functionDeclaration` is what CDP logging records; the value must not be in it.
    const { session, commands } = fakeSession();
    await new DebuggerFillPort(resolverWith(session)).fillField({
      targetId: "T-1",
      selector: "#id",
      value: ID_NUMBER,
    });
    const call = commands.find((entry) => entry.method === "Runtime.callFunctionOn")!;
    expect(String(call.params?.["functionDeclaration"])).not.toContain(ID_NUMBER);
    expect(call.params?.["arguments"]).toEqual([{ value: "#id" }, { value: ID_NUMBER }]);
  });

  it("dispatches the events a framework needs, via the native setter", async () => {
    const { session, commands } = fakeSession();
    await new DebuggerFillPort(resolverWith(session)).fillField({
      targetId: "T-1",
      selector: "#id",
      value: "x",
    });
    const declaration = String(
      commands.find((entry) => entry.method === "Runtime.callFunctionOn")!.params?.[
        "functionDeclaration"
      ],
    );
    expect(declaration).toContain("getOwnPropertyDescriptor");
    expect(declaration).toContain('new Event("input"');
    expect(declaration).toContain('new Event("change"');
  });

  it("attaches for the call and detaches after — but never tears down a held session", async () => {
    const held = fakeSession();
    held.session.attach("1.3"); // a secret phase is holding the attachment
    const port = new DebuggerFillPort(resolverWith(held.session));
    await port.fillField({ targetId: "T-1", selector: "#id", value: "x" });
    expect(held.attachedNow()).toBe(true);

    const fresh = fakeSession();
    await new DebuggerFillPort(resolverWith(fresh.session)).fillField({
      targetId: "T-1",
      selector: "#id",
      value: "x",
    });
    expect(fresh.attachedNow()).toBe(false);
  });

  it("reports a missing tab as an unfilled result, not an exception", async () => {
    const port = new DebuggerFillPort(resolverWith(null));
    expect(await port.fillField({ targetId: "T-gone", selector: "#id", value: "x" })).toEqual({
      filled: false,
    });
    expect(await port.hasField({ targetId: "T-gone", selector: "#id" })).toBe(false);
    expect(await port.readField({ targetId: "T-gone", selector: "#id" })).toBeNull();
  });

  it("reports a page that refuses the call as unfilled", async () => {
    const { session } = fakeSession({ throwOn: "Page.createIsolatedWorld" });
    const port = new DebuggerFillPort(resolverWith(session));
    await expect(
      port.fillField({ targetId: "T-1", selector: "#id", value: "x" }),
    ).rejects.toThrow();
  });
});

describe("reading back, for the secret phase's proof", () => {
  it("distinguishes an empty field from a missing one", async () => {
    const present = fakeSession({ fillResult: { present: true, value: "" } });
    const port = new DebuggerFillPort(resolverWith(present.session));
    expect(await port.readField({ targetId: "T-1", selector: "#otp" })).toBe("");
    expect(await port.hasField({ targetId: "T-1", selector: "#otp" })).toBe(true);

    const gone = fakeSession({ fillResult: { present: false, value: null } });
    const port2 = new DebuggerFillPort(resolverWith(gone.session));
    expect(await port2.readField({ targetId: "T-1", selector: "#otp" })).toBeNull();
    expect(await port2.hasField({ targetId: "T-1", selector: "#otp" })).toBe(false);
  });

  it("delegates the agent's channel and the target's fate to the resolver", async () => {
    const resolver = resolverWith(fakeSession().session);
    const port = new DebuggerFillPort(resolver);
    await port.detachAgent({ targetId: "T-1", sessionId: "s-1" });
    await port.attachAgent({ targetId: "T-1", sessionId: "s-1" });
    await port.destroyTarget({ targetId: "T-1" });
    expect(resolver.detachAgent).toHaveBeenCalledTimes(1);
    expect(resolver.attachAgent).toHaveBeenCalledTimes(1);
    expect(resolver.destroy).toHaveBeenCalledWith("T-1");
  });

  it("refreshes the current viewport box without reading the field value", async () => {
    const current = { x: 44, y: 55, width: 210, height: 31 };
    const located = fakeSession({ fillResult: current });
    const port = new DebuggerFillPort(resolverWith(located.session));

    expect(await port.locateField({ targetId: "T-1", selector: "#id" })).toEqual(current);
    const call = located.commands.find((entry) => entry.method === "Runtime.callFunctionOn")!;
    expect(call.params?.["arguments"]).toEqual([{ value: "#id" }]);
    expect(String(call.params?.["functionDeclaration"])).toContain("getBoundingClientRect");
    expect(String(call.params?.["functionDeclaration"])).not.toContain("element.value");
  });
});
