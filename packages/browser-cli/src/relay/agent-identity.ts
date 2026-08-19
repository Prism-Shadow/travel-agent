/**
 * Who the browser is working for.
 *
 * The in-app browser attributes every tab to two things: the **conversation** whose strip shows it,
 * and the **task** allowed to write to it. Neither can be guessed from inside this
 * process — the CLI is a child of whatever ran it — so the harness passes them in the environment
 * of every command it spawns, and this reads them back out.
 *
 * The harness sets `PENGUIN_SESSION_ID` and `PENGUIN_TASK_ID` at spawn time from what it actually
 * knows (see core's `CommandSessionManager`), stripping any inherited value of the same names first
 * so a stale one cannot masquerade as the real thing. This module makes the same assumption
 * explicit at the other end: values are shape-checked, and anything that does not look like an id
 * is treated as absent rather than passed along to become an ownership key.
 *
 * There is deliberately **no fallback and no command-line override**. Not the working directory,
 * not the relay session number, not the session id standing in for a task, and not a `--task-id`
 * flag: each would produce tabs that look attributed and are not.
 *
 * The flag is worth spelling out, because it looks harmless. The process that runs this command is
 * *the agent* — a `--task-id` option would let it name any owner it liked, including a task that
 * has ended and whose tabs are now the user's, which is exactly the boundary the environment pair
 * exists to enforce. Core strips any inherited value of these variables and re-injects what it
 * actually knows, after the vault, so the agent cannot reach them from either side. A development
 * harness that needs a specific identity sets the environment, the same way the harness does.
 */

/** Environment variable names, shared with core's spawn path. */
export const SESSION_ID_ENV = 'PENGUIN_SESSION_ID'
export const TASK_ID_ENV = 'PENGUIN_TASK_ID'

export interface AgentIdentity {
  /** The harness Session — one conversation. */
  sessionId: string
  /** The Task within it — one turn. */
  taskId: string
}

/**
 * A conservative id shape.
 *
 * Both ids are opaque to this process; all that matters is that they are short, printable, and
 * free of anything that could be read as structure by something downstream. Deliberately not a
 * pattern mirroring core's exact format — that would couple the two across a package boundary and
 * break the moment core's generator changed — but tight enough that a path, a URL or a shell
 * fragment cannot pass for an id.
 */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

export function isIdentityValue(value: unknown): value is string {
  return typeof value === 'string' && ID_SHAPE.test(value)
}

/**
 * Reads the identity, or returns null when it is not fully present.
 *
 * All or nothing: a session without a task, or a task without a session, is not half an identity
 * but an unusable one — a tab needs both to be placed in a strip and owned by a turn.
 */
export function readAgentIdentity(env: NodeJS.ProcessEnv = process.env): AgentIdentity | null {
  const sessionId = env[SESSION_ID_ENV]
  const taskId = env[TASK_ID_ENV]
  if (!isIdentityValue(sessionId) || !isIdentityValue(taskId)) return null
  return { sessionId, taskId }
}

/** What to tell someone whose invocation has no identity. */
export const MISSING_IDENTITY_MESSAGE =
  'The in-app browser needs to know which conversation and which task a tab belongs to, and this ' +
  `invocation carries neither. The harness sets ${SESSION_ID_ENV} and ${TASK_ID_ENV} in the ` +
  'environment of every command it runs; if they are missing, this command was not started by a ' +
  'task. They are not defaulted, and there is deliberately no command-line override — see the note ' +
  'at the top of this file.'
