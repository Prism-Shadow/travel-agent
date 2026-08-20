/**
 * Startup-chatter separation for command sessions.
 *
 * POSIX-style sessions run `bash -lc <cmd>`: a login shell sources the user's profile before
 * the command, and whatever the profile prints goes down the same stdout/stderr pipes the
 * command will use — so it lands in the model-visible tool output of every command. The
 * measured instance (issue 0006) is nvm's die-on-prefix warning when `~/.npmrc` sets
 * `prefix`/`globalconfig`: three lines of imperative text with no environment variable to
 * silence them (`NVM_SILENT` gates only the "Now using…" line, and `--delete-prefix` would
 * mutate the user's npmrc), so the env-hardening route is closed and the separation has to be
 * structural.
 *
 * Structure, not pattern matching: the spawned string starts by echoing a per-session random
 * marker to each stream (`echo <m>; echo <m> >&2; <cmd>`). Writes on one pipe are FIFO, so on
 * each stream everything before its marker was written before the command began — profile
 * chatter by construction — and everything after belongs to the command.
 *
 * Fail-open, never fail-silent: pre-marker output is held, not dropped eagerly. If the marker
 * never arrives — measured: a `-c` string that fails to parse runs none of it, bash prints only
 * the syntax error and exits 2 — the held text is flushed when the process exits, so diagnostics
 * are never lost; a runaway pre-marker stream flushes once past a cap. Profile-free shells
 * (pwsh/powershell spawn `-NoProfile`, cmd `/d`) skip the wrap entirely (see shell.ts `style`).
 */
import { randomBytes } from "node:crypto";

/** A fresh per-session marker; random enough that real chatter cannot contain it. */
export function newStartupMarker(): string {
  return `__penguin_ready_${randomBytes(9).toString("hex")}__`;
}

/**
 * Wraps a POSIX-style command so both streams emit `marker` before the command runs. A single
 * line, so line numbers in the shell's own diagnostics for `cmd` are unchanged.
 */
export function withStartupMarker(cmd: string, marker: string): string {
  return `echo ${marker}; echo ${marker} >&2; ${cmd}`;
}

/** Held pre-marker text past this size fails open: profile chatter is lines, not megabytes. */
const HOLD_CAP = 64 * 1024;

/**
 * Per-stream gate: holds everything up to and including the marker's line, passes everything
 * after it through untouched. Constructed with `null` when the shell is profile-free — then it
 * is a pass-through.
 */
export class StartupChatterGate {
  private held = "";
  private open: boolean;
  /** The marker's line ending may arrive in a later chunk (or as a split CRLF); eat it once. */
  private eatNewline = false;

  constructor(private readonly marker: string | null) {
    this.open = marker === null;
  }

  /** Filters one data chunk; returns the text to publish now ("" while holding). */
  filter(chunk: string): string {
    if (this.open) {
      if (this.eatNewline) {
        this.eatNewline = false;
        return chunk.replace(/^\r?\n/, "");
      }
      return chunk;
    }
    this.held += chunk;
    const at = this.held.indexOf(this.marker as string);
    if (at !== -1) {
      let rest = this.held.slice(at + (this.marker as string).length);
      this.held = "";
      this.open = true;
      if (rest.startsWith("\r\n")) rest = rest.slice(2);
      else if (rest.startsWith("\n")) rest = rest.slice(1);
      else if (rest.startsWith("\r")) {
        rest = rest.slice(1);
        this.eatNewline = true; // CRLF split across chunks: the \n leads the next one
      } else if (rest === "") {
        this.eatNewline = true; // the ending itself has not arrived yet
      }
      return rest;
    }
    if (this.held.length > HOLD_CAP) return this.flush();
    return "";
  }

  /**
   * Everything still held; the gate opens. Call when the process exits (or errors) before the
   * marker appeared, so a shell that never ran the echos still delivers its diagnostics.
   */
  flush(): string {
    const held = this.held;
    this.held = "";
    this.open = true;
    return held;
  }
}
