/**
 * Who is driving the browser right now, as a state machine rather than a boolean.
 *
 * The naive version is `userControl: boolean`, and it is
 * wrong in two directions at once:
 *
 * - **Handing over is not instantaneous.** At the moment the person takes the page, the executor
 *   may have an `await page.click()` in flight. A boolean flips and that click lands *after* the
 *   handover, on a page somebody else is now using. So there is a `handing_over` state with a hard
 *   deadline, during which writes are refused and the in-flight ones are allowed to drain.
 * - **"The agent is not writing" is not one situation.** In `user_control` the agent is refused;
 *   in `secret_phase` its debugging channel is *gone*, reads included, because the page holds a
 *   value it must not be able to read back. Modelling those as the same state
 *   would have let a read through at the one moment reads are the risk.
 *
 * The machine is a pure reducer: states, events, and a table saying which pairs are legal. Nothing
 * here touches a browser — the browser layer asks `mayWrite`/`mayRead` and refuses accordingly, and
 * the shape of the refusal is the agent's cue to stop rather than retry.
 *
 * **What Phase 3 delivers of `secret_phase`**: the contract and every transition, exercised with
 * synthetic values. The exit conditions are real code paths here; the *detach* they describe is the
 * browser layer's, and filling a real one-time code stays off behind `secret_entry.live` (004
 * Phase 3 non-goals). With the flag off, a `secret_entry` never enters this state at all — the
 * person is asked to type the code themselves, which is the compliant shape, not a degraded one.
 */

import type { InteractionKind } from "./interaction.js";

export type ControlState =
  /** The default, and where a well-designed task spends nearly all of its time. */
  | "agent_control"
  /** Handed over, in-flight writes draining. Bounded by {@link HANDOVER_DRAIN_MS}. */
  | "handing_over"
  /** The person is operating the page. Writes refused; reads still allowed. */
  | "user_control"
  /** A secret is in the page. The agent's channel is detached: writes *and* reads refused. */
  | "secret_phase"
  /** The person handed back; their message is being folded in as steering. */
  | "resuming";

/**
 * How long the agent's in-flight writes get to finish before a handover is complete.
 *
 * Three seconds. Long enough for a click that has already been dispatched, short
 * enough that a person who pressed "take over" does not sit watching a dead button.
 */
export const HANDOVER_DRAIN_MS = 3_000;

/** How a secret phase ended — the three exits, which are not interchangeable. */
export type SecretExit =
  /** The field is provably empty, or gone, or the page navigated away. The channel comes back. */
  | "cleared"
  /** It could not be proven empty. The page stays with the person; the agent does not get it back. */
  | "unproven"
  /** It could not be proven empty and the flow must continue: this target is destroyed. */
  | "target_destroyed";

export type HandoverEvent =
  | {
      type: "request_handover";
      kind: Extract<InteractionKind, "human_challenge" | "browser_takeover">;
      reason?: string;
    }
  | { type: "drained" }
  | { type: "user_returned"; message?: string }
  | { type: "resumed" }
  | { type: "enter_secret_phase"; field: string }
  | { type: "exit_secret_phase"; exit: SecretExit }
  /** The turn ended, the session was reset, the page went away: back to a known state. */
  | { type: "abort" };

export interface HandoverSnapshot {
  state: ControlState;
  /** Set while handed over: which kind took the browser, and why (takeover only). */
  handoverKind?: "human_challenge" | "browser_takeover";
  reason?: string;
  /** Set in `secret_phase`: which field the person is typing. Never the value. */
  secretField?: string;
  /**
   * How the last secret phase ended.
   *
   * Kept after the exit because `unproven` and `target_destroyed` change what the agent may do
   * next: an unproven exit means this page is the person's for good, and the agent asking again
   * has to be answered with that fact rather than with a fresh detach.
   */
  lastSecretExit?: SecretExit;
  /** Free text the person left when handing back, for the host to inject as steering. */
  pendingMessage?: string;
}

export const INITIAL_HANDOVER: HandoverSnapshot = { state: "agent_control" };

/** Whether the agent may perform a write (click, fill, navigate…) in this state. */
export function mayWrite(snapshot: HandoverSnapshot): boolean {
  return snapshot.state === "agent_control";
}

/**
 * Whether the agent may read the page (snapshot, evaluate, screenshot).
 *
 * True everywhere except `secret_phase`, and that exception is the whole reason the state exists:
 * during a handover the agent watching the page is useful — it is how it knows the person finished
 * — while during a secret phase reading *is* the attack.
 */
export function mayRead(snapshot: HandoverSnapshot): boolean {
  return snapshot.state !== "secret_phase";
}

/** A refusal an agent can act on: what is happening, and what it should do about it. */
export interface ControlRefusal {
  code: "IAB_USER_CONTROL" | "IAB_HANDING_OVER" | "IAB_SECRET_PHASE" | "IAB_TARGET_RELEASED";
  message: string;
}

