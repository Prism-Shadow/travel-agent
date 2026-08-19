/**
 * Task identity.
 *
 * A Session is a conversation; a **Task** is one turn of it — one `Session.run` call, from the
 * user's message to the agent finishing or being aborted. Until now nothing named that unit: the
 * server tracked an in-flight run as a status flag and an `AbortController`, and the only id below
 * the Agent was the Session's. That was enough while nothing outside the process needed to refer to
 * a turn.
 *
 * The in-app browser needs to. A tab is opened *by a task* and must stop being writable when that
 * task ends, while remaining visible in the conversation it belongs to. Those are
 * two different lifetimes, so they need two different identifiers, and the task one has to be real:
 * a constant, the working directory, or the session id standing in for a task would each make
 * "which task owns this tab" unanswerable the moment a second turn ran.
 *
 * The id is minted where a task is *accepted* — by the server for queued and immediate work alike,
 * so the id exists before the run starts and can be handed back to the caller. A standalone core
 * embedder that runs a Session directly gets one minted here instead; what must never happen is a
 * task running without one.
 */
import { randomUUID } from "node:crypto";

/**
 * A new task id: `task-<ms>-<8 hex>`.
 *
 * Time-ordered so a log or a checkpoint sorts sensibly, and random-suffixed because two tasks can
 * be accepted in the same millisecond across sessions. Opaque to every consumer — nothing parses
 * it, and nothing may infer ordering across processes from it.
 */
export function formatTaskId(now: Date = new Date()): string {
  const hex = randomUUID().replace(/-/g, "").slice(0, 8);
  return `task-${now.getTime()}-${hex}`;
}

/**
 * Whether a string is shaped like something we minted.
 *
 * Used at the process boundaries the id crosses — the child-process environment, the relay's HTTP
 * body — where it arrives as untrusted text and ends up as an ownership key. Deliberately a shape
 * check rather than a registry lookup: the browser side has no way to ask the harness whether a
 * task exists, and a strict character set is what keeps an id from carrying anything else.
 */
export function isTaskId(value: unknown): value is string {
  return typeof value === "string" && /^task-\d{1,15}-[0-9a-f]{8}$/.test(value);
}
