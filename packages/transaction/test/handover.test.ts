/**
 * The control-handover machine (src/handover.ts).
 *
 * What is asserted here is mostly *refusals*: which events are illegal in which state, and which
 * states let the agent write. Those are the properties the browser layer leans on when it decides
 * whether to let a click through while somebody is typing a card number.
 */
import { describe, expect, it } from "vitest";

import {
  applyHandoverEvent,
  mayRead,
  mayWrite,
  refuseIfNotPermitted,
  HandoverTransitionError,
  INITIAL_HANDOVER,
  type HandoverSnapshot,
} from "../src/handover.js";

const start = (): HandoverSnapshot => ({ ...INITIAL_HANDOVER });

/** Drives the machine through a list of events, so a test can read as the sequence it describes. */
function run(events: Parameters<typeof applyHandoverEvent>[1][]): HandoverSnapshot {
  return events.reduce(applyHandoverEvent, start());
}

describe("the ordinary handover", () => {
  it("drains before the person gets the page", () => {
    // The state exists because a `page.click()` may already be in flight when the button is
    // pressed. Going straight to user_control would let that click land on a page somebody else
    // is now using.
    const handing = applyHandoverEvent(start(), {
      type: "request_handover",
      kind: "human_challenge",
    });
    expect(handing.state).toBe("handing_over");
    expect(mayWrite(handing)).toBe(false);
    expect(mayRead(handing)).toBe(true);

    const held = applyHandoverEvent(handing, { type: "drained" });
    expect(held.state).toBe("user_control");
  });

  it("comes back through resuming, carrying what the person said", () => {
    const resumed = run([
      { type: "request_handover", kind: "human_challenge" },
      { type: "drained" },
      { type: "user_returned", message: "验证码输好了，顺便看看更早的班次" },
    ]);
    expect(resumed.state).toBe("resuming");
    expect(resumed.pendingMessage).toMatch(/更早的班次/);
    expect(mayWrite(resumed)).toBe(false);

    const back = applyHandoverEvent(resumed, { type: "resumed" });
    expect(back.state).toBe("agent_control");
    expect(mayWrite(back)).toBe(true);
    expect(back.pendingMessage).toBeUndefined();
  });

  it("refuses a takeover with no reason", () => {
    expect(() =>
      applyHandoverEvent(start(), { type: "request_handover", kind: "browser_takeover" }),
    ).toThrow(HandoverTransitionError);
  });

  it("keeps the takeover reason where a refusal can quote it", () => {
    const held = run([
      {
        type: "request_handover",
        kind: "browser_takeover",
        reason: "站点用自绘控件，没有可自动化的元素",
      },
      { type: "drained" },
    ]);
    const refusal = refuseIfNotPermitted(held, "write");
    expect(refusal?.code).toBe("IAB_USER_CONTROL");
    expect(refusal?.message).toContain("自绘控件");
  });

  it("refuses to hand over twice", () => {
    const held = run([{ type: "request_handover", kind: "human_challenge" }, { type: "drained" }]);
    expect(() =>
      applyHandoverEvent(held, { type: "request_handover", kind: "human_challenge" }),
    ).toThrow(/already with the person/);
  });

  it("refuses events that belong to another state", () => {
    expect(() => applyHandoverEvent(start(), { type: "drained" })).toThrow(HandoverTransitionError);
    expect(() => applyHandoverEvent(start(), { type: "user_returned" })).toThrow(
      HandoverTransitionError,
    );
    expect(() => applyHandoverEvent(start(), { type: "resumed" })).toThrow(HandoverTransitionError);
  });

  it("returns to a known state on abort, from anywhere", () => {
    // A turn ending, a session reset, a page going away. Whatever was in progress, the machine has
    // to be somewhere describable afterwards.
    for (const snapshot of [
      run([{ type: "request_handover", kind: "human_challenge" }]),
      run([{ type: "request_handover", kind: "human_challenge" }, { type: "drained" }]),
      run([{ type: "enter_secret_phase", field: "otp" }]),
    ]) {
      expect(applyHandoverEvent(snapshot, { type: "abort" }).state).toBe("agent_control");
    }
  });
});

