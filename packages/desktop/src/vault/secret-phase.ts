/**
 * The scoped secret phase: the agent's channel is taken away, not asked to look away.
 *
 * An earlier design had the main process fill a one-time code and the agent simply carry on. That
 * contradicts the threat model — once a CVV or an OTP is in an ordinary DOM input, anything with a debugger
 * channel to that page can read it. So the phase is built the other way round:
 *
 * ```
 * 1  enter        pause the turn · DETACH the agent's CDP capability · audit
 * 2  the person types into the card's secure field (or into the site's own field)
 * 3  main fills and submits atomically — only if `secret_entry.live` is on
 * 4  exit, one of three ways and never a fourth:
 *      (a) proven clear   → value gone from the page → the channel comes back
 *      (b) unproven       → the page stays with the person, for good
 *      (c) destroyed      → this target is thrown away and the flow rebuilt elsewhere
 * 5  audit the exit, with the reason and never the value
 * ```
 *
 * Two things make this more than a state machine with good intentions:
 *
 * - **The detach is real and it is checked.** Nothing in this class fills anything before
 *   `detachAgent` has resolved. If detaching fails, the phase does not proceed: the value is not
 *   typed at all, and the page is left with the person. Failing closed here is the difference
 *   between a secret phase and a promise.
 * - **The proof is a proof, not a wait.** Coming back requires the field to read empty, to be gone
 *   from the DOM, or the page to have navigated away. "We waited two seconds and it is probably
 *   fine" is exit (b), and exit (b) does not give the page back.
 */
import type { VaultAudit } from "./audit.js";
import type { FillPort } from "./secure-fill.js";
import type { SensitiveElementRegistry } from "./sensitive-elements.js";
import { isNeverFilled } from "./tiers.js";

/** The three exits of the secret phase. Mirrors `SecretExit` in browser-cli's handover state. */
export type SecretExitReason = "cleared" | "unproven" | "target_destroyed";

/** What the phase needs from the browser, beyond what a fill needs. */
export interface SecretPhasePort extends FillPort {
  /** Revokes the agent's debugging channel for this target. Must throw if it cannot. */
  detachAgent(input: { targetId: string; sessionId: string }): Promise<void>;
  /** Gives it back. Called **only** after a proven-clear exit. */
  attachAgent(input: { targetId: string; sessionId: string }): Promise<void>;
  /** Throws the target away (exit c). */
  destroyTarget(input: { targetId: string }): Promise<void>;
  /** Presses the site's own submit control, in the same isolated world as the fill. */
  submit(input: { targetId: string; selector: string }): Promise<boolean>;
}

export interface SecretPhaseFlags {
  /** Whether main may type a real one-time code at all (off until this phase is accepted). */
  "secret_entry.live": boolean;
}

export interface SecretPhaseDeps {
  port: SecretPhasePort;
  sensitive: SensitiveElementRegistry;
  audit?: VaultAudit | null;
  flags: SecretPhaseFlags;
  now?: () => Date;
  /** Told when the phase starts and ends, so the transaction-layer handover state follows. */
  onStateChange?: (
    event: { type: "enter"; field: string } | { type: "exit"; exit: SecretExitReason },
  ) => void;
}

export interface SecretPhaseTarget {
  sessionId: string;
  taskId: string;
  targetId: string;
  /** The input the code goes into. Also the element the proof reads back. */
  selector: string;
  /** The site's own submit control, when the flow needs one pressed in the same breath. */
  submitSelector?: string;
  field: string;
}

export type EnterResult =
  | { ok: true; mode: "live_fill" | "person_types" }
  | { ok: false; reason: "detach_failed" | "already_active" | "never_filled"; detail: string };

export type SecretFillResult =
  | { ok: true; submitted: boolean }
  | {
      ok: false;
      reason: "not_active" | "live_disabled" | "never_filled" | "fill_failed";
      detail: string;
    };

export interface ClearProof {
  cleared: boolean;
  /** How it was shown: the field read empty, it left the DOM, or the page navigated away. */
  how: "empty" | "detached" | "navigated" | null;
}

