/**
 * How the end-to-end runner reads a finished Electron process.
 *
 * Split out of the runner so it can be tested: the branch that matters is the one that almost never
 * happens, and the failure mode is silent. Electron can print every step and *then* die — a crash
 * during teardown, an unhandled rejection after the last assertion, a signal from the harness's own
 * timeout — and a runner that only inspects the printed steps would call that a pass. In CI that is
 * a gate going green on a process that failed.
 */

/** Longest slice of stderr worth attaching to a failure message. */
const STDERR_EXCERPT = 2000;

/**
 * Redacts anything that looks like a secret before it reaches a log.
 *
 * The harness mints a per-run `/iab` key and passes it in a WebSocket URL, so a stack trace or a
 * connection error can carry it. CI logs are frequently public; the key is short-lived but there is
 * no reason to publish it.
 */
export function redactSecrets(text) {
  return String(text ?? "")
    .replace(/([?&](?:key|token|secret)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/\be2e-[a-z0-9]{6,}\b/gi, "[redacted]");
}

/**
 * Decides whether the process itself succeeded, before any step is examined.
 *
 * Returns `{ ok: true }` or `{ ok: false, message }`. Three distinct failures, kept distinct
 * because they point at different things: a launch that never happened, a signal (usually the
 * harness timeout or a crash), and a non-zero exit.
 */
export function checkExitStatus({ error, status, signal, stderr }) {
  const tail = redactSecrets(stderr).slice(-STDERR_EXCERPT).trim();
  const detail = tail ? `\n--- stderr (tail) ---\n${tail}` : "";

  if (error) {
    return {
      ok: false,
      message: `could not launch electron: ${redactSecrets(error.message)}${detail}`,
    };
  }
  if (signal) {
    return {
      ok: false,
      message: `electron was terminated by ${signal} (status ${String(status)})${detail}`,
    };
  }
  if (status !== 0) {
    return {
      ok: false,
      message:
        `electron exited with status ${String(status)}. Every step may still have printed — a ` +
        `crash on teardown looks exactly like a pass if only the steps are read.${detail}`,
    };
  }
  return { ok: true };
}