/** The refusal for an operation attempted in a state that does not allow it, or null if it does. */
export function refuseIfNotPermitted(
  snapshot: HandoverSnapshot,
  operation: "read" | "write",
): ControlRefusal | null {
  if (snapshot.state === "secret_phase") {
    return {
      code: "IAB_SECRET_PHASE",
      message:
        `The person is entering a ${snapshot.secretField ?? "one-time code"} for this page and ` +
        `your access to it is suspended — reads included. Wait for it to come back; do not retry ` +
        `in a loop.`,
    };
  }
  if (operation === "read") return null;
  if (snapshot.state === "handing_over") {
    return {
      code: "IAB_HANDING_OVER",
      message:
        "The page is being handed to the person; writes already in flight are finishing. Stop " +
        "writing and wait for them to hand it back.",
    };
  }
  if (snapshot.state === "user_control") {
    return {
      code: "IAB_USER_CONTROL",
      message:
        `The person is operating this page${snapshot.reason ? ` (${snapshot.reason})` : ""}. ` +
        `Reads are fine — watch what they do — but do not write until they hand it back.`,
    };
  }
  if (snapshot.state === "resuming") {
    return {
      code: "IAB_HANDING_OVER",
      message: "The page is coming back to you; the person's message is still being folded in.",
    };
  }
  return null;
}

/** An event that is not legal in the current state, with the reason, for the caller to surface. */
export class HandoverTransitionError extends Error {
  readonly state: ControlState;
  readonly event: HandoverEvent["type"];

  constructor(state: ControlState, event: HandoverEvent["type"], detail: string) {
    super(`Cannot ${event} while ${state}: ${detail}`);
    this.name = "HandoverTransitionError";
    this.state = state;
    this.event = event;
  }
}

/**
 * The transition table, as a function.
 *
 * Illegal pairs throw rather than being ignored. A machine that silently absorbs an impossible
 * event is one whose state stops describing reality — and this state decides whether the agent may
 * write to a page a person is typing a card number into.
 */
export function applyHandoverEvent(
  snapshot: HandoverSnapshot,
  event: HandoverEvent,
): HandoverSnapshot {
  switch (event.type) {
    case "request_handover": {
      if (snapshot.state === "secret_phase") {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          "a secret phase is in progress; it has to exit before the page can be handed over",
        );
      }
      if (snapshot.state !== "agent_control") {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          "the page is already with the person",
        );
      }
      if (event.kind === "browser_takeover" && !event.reason?.trim()) {
        throw new HandoverTransitionError(snapshot.state, event.type, "a takeover needs a reason");
      }
      return {
        state: "handing_over",
        handoverKind: event.kind,
        ...(event.reason?.trim() ? { reason: event.reason } : {}),
        ...(snapshot.lastSecretExit ? { lastSecretExit: snapshot.lastSecretExit } : {}),
      };
    }

    case "drained": {
      if (snapshot.state !== "handing_over") {
        throw new HandoverTransitionError(snapshot.state, event.type, "nothing was draining");
      }
      return { ...snapshot, state: "user_control" };
    }

    case "user_returned": {
      if (snapshot.state !== "user_control") {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          "the person did not have the page",
        );
      }
      return {
        ...snapshot,
        state: "resuming",
        ...(event.message?.trim() ? { pendingMessage: event.message } : {}),
      };
    }

    case "resumed": {
      if (snapshot.state !== "resuming") {
        throw new HandoverTransitionError(snapshot.state, event.type, "nothing was resuming");
      }
      return {
        state: "agent_control",
        ...(snapshot.lastSecretExit ? { lastSecretExit: snapshot.lastSecretExit } : {}),
      };
    }

    case "enter_secret_phase": {
      if (snapshot.state !== "agent_control") {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          "a secret phase starts from agent control; the page is currently elsewhere",
        );
      }
      if (snapshot.lastSecretExit === "unproven") {
        throw new HandoverTransitionError(
          snapshot.state,
          event.type,
          "the previous secret phase could not prove the field was cleared, so this page stays " +
            "with the person (exit b)",
        );
      }
      return { state: "secret_phase", secretField: event.field };
    }

    case "exit_secret_phase": {
      if (snapshot.state !== "secret_phase") {
        throw new HandoverTransitionError(snapshot.state, event.type, "no secret phase to exit");
      }
      // Only a proven-clear exit gives the page back. The other two are the honest outcomes of
      // "we could not show the value is gone", and both keep the agent out — one leaves the page
      // with the person, the other throws the page away.
      if (event.exit === "cleared") {
        return { state: "agent_control", lastSecretExit: "cleared" };
      }
      if (event.exit === "unproven") {
        return { state: "user_control", lastSecretExit: "unproven" };
      }
      return { state: "agent_control", lastSecretExit: "target_destroyed" };
    }

    case "abort":
      return { state: "agent_control" };
  }
}