export class SecretPhaseError extends Error {
  override readonly name = "SecretPhaseError";
}

/**
 * One secret phase at a time, per browsing session.
 *
 * Not per target: a person typing a code into one tab while the agent drives another is exactly the
 * situation where a mistake is invisible, and the cost of serialising is a few seconds.
 */
export class SecretPhaseController {
  private active: (SecretPhaseTarget & { enteredAt: string; urlAtEntry: string | null }) | null =
    null;
  private readonly now: () => Date;

  constructor(private readonly deps: SecretPhaseDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get current(): { field: string; targetId: string } | null {
    return this.active ? { field: this.active.field, targetId: this.active.targetId } : null;
  }

  /**
   * Starts the phase: audit, then detach, and only then report that it is safe to type.
   *
   * A failure to detach is reported as a refusal rather than thrown, because the caller's next move
   * is a product decision — ask the person to complete the step in their own browser, say — and not
   * an exception path.
   */
  async enter(target: SecretPhaseTarget): Promise<EnterResult> {
    if (this.active) {
      return {
        ok: false,
        reason: "already_active",
        detail: `A secret phase is already open for "${this.active.field}".`,
      };
    }

    await this.deps.audit?.append("secret_phase_enter", {
      sessionId: target.sessionId,
      taskId: target.taskId,
      targetId: target.targetId,
      field: target.field,
    });

    try {
      await this.deps.port.detachAgent({
        targetId: target.targetId,
        sessionId: target.sessionId,
      });
    } catch (error) {
      // Fail closed: nothing is typed into a page the agent can still read.
      await this.deps.audit?.append("secret_phase_exit", {
        sessionId: target.sessionId,
        taskId: target.taskId,
        targetId: target.targetId,
        field: target.field,
        outcome: "unproven",
        reason: `detach failed: ${(error as Error).message}`,
      });
      this.deps.onStateChange?.({ type: "exit", exit: "unproven" });
      return {
        ok: false,
        reason: "detach_failed",
        detail:
          `The agent's channel to that page could not be closed (${(error as Error).message}), so ` +
          `nothing was typed into it. Ask the person to finish this step themselves.`,
      };
    }

    this.active = {
      ...target,
      enteredAt: this.now().toISOString(),
      urlAtEntry: await this.safeUrl(target.targetId),
    };
    this.deps.onStateChange?.({ type: "enter", field: target.field });

    // Two fields are human-only whatever the flags say; the phase still applies,
    // because the agent must be detached while they are typed.
    const live = this.deps.flags["secret_entry.live"] && !isNeverFilled(target.field);
    return { ok: true, mode: live ? "live_fill" : "person_types" };
  }

  /**
   * Types the value the person entered on the card, and submits in the same breath.
   *
   * The value arrives here from the card's own channel — preload to main, never through the server,
   * the SSE stream or the agent — and leaves in the `finally`.
   */
  async fillFromPerson(input: { value: string }): Promise<SecretFillResult> {
    const active = this.active;
    if (!active) {
      return { ok: false, reason: "not_active", detail: "No secret phase is open." };
    }
    if (isNeverFilled(active.field)) {
      return {
        ok: false,
        reason: "never_filled",
        detail:
          `A ${active.field} is never typed by this application, under any flag. The person ` +
          `enters it in the site's own field or their bank's app.`,
      };
    }
    if (!this.deps.flags["secret_entry.live"]) {
      return {
        ok: false,
        reason: "live_disabled",
        detail:
          "Filling a real one-time code is off in this build (secret_entry.live). The card " +
          "explains what is needed and the person types it into the site's own field.",
      };
    }

    let value: string | null = input.value;
    try {
      const written = await this.deps.port.fillField({
        targetId: active.targetId,
        selector: active.selector,
        value,
      });
      if (!written.filled) {
        return {
          ok: false,
          reason: "fill_failed",
          detail: "The field did not accept the value; the person can type it themselves.",
        };
      }
      // Registered like any other sensitive value: even inside the phase, a screenshot taken by
      // the shell itself must not carry it.
      this.deps.sensitive.register({
        field: active.field,
        value,
        targetId: active.targetId,
        selector: active.selector,
        ...(written.box ? { box: written.box } : {}),
      });

      let submitted = false;
      if (active.submitSelector) {
        submitted = await this.deps.port.submit({
          targetId: active.targetId,
          selector: active.submitSelector,
        });
      }
      return { ok: true, submitted };
    } finally {
      value = null;
    }
  }

  /**
   * Asks the page whether the value is gone.
   *
   * Three acceptable proofs, in the order they are cheapest to obtain. Anything else — including a
   * page that cannot be reached to ask — is not a proof, and the caller must treat it as exit (b).
   */
  async proveCleared(): Promise<ClearProof> {
    const active = this.active;
    if (!active) return { cleared: false, how: null };

    try {
      const url = await this.deps.port.currentUrl({ targetId: active.targetId });
      if (url !== null && active.urlAtEntry !== null && url !== active.urlAtEntry) {
        return { cleared: true, how: "navigated" };
      }
      const present = await this.deps.port.hasField({
        targetId: active.targetId,
        selector: active.selector,
      });
      if (!present) return { cleared: true, how: "detached" };
      const value = await this.deps.port.readField({
        targetId: active.targetId,
        selector: active.selector,
      });
      if (value === "" || value === null) return { cleared: true, how: "empty" };
      return { cleared: false, how: null };
    } catch {
      // A page that cannot be asked has not answered. That is exit (b), not a retry loop.
      return { cleared: false, how: null };
    }
  }

  /**
   * Ends the phase by trying to prove the field is clear.
   *
   * Returns the exit that actually happened, which is the only thing the caller should report: an
   * `unproven` exit means the page is the person's now, and telling the agent "done" would be false.
   */
  async finish(): Promise<SecretExitReason> {
    const active = this.active;
    if (!active) throw new SecretPhaseError("No secret phase is open.");
    const proof = await this.proveCleared();
    if (!proof.cleared) return this.close("unproven", "could not prove the field was cleared");

    this.deps.sensitive.forgetTarget(active.targetId);
    try {
      await this.deps.port.attachAgent({
        targetId: active.targetId,
        sessionId: active.sessionId,
      });
    } catch (error) {
      // Proven clear but the channel did not come back: the page is still safe, the agent simply
      // does not have it. That is exit (b) too — reporting "cleared" would leave the agent trying
      // to drive a page it cannot reach.
      return this.close("unproven", `reattach failed: ${(error as Error).message}`);
    }
    return this.close("cleared", proof.how ?? "cleared");
  }

  /** Exit (b) taken deliberately: the person keeps this page and the agent does not come back. */
  async keepHumanOnly(reason = "the person keeps this page"): Promise<SecretExitReason> {
    if (!this.active) throw new SecretPhaseError("No secret phase is open.");
    return this.close("unproven", reason);
  }

  /** Exit (c): the value could not be proven gone and the flow has to continue somewhere else. */
  async destroyTarget(reason = "target destroyed to continue the flow"): Promise<SecretExitReason> {
    const active = this.active;
    if (!active) throw new SecretPhaseError("No secret phase is open.");
    try {
      await this.deps.port.destroyTarget({ targetId: active.targetId });
    } finally {
      this.deps.sensitive.forgetTarget(active.targetId);
    }
    return this.close("target_destroyed", reason);
  }

  /** The turn ended or the session went away mid-phase: nothing is given back. */
  async abandon(reason = "the turn ended"): Promise<SecretExitReason | null> {
    if (!this.active) return null;
    return this.close("unproven", reason);
  }

  private async close(exit: SecretExitReason, reason: string): Promise<SecretExitReason> {
    const active = this.active!;
    this.active = null;
    await this.deps.audit?.append("secret_phase_exit", {
      sessionId: active.sessionId,
      taskId: active.taskId,
      targetId: active.targetId,
      field: active.field,
      outcome: exit,
      reason,
    });
    this.deps.onStateChange?.({ type: "exit", exit });
    return exit;
  }

  private async safeUrl(targetId: string): Promise<string | null> {
    try {
      return await this.deps.port.currentUrl({ targetId });
    } catch {
      return null;
    }
  }
}
