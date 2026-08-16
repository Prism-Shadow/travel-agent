/**
 * The credential an agent's own commands use to ask its conversation a question.
 *
 * The agent runs as a subprocess. It already carries `PENGUIN_SESSION_ID` and `PENGUIN_TASK_ID`,
 * which say *who it is acting for*; neither is a secret, and neither should be — they are read by
 * the desktop shell, written into traces, and guessing one buys nothing. Posting a card into
 * somebody's conversation is different: it puts words in front of a person and asks them to act on
 * them, so it needs proof that the caller is this turn's agent rather than anything else that can
 * reach the port.
 *
 * Hence one short-lived token per **task**:
 *
 * - minted when the turn starts, revoked when it ends, so a command that outlives its turn cannot
 *   raise a card under a task nobody is running (the same rule Phase 2 applied to browser tabs);
 * - bound to its session *and* its task, checked on every call, so a token from another
 *   conversation is not merely useless but rejected;
 * - never logged, never published over SSE, never written to a trace — it goes into the child
 *   environment and nowhere else.
 *
 * What this does **not** claim: protection from the agent itself, or from anything that can read
 * the agent's environment. Design/003 §0.3 is explicit that pre-isolation the agent runtime and the
 * app share a user, so a token in its environment is readable by anything that user can run. The
 * agent is the intended holder here, so that is not a downgrade — but it is the reason this is a
 * task-scoped capability rather than a standing credential, and the reason the UI treats a card as
 * "your agent is asking", never as an authenticated statement from somewhere trustworthy.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

/** Environment variable names the agent's commands read. Stripped from any inherited value. */
export const INTERACTION_URL_ENV = "PENGUIN_INTERACTION_URL";
export const INTERACTION_TOKEN_ENV = "PENGUIN_INTERACTION_TOKEN";

export interface TaskToken {
  sessionId: string;
  taskId: string;
  token: string;
}

/**
 * Task-scoped tokens, one per running turn.
 *
 * Keyed by session because a session runs one turn at a time: minting a second replaces the first,
 * which is also what makes a leaked token from an earlier turn worthless.
 */
export class InteractionTokens {
  private readonly bySession = new Map<string, TaskToken>();

  /** Mints (or replaces) the token for a turn and returns it. */
  mint(sessionId: string, taskId: string): TaskToken {
    const entry: TaskToken = { sessionId, taskId, token: randomBytes(32).toString("base64url") };
    this.bySession.set(sessionId, entry);
    return entry;
  }

  /** The token for a session's current turn, or null between turns. */
  current(sessionId: string): TaskToken | null {
    return this.bySession.get(sessionId) ?? null;
  }

  /** Called when the turn ends. After this the token authenticates nothing. */
  revoke(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  /**
   * Resolves a bearer token to the turn it belongs to, or null.
   *
   * Compared in constant time and only against the *current* turn of the session it names. The
   * length guard is not a shortcut around that: `timingSafeEqual` throws on a length mismatch, and
   * a token of the wrong length is already not this one.
   */
  verify(sessionId: string, token: string | undefined): TaskToken | null {
    const entry = this.bySession.get(sessionId);
    if (!entry || !token) return null;
    const provided = Buffer.from(token, "utf8");
    const expected = Buffer.from(entry.token, "utf8");
    if (provided.length !== expected.length) return null;
    return timingSafeEqual(provided, expected) ? entry : null;
  }
}

/**
 * The environment an agent's commands are spawned with, for one Session.
 *
 * A function of the *current* turn, evaluated at spawn: between turns there is no token and the
 * variables are absent rather than blank, so a command still running from an earlier turn finds
 * nothing usable. The address is loopback because the agent runs on this machine as a child of this
 * process, and the port is read late — the desktop shell asks for an ephemeral one, and the real
 * value is only known once the server is listening.
 */
export function interactionCommandEnv(input: {
  tokens: InteractionTokens;
  port: () => number;
  sessionId?: string;
}): Record<string, string> {
  if (!input.sessionId) return {};
  const token = input.tokens.current(input.sessionId);
  if (!token) return {};
  return {
    [INTERACTION_URL_ENV]: `http://127.0.0.1:${input.port()}`,
    [INTERACTION_TOKEN_ENV]: token.token,
  };
}
