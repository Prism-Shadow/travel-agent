/**
 * The pane↔vault target adapter, at its edges.
 *
 * The happy path is one line; the value is in what it does when a tab has gone. A resolver that
 * returned a stale debugger for a closed tab, or quietly "detached" an agent channel from a target
 * that no longer exists, would turn a lost race into either a crash or a false sense that the
 * secret phase had taken hold. Both are checked here.
 */
import { describe, expect, it, vi } from "vitest";

import {
  paneTargetResolver,
  type ContentsLike,
  type PaneLike,
} from "../src/vault/pane-target-resolver.js";

function fakeContents(url = "https://ctrip.com/pay"): ContentsLike & { destroyed: boolean } {
  const state = {
    destroyed: false,
    getURL: () => url,
    isDestroyed: () => state.destroyed,
    debugger: {
      attached: false,
      attach: vi.fn(function (this: unknown) {
        state.debugger.attached = true;
      }),
      detach: vi.fn(function () {
        state.debugger.attached = false;
      }),
      isAttached: () => state.debugger.attached,
      sendCommand: vi.fn(async () => ({})),
    },
  };
  return state as unknown as ContentsLike & { destroyed: boolean };
}

function fakePane(contents: (ContentsLike & { destroyed: boolean }) | null): PaneLike & {
  drivable: Map<string, boolean>;
  closed: string[];
} {
  const drivable = new Map<string, boolean>([["T-1", true]]);
  const closed: string[] = [];
  return {
    drivable,
    closed,
    contentsForTarget: (targetId) => (targetId === "T-1" ? contents : null),
    closeTarget: async (targetId) => {
      closed.push(targetId);
    },
    setAgentDrivable: ({ targetId, drivable: next }) => {
      if (!drivable.has(targetId)) return false;
      drivable.set(targetId, next);
      return true;
    },
  };
}

describe("resolving a target", () => {
  it("wraps the tab's debugger and reports its URL", () => {
    const contents = fakeContents();
    const resolver = paneTargetResolver(fakePane(contents));
    expect(resolver.urlOf("T-1")).toBe("https://ctrip.com/pay");
    const dbg = resolver.debuggerFor("T-1");
    expect(dbg).not.toBeNull();
    dbg!.attach("1.3");
    expect(contents.debugger.isAttached()).toBe(true);
  });

  it("returns nothing for a target the pane does not know", () => {
    const resolver = paneTargetResolver(fakePane(fakeContents()));
    expect(resolver.debuggerFor("T-gone")).toBeNull();
    expect(resolver.urlOf("T-gone")).toBeNull();
  });

  it("returns nothing for a tab that has been destroyed since", () => {
    const contents = fakeContents();
    contents.destroyed = true;
    const resolver = paneTargetResolver(fakePane(contents));
    expect(resolver.debuggerFor("T-1")).toBeNull();
    expect(resolver.urlOf("T-1")).toBeNull();
  });
});

describe("the agent's channel", () => {
  it("revokes drivability on secret-phase enter, and restores it on exit", async () => {
    const pane = fakePane(fakeContents());
    const resolver = paneTargetResolver(pane);
    await resolver.detachAgent({ targetId: "T-1", sessionId: "s-1" });
    expect(pane.drivable.get("T-1")).toBe(false);
    await resolver.attachAgent({ targetId: "T-1", sessionId: "s-1" });
    expect(pane.drivable.get("T-1")).toBe(true);
  });

  it("fails closed when the target to detach is already gone", async () => {
    // The phase must not believe it detached something that does not exist.
    const resolver = paneTargetResolver(fakePane(fakeContents()));
    await expect(resolver.detachAgent({ targetId: "T-gone", sessionId: "s-1" })).rejects.toThrow(
      /gone/,
    );
  });

  it("does not throw trying to reattach to a target that vanished", async () => {
    const resolver = paneTargetResolver(fakePane(fakeContents()));
    await expect(
      resolver.attachAgent({ targetId: "T-gone", sessionId: "s-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("destroying a target", () => {
  it("asks the pane to close the tab", async () => {
    const pane = fakePane(fakeContents());
    await paneTargetResolver(pane).destroy("T-1");
    expect(pane.closed).toEqual(["T-1"]);
  });
});
