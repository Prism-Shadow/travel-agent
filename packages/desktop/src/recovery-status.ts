/**
 * One vocabulary for the three ways the in-app browser can fail under a person (004 Phase 5).
 *
 * The shell already recovers from each of these — the relay crashing, the extension disconnecting,
 * an in-app browser view's renderer dying — but each path grew its own ad-hoc handling, and 002
 * "Every recovery path has a user-readable status" is a hardening item precisely because
 * a silent recovery is indistinguishable from a hang. This maps each failure to a single, honest
 * status: what happened, whether it fixes itself, and what (if anything) the person should do.
 *
 * The point of collecting them here is consistency: the same failure produces the same words
 * wherever it surfaces, the recoverable/awaiting/manual distinction is made once, and the copy is
 * a set of string keys the web layer resolves — never a sentence baked into a main-process handler.
 * Pure and dependency-free, so the mapping is unit-tested rather than read off a running app.
 */

/** The failure classes the in-app browser recovers from. */
export type RecoveryFailure =
  /** The CDP relay process died; the shell restarts it. */
  | "relay_crashed"
  /** The Chrome extension backend lost its connection to the relay. */
  | "extension_disconnected"
  /** An in-app browser view's renderer died; that one tab is rebuilt. */
  | "iab_renderer_gone"
  /** The whole in-app browser could not be restored after a restart. */
  | "iab_restore_failed";

/** How a failure resolves, which decides how loud the status should be. */
export type RecoveryMode =
  /** Fixes itself; the person waits a moment. */
  | "recovering"
  /** Needs the person to retry or re-do a step. */
  | "manual"
  /** Degraded but usable; the person may want to switch backends. */
  | "degraded";

export interface RecoveryStatus {
  failure: RecoveryFailure;
  mode: RecoveryMode;
  /** i18n key for the one-line status, resolved by the web layer's string table. */
  titleKey: string;
  /** i18n key for the sentence of detail / next step. */
  detailKey: string;
  /** Whether the shell is itself acting to recover (a spinner, not a button). */
  autoRecovering: boolean;
}

const TABLE: Record<RecoveryFailure, Omit<RecoveryStatus, "failure">> = {
  relay_crashed: {
    mode: "recovering",
    titleKey: "browser.recovery.relayCrashed.title",
    detailKey: "browser.recovery.relayCrashed.detail",
    autoRecovering: true,
  },
  extension_disconnected: {
    mode: "degraded",
    titleKey: "browser.recovery.extensionDisconnected.title",
    detailKey: "browser.recovery.extensionDisconnected.detail",
    autoRecovering: false,
  },
  iab_renderer_gone: {
    mode: "recovering",
    titleKey: "browser.recovery.rendererGone.title",
    detailKey: "browser.recovery.rendererGone.detail",
    autoRecovering: true,
  },
  iab_restore_failed: {
    mode: "manual",
    titleKey: "browser.recovery.restoreFailed.title",
    detailKey: "browser.recovery.restoreFailed.detail",
    autoRecovering: false,
  },
};

/** The canonical status for a failure. */
export function recoveryStatus(failure: RecoveryFailure): RecoveryStatus {
  return { failure, ...TABLE[failure] };
}

/**
 * Maps an internal error code or reason to a recovery failure, or null when it is not one of these.
 *
 * Deliberately conservative: it recognises the codes the shell actually raises (the `IAB_*` family,
 * a `render-process-gone` reason, the relay/extension signals) and returns null for anything else,
 * so an unrelated error is never dressed up as a browser-recovery status.
 */
export function classifyRecovery(code: string): RecoveryFailure | null {
  const c = code.toLowerCase();
  if (c.includes("iab_restore_failed") || c.includes("iab_rebuild_failed"))
    return "iab_restore_failed";
  if (c.includes("render-process-gone") || c.includes("renderer") || c.includes("iab_renderer")) {
    return "iab_renderer_gone";
  }
  if (c.includes("relay") && (c.includes("crash") || c.includes("exit") || c.includes("gone"))) {
    return "relay_crashed";
  }
  if (
    c.includes("extension") &&
    (c.includes("disconn") || c.includes("lost") || c.includes("gone"))
  ) {
    return "extension_disconnected";
  }
  return null;
}
