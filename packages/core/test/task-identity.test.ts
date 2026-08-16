/**
 * Task identity, and how it reaches a command the Agent runs.
 *
 * A Session is a conversation; a Task is one turn of it. Both ids travel into the environment of
 * every command subprocess, because a tool that hands work to another process — the desktop shell's
 * in-app browser, which owns tabs — has nothing else to name the turn by.
 *
 * The tests that matter here are about *spoofing* and *staleness*: an inherited value must not be
 * able to stand in for the real one, a user's vault must not be able to overwrite it, and a command
 * run outside a turn must not carry the previous turn's authority.
 */
import { describe, expect, it } from "vitest";
import { commandChildEnv } from "../src/environment/tools/command/session-manager.js";
import { formatTaskId, isTaskId } from "../src/task-id.js";

type Identity = { sessionId: string; taskId: string } | null;

/** The environment a spawn would use, without starting a process. */
function envFor(identity: Identity, vault: Record<string, string> = {}): NodeJS.ProcessEnv {
  return commandChildEnv({ proxy: null, vault, identity });
}

describe("formatTaskId", () => {
  it("is time-ordered and unique", () => {
    const first = formatTaskId(new Date(1_755_000_000_000));
    const second = formatTaskId(new Date(1_755_000_000_001));
    expect(first).not.toBe(second);
    expect(first < second).toBe(true);
  });

  it("produces something isTaskId recognises", () => {
    expect(isTaskId(formatTaskId())).toBe(true);
  });

  it.each([undefined, null, 42, "", "task", "session-2026-08-15-10-30-00-abc12345", "task-x-y"])(
    "does not recognise %s",
    (value) => {
      expect(isTaskId(value)).toBe(false);
    },
  );
});

describe("the command environment", () => {
  const identity = { sessionId: "session-1", taskId: "task-1755000000000-abcdef01" };

  it("carries the session and task of the turn that spawned it", () => {
    const env = envFor(identity);
    expect(env.PENGUIN_SESSION_ID).toBe(identity.sessionId);
    expect(env.PENGUIN_TASK_ID).toBe(identity.taskId);
  });

  it("sets neither variable between turns", () => {
    // A background command still running from an earlier turn belongs to no task, and must not
    // inherit the last one's authority. Absent rather than blank: a consumer sees "no task", not a
    // task named "".
    const env = envFor(null);
    expect(env.PENGUIN_SESSION_ID).toBeUndefined();
    expect(env.PENGUIN_TASK_ID).toBeUndefined();
  });

  it("strips an inherited value rather than passing it on", () => {
    // A harness running inside another harness, or a command the Agent itself ran and exported
    // from: either way the ambient value is not this turn's, and it decides who owns a browser tab.
    const previous = process.env.PENGUIN_TASK_ID;
    process.env.PENGUIN_TASK_ID = "task-1700000000000-deadbeef";
    try {
      expect(envFor(null).PENGUIN_TASK_ID).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.PENGUIN_TASK_ID;
      else process.env.PENGUIN_TASK_ID = previous;
    }
  });

  it("cannot be overwritten from the vault", () => {
    // The vault is user-editable and wins over host variables by design. It must not win over the
    // harness's own statement of which conversation and turn a command belongs to — that would let
    // a command claim authority over another conversation's browser tabs.
    const env = envFor(identity, {
      PENGUIN_SESSION_ID: "session-someone-else",
      PENGUIN_TASK_ID: "task-forged",
    });
    expect(env.PENGUIN_SESSION_ID).toBe(identity.sessionId);
    expect(env.PENGUIN_TASK_ID).toBe(identity.taskId);
  });

  it("emits both or neither, never half an identity", () => {
    const env = envFor({ sessionId: "session-1", taskId: "" });
    expect(env.PENGUIN_SESSION_ID).toBeUndefined();
    expect(env.PENGUIN_TASK_ID).toBeUndefined();
  });
});

describe("the host's own variables", () => {
  const identity = { sessionId: "session-1", taskId: "task-1755000000000-abcdef01" };

  it("reach the command", () => {
    // What a host uses this for: handing this turn's agent a way to reach its own conversation.
    // The values are the host's to choose; core only guarantees they arrive and cannot be faked.
    const env = commandChildEnv({
      proxy: null,
      vault: {},
      identity,
      hostEnv: { PENGUIN_INTERACTION_URL: "http://127.0.0.1:7364", PENGUIN_INTERACTION_TOKEN: "t" },
    });
    expect(env.PENGUIN_INTERACTION_URL).toBe("http://127.0.0.1:7364");
    expect(env.PENGUIN_INTERACTION_TOKEN).toBe("t");
  });

  it("outrank the vault, which is user-editable", () => {
    // The vault beats ordinary host variables by design. It must not beat a credential the host
    // minted for this turn: that would let a config entry choose which conversation a command can
    // put a card into.
    const env = commandChildEnv({
      proxy: null,
      vault: { PENGUIN_INTERACTION_TOKEN: "forged" },
      identity,
      hostEnv: { PENGUIN_INTERACTION_TOKEN: "real" },
    });
    expect(env.PENGUIN_INTERACTION_TOKEN).toBe("real");
  });

  it("are absent, not inherited, when the host supplies none", () => {
    // Between turns there is no token, and an ambient one — from an outer harness, or exported by
    // a command the Agent itself ran — must not take its place.
    const previous = process.env.PENGUIN_INTERACTION_TOKEN;
    process.env.PENGUIN_INTERACTION_TOKEN = "ambient";
    try {
      const env = commandChildEnv({ proxy: null, vault: {}, identity: null });
      expect(env.PENGUIN_INTERACTION_TOKEN).toBeUndefined();
      expect(env.PENGUIN_INTERACTION_URL).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.PENGUIN_INTERACTION_TOKEN;
      else process.env.PENGUIN_INTERACTION_TOKEN = previous;
    }
  });
});
