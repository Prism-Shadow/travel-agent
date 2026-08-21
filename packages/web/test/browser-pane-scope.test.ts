/**
 * The conversation-scope gate (src/features/chat/browser-pane-scope.ts).
 *
 * The failure it prevents is specific and visible: the user opens conversation B, React paints B,
 * and for the width of an IPC round trip the browser column beside it is still A — A's tab titles,
 * A's URLs, and a native view still showing one of A's pages over B's chat.
 */
import { describe, expect, it } from "vitest";
import {
  applySessionSwitch,
  browserPaneOpenForRoute,
  isCurrentAnswer,
  isScopeSettled,
} from "../src/features/chat/browser-pane-scope";

describe("browserPaneOpenForRoute", () => {
  it("hides an already-open pane on a draft without changing real Session behavior", () => {
    expect(browserPaneOpenForRoute(true, true)).toBe(false);
    expect(browserPaneOpenForRoute(true, false)).toBe(true);
    expect(browserPaneOpenForRoute(false, false)).toBe(false);
  });
});

describe("isScopeSettled", () => {
  it("is true only when all three agree", () => {
    expect(isScopeSettled({ requested: "A", confirmed: "A", published: "A" })).toBe(true);
  });

  it("is false while the switch is still in flight", () => {
    // Main has not answered for B yet, and is still publishing A.
    expect(isScopeSettled({ requested: "B", confirmed: null, published: "A" })).toBe(false);
  });

  it("is false when main confirmed but is still publishing the old conversation", () => {
    // A state push queued before the switch carries the previous scope *and* the previous tabs.
    // Trusting the confirmation alone would show them.
    expect(isScopeSettled({ requested: "B", confirmed: "B", published: "A" })).toBe(false);
  });

  it("is false when main is publishing the new conversation but has not confirmed it", () => {
    // The other half: without our own confirmation there is no way to tell this push from one that
    // happens to name the right scope for a request that was refused.
    expect(isScopeSettled({ requested: "B", confirmed: null, published: "B" })).toBe(false);
  });

  it("is false when the confirmation names a conversation we have left", () => {
    expect(isScopeSettled({ requested: "B", confirmed: "A", published: "A" })).toBe(false);
  });

  it("is false with no conversation open", () => {
    // The session list. There is no strip to show.
    expect(isScopeSettled({ requested: null, confirmed: null, published: null })).toBe(false);
    expect(isScopeSettled({ requested: null, confirmed: "A", published: "A" })).toBe(false);
  });

  it("is false when main refused the switch", () => {
    // A rejected `setSession` leaves the confirmation null, which keeps everything hidden. Failing
    // closed is the point.
    expect(isScopeSettled({ requested: "B", confirmed: null, published: null })).toBe(false);
  });
});

describe("isCurrentAnswer", () => {
  it("accepts the answer to the request in flight", () => {
    expect(isCurrentAnswer(3, 3)).toBe(true);
  });

  it("rejects an answer overtaken by a later switch", () => {
    // Two route changes in quick succession can settle out of order. The earlier answer names the
    // conversation the user has already left, and taking it would unlock the strip for the wrong
    // one — which is exactly the frame where A's tabs appear in B.
    expect(isCurrentAnswer(2, 3)).toBe(false);
  });

  it("rejects an answer from the future, which would mean a counter bug", () => {
    expect(isCurrentAnswer(4, 3)).toBe(false);
  });
});

describe("applySessionSwitch", () => {
  /** A bridge that records what main was told, and in which order. */
  function recorder(options: { hides?: boolean } = {}) {
    const order: string[] = [];
    return {
      order,
      hide: () => {
        order.push("hide");
        return options.hides !== false;
      },
      announce: async (sessionId: string | null) => {
        order.push(`announce:${sessionId}`);
        return sessionId;
      },
    };
  }

  it("hides before it returns, and announces only after", async () => {
    // The ordering the pane's privacy depends on. The hide is synchronous because this runs inside
    // the commit that changed the route: an asynchronous one would only have been *started* when
    // the new conversation paints, and the previous conversation's page is composited above it.
    const bridge = recorder();
    const switching = applySessionSwitch({
      hide: bridge.hide,
      announce: bridge.announce,
      sessionId: "B",
      isCurrent: () => true,
    });

    // Before anything is awaited — before this test yields to the microtask queue at all — the
    // view is already hidden. That is the property the frame depends on; the announcement's own
    // timing is beside the point.
    expect(bridge.order[0]).toBe("hide");

    await expect(switching).resolves.toBe("B");
    expect(bridge.order).toEqual(["hide", "announce:B"]);
  });

  it("announces but confirms nothing when main did not hide the view", async () => {
    // A window tearing down, a refused channel. The view may still be painting the conversation
    // the user just left, so unlocking the strip must not happen — but main must still learn
    // which conversation the renderer shows, or its active scope goes stale for every later
    // decision (the one-behind pattern of issue 0008: skipped announces leave the pane exactly
    // one conversation behind reality).
    const bridge = recorder({ hides: false });
    await expect(
      applySessionSwitch({
        hide: bridge.hide,
        announce: bridge.announce,
        sessionId: "B",
        isCurrent: () => true,
      }),
    ).resolves.toBeNull();
    expect(bridge.order).toEqual(["hide", "announce:B"]);
  });

  it("announces but confirms nothing when the hide throws", async () => {
    let announced = false;
    await expect(
      applySessionSwitch({
        hide: () => {
          throw new Error("window gone");
        },
        announce: async () => {
          announced = true;
          return "B";
        },
        sessionId: "B",
        isCurrent: () => true,
      }),
    ).resolves.toBeNull();
    expect(announced).toBe(true);
  });

  it("does not announce a conversation the user has already left", async () => {
    const bridge = recorder();
    await expect(
      applySessionSwitch({
        hide: bridge.hide,
        announce: bridge.announce,
        sessionId: "B",
        isCurrent: () => false,
      }),
    ).resolves.toBeNull();
    // Hidden anyway — that part is unconditional, and hiding is always safe.
    expect(bridge.order).toEqual(["hide"]);
  });

  it("discards an answer overtaken while it was in flight", async () => {
    let current = true;
    await expect(
      applySessionSwitch({
        hide: () => true,
        announce: async () => {
          current = false;
          return "B";
        },
        sessionId: "B",
        isCurrent: () => current,
      }),
    ).resolves.toBeNull();
  });

  it("confirms nothing when main refuses the announcement", async () => {
    await expect(
      applySessionSwitch({
        hide: () => true,
        announce: async () => {
          throw new Error("no window");
        },
        sessionId: "B",
        isCurrent: () => true,
      }),
    ).resolves.toBeNull();
  });

  it("forgets the last bounds once the view is hidden", async () => {
    // The hook skips a `setBounds` identical to the one it last sent. Without this the pane would
    // measure the same rectangle after the switch, decide nothing had changed, and never ask main
    // to show the view again.
    let forgotten = false;
    await applySessionSwitch({
      hide: () => true,
      announce: async (id) => id,
      sessionId: "B",
      isCurrent: () => true,
      onHidden: () => {
        forgotten = true;
      },
    });
    expect(forgotten).toBe(true);
  });

  it("does not forget the bounds when the hide failed", async () => {
    let forgotten = false;
    await applySessionSwitch({
      hide: () => false,
      announce: async (id) => id,
      sessionId: "B",
      isCurrent: () => true,
      onHidden: () => {
        forgotten = true;
      },
    });
    expect(forgotten).toBe(false);
  });
});
