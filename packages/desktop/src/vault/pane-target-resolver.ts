/**
 * The bridge from the vault's `TargetResolver` port to the browser pane.
 *
 * The vault side speaks in `targetId`s; the pane speaks in `WebContents` and tabs. This adapter is
 * the translation, and it is kept apart from `main.ts` for the one reason worth the file: the
 * translation has edges — a tab that closed mid-fill, a `webContents` whose debugger a page has
 * grabbed — and those are testable against a fake pane here, where they would not be behind
 * Electron in `main.ts`.
 *
 * Detaching the *agent's* channel (secret phase) is expressed as revoking the relay's
 * ability to drive the target, not as tearing down our own debugger: the two are different clients
 * of the same page, and the phase must remove the agent's while keeping ours for the fill and the
 * proof-of-clearing read. The pane exposes that as a per-target drive gate; this adapter drives it.
 */
import type { DebuggerLike, TargetResolver } from "./debugger-fill-port.js";

/** The slice of a `WebContents` the resolver needs. Structural, so a fake stands in cleanly. */
export interface ContentsLike {
  getURL(): string;
  isDestroyed(): boolean;
  readonly debugger: {
    attach(version?: string): void;
    detach(): void;
    isAttached(): boolean;
    sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  };
}

/** What the adapter needs from the pane. A subset of BrowserPane, named so it can be faked. */
export interface PaneLike {
  /** The contents for a CDP target id, or null when no live tab has it. */
  contentsForTarget(targetId: string): ContentsLike | null;
  /** Closes the tab that owns a target (secret-phase exit c). */
  closeTarget(targetId: string): Promise<void>;
  /**
   * Turns the agent's ability to drive a target off or on (secret phase enter/exit).
   *
   * The pane already gates driving per target for handovers; the secret phase is the same gate,
   * held for the duration of one code entry. Returns whether the change took — a target that has
   * gone is reported so the phase can fail closed rather than believe it detached something.
   */
  setAgentDrivable(input: { targetId: string; drivable: boolean }): boolean;
}

export function paneTargetResolver(pane: PaneLike): TargetResolver {
  const debuggerFor = (targetId: string): DebuggerLike | null => {
    const contents = pane.contentsForTarget(targetId);
    if (!contents || contents.isDestroyed()) return null;
    return {
      attach: (version) => contents.debugger.attach(version),
      detach: () => contents.debugger.detach(),
      isAttached: () => contents.debugger.isAttached(),
      sendCommand: (method, params) => contents.debugger.sendCommand(method, params),
    };
  };

  return {
    debuggerFor,
    urlOf: (targetId) => {
      const contents = pane.contentsForTarget(targetId);
      return contents && !contents.isDestroyed() ? contents.getURL() : null;
    },
    destroy: (targetId) => pane.closeTarget(targetId),
    detachAgent: async ({ targetId }) => {
      if (!pane.setAgentDrivable({ targetId, drivable: false })) {
        throw new Error(`target ${targetId} is gone; its agent channel cannot be revoked`);
      }
    },
    attachAgent: async ({ targetId }) => {
      // Best-effort by design: if the target went away while the person was typing, there is
      // nothing to hand back, and the secret phase's proof step has already decided this is
      // exit (b) or (c). Restoring drivability on a live target is the only real work here.
      pane.setAgentDrivable({ targetId, drivable: true });
    },
  };
}
