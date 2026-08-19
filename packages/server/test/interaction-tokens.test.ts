/**
 * The credential an agent's commands carry, and what it is not.
 *
 * It authenticates *this turn's agent* to *this conversation*, over loopback. It is not a defence
 * against the agent — pre-isolation the agent runtime and the app
 * share a user, so anything the agent can run can read its own environment, and the agent is the
 * intended holder anyway. What is tested here is the part that does hold: another conversation's
 * token is refused, a token whose turn has ended is refused, and between turns the environment
 * carries nothing at all.
 */
import { describe, expect, it } from "vitest";

import {
  interactionCommandEnv,
  InteractionTokens,
  INTERACTION_TOKEN_ENV,
  INTERACTION_URL_ENV,
} from "../src/interaction/tokens.js";

describe("task-scoped tokens", () => {
  it("verifies only for the conversation it was minted for", () => {
    const tokens = new InteractionTokens();
    const minted = tokens.mint("session-a", "task-1");
    expect(tokens.verify("session-a", minted.token)?.taskId).toBe("task-1");
    expect(tokens.verify("session-b", minted.token)).toBeNull();
  });

  it("stops working when the turn ends", () => {
    const tokens = new InteractionTokens();
    const minted = tokens.mint("session-a", "task-1");
    tokens.revoke("session-a");
    expect(tokens.verify("session-a", minted.token)).toBeNull();
  });

  it("invalidates the previous turn's token when a new turn starts", () => {
    // A conversation runs one turn at a time, so minting the next one is also what makes a leaked
    // token from the last one worthless.
    const tokens = new InteractionTokens();
    const first = tokens.mint("session-a", "task-1");
    const second = tokens.mint("session-a", "task-2");
    expect(tokens.verify("session-a", first.token)).toBeNull();
    expect(tokens.verify("session-a", second.token)?.taskId).toBe("task-2");
  });

  it("refuses an empty or wrong-length token without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch; a guess of the wrong length is simply not it.
    const tokens = new InteractionTokens();
    tokens.mint("session-a", "task-1");
    expect(tokens.verify("session-a", "")).toBeNull();
    expect(tokens.verify("session-a", undefined)).toBeNull();
    expect(tokens.verify("session-a", "short")).toBeNull();
  });

  it("mints something a guess will not find", () => {
    const tokens = new InteractionTokens();
    const minted = tokens.mint("session-a", "task-1");
    expect(minted.token.length).toBeGreaterThan(32);
    expect(minted.token).not.toBe(tokens.mint("session-b", "task-2").token);
  });
});

describe("what an agent command's environment carries", () => {
  it("names the loopback address and this turn's token", () => {
    const tokens = new InteractionTokens();
    const minted = tokens.mint("session-a", "task-1");
    const env = interactionCommandEnv({ tokens, port: () => 7364, sessionId: "session-a" });
    expect(env[INTERACTION_URL_ENV]).toBe("http://127.0.0.1:7364");
    expect(env[INTERACTION_TOKEN_ENV]).toBe(minted.token);
  });

  it("reads the port late, because the shell asks for an ephemeral one", () => {
    // `config.port` is rewritten when the server actually binds. A snapshot taken at construction
    // would have built every agent's URL against port 0.
    const tokens = new InteractionTokens();
    tokens.mint("session-a", "task-1");
    let port = 0;
    const env = () => interactionCommandEnv({ tokens, port: () => port, sessionId: "session-a" });
    expect(env()[INTERACTION_URL_ENV]).toBe("http://127.0.0.1:0");
    port = 51234;
    expect(env()[INTERACTION_URL_ENV]).toBe("http://127.0.0.1:51234");
  });

  it("carries nothing between turns", () => {
    // A command still running from an earlier turn must find nothing usable — the same rule the
    // in-app browser applies to tab ownership.
    const tokens = new InteractionTokens();
    tokens.mint("session-a", "task-1");
    tokens.revoke("session-a");
    expect(interactionCommandEnv({ tokens, port: () => 7364, sessionId: "session-a" })).toEqual({});
  });

  it("carries nothing for a command that belongs to no conversation", () => {
    const tokens = new InteractionTokens();
    expect(interactionCommandEnv({ tokens, port: () => 7364 })).toEqual({});
  });
});