describe("the secret phase", () => {
  it("takes reads away too, which is the whole difference from user_control", () => {
    // In user_control the agent watching the page is useful. In a secret phase reading *is* the
    // attack (003 §1.3): the value is in the DOM and `page.evaluate` would return it.
    const secret = applyHandoverEvent(start(), { type: "enter_secret_phase", field: "cvv" });
    expect(secret.state).toBe("secret_phase");
    expect(mayWrite(secret)).toBe(false);
    expect(mayRead(secret)).toBe(false);
    expect(refuseIfNotPermitted(secret, "read")?.code).toBe("IAB_SECRET_PHASE");
    expect(refuseIfNotPermitted(secret, "write")?.code).toBe("IAB_SECRET_PHASE");
  });

  it("gives the page back only when the field is proven clear", () => {
    const cleared = run([
      { type: "enter_secret_phase", field: "otp" },
      { type: "exit_secret_phase", exit: "cleared" },
    ]);
    expect(cleared.state).toBe("agent_control");
    expect(mayRead(cleared)).toBe(true);
  });

  it("leaves the page with the person when it cannot be proven", () => {
    // Exit (b) of 003 §7.3. Not an error state — a decision: we could not show the value is gone,
    // so the agent does not get this page back.
    const unproven = run([
      { type: "enter_secret_phase", field: "cvv" },
      { type: "exit_secret_phase", exit: "unproven" },
    ]);
    expect(unproven.state).toBe("user_control");
    expect(unproven.lastSecretExit).toBe("unproven");
  });

  it("refuses a second secret phase after an unproven exit", () => {
    // Asking again would be asking to detach and re-attach to a page still holding the value.
    const unproven = run([
      { type: "enter_secret_phase", field: "cvv" },
      { type: "exit_secret_phase", exit: "unproven" },
      { type: "user_returned" },
      { type: "resumed" },
    ]);
    expect(unproven.state).toBe("agent_control");
    expect(() =>
      applyHandoverEvent(unproven, { type: "enter_secret_phase", field: "cvv" }),
    ).toThrow(/could not prove/);
  });

  it("comes back to agent control when the target was destroyed instead", () => {
    // Exit (c): the page is thrown away and the flow continues on a new one, so the agent is not
    // being handed a page that still holds the value.
    const destroyed = run([
      { type: "enter_secret_phase", field: "otp" },
      { type: "exit_secret_phase", exit: "target_destroyed" },
    ]);
    expect(destroyed.state).toBe("agent_control");
    expect(destroyed.lastSecretExit).toBe("target_destroyed");
  });

  it("cannot start while the person has the page, and cannot be handed over out of", () => {
    const held = run([{ type: "request_handover", kind: "human_challenge" }, { type: "drained" }]);
    expect(() => applyHandoverEvent(held, { type: "enter_secret_phase", field: "otp" })).toThrow(
      HandoverTransitionError,
    );

    const secret = run([{ type: "enter_secret_phase", field: "otp" }]);
    expect(() =>
      applyHandoverEvent(secret, {
        type: "request_handover",
        kind: "browser_takeover",
        reason: "x",
      }),
    ).toThrow(/secret phase is in progress/);
  });
});

describe("refusals the agent reads", () => {
  it("says what is happening and what to do instead", () => {
    const handing = run([{ type: "request_handover", kind: "human_challenge" }]);
    expect(refuseIfNotPermitted(handing, "write")?.code).toBe("IAB_HANDING_OVER");
    // Reads stay open during a handover: watching the page is how the agent knows they finished.
    expect(refuseIfNotPermitted(handing, "read")).toBeNull();
    expect(refuseIfNotPermitted(start(), "write")).toBeNull();
  });
});
