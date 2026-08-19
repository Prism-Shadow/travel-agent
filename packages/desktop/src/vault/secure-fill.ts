/**
 * Typing a value into a page without ever handing it to the agent.
 *
 * The agent asks for a fill by **handle** — `pv:<grantId>:<field>` — and the main process does the
 * rest: check the grant against the page that is open *now*, decrypt exactly one field, write it
 * into the form through the debugger, register the element so snapshots and screenshots can cover
 * it, wipe the plaintext, and record what happened without recording what it was.
 *
 * Why the fill does not go through the executor's `vm`: that sandbox is a guardrail, not
 * a boundary, and it lives in a process the agent can reach. Any design that passes the value into
 * it has handed the value to the agent by a longer route.
 *
 * The honest limits, both of which are recorded rather than papered over:
 *
 * - **The value is in the DOM afterwards, and the agent can read the DOM**. Registration and
 *   redaction reduce the accidental paths — a snapshot, a screenshot — not the deliberate one. That
 *   is what the tier system is really for: L2 is "acceptable to be readable by the agent once
 *   typed", and anything that is not acceptable is L3 and is never filled from storage at all.
 * - **The trust in "only main holds the plaintext" is exactly the unresolved isolation assumption (D3).** Without OS-level
 *   isolation, main's memory is readable by anything running as the same user.
 */
import { wipe } from "./crypto.js";
import type { GrantRegistry, GrantRefusal } from "./grants.js";
import { parseHandle } from "./grants.js";
import type { SensitiveElementRegistry, BoundingBox } from "./sensitive-elements.js";
import type { ProfileVault } from "./store.js";
import { isNeverFilled, isNeverPersisted } from "./tiers.js";
import type { VaultAudit } from "./audit.js";

/** Where a fill should land. `targetId` is the CDP target — the tab, not the window. */
export interface FillTarget {
  targetId: string;
  /** CSS selector inside that target. The agent supplies it; main never trusts it blindly. */
  selector: string;
  /** The eTLD+1 of the page as main sees it, not as the agent reports it. */
  domain: string;
}

/**
 * The page operations a fill needs, as a port.
 *
 * Implemented in the desktop shell over `webContents.debugger`; kept behind an interface so the
 * decision logic above can be tested without a browser, and so the one place that can type a secret
 * into a page is a named, reviewable surface rather than "anything with a debugger handle".
 */
export interface FillPort {
  /**
   * Writes `value` into the element in an isolated world, dispatching the input/change events a
   * framework-controlled input needs (flagged as the known-fragile part).
   *
   * Returns where the element ended up, so the screenshot mask can cover it.
   */
  fillField(input: {
    targetId: string;
    selector: string;
    value: string;
  }): Promise<{ filled: boolean; box?: BoundingBox }>;
  /** Reads an element's current value back. Used to prove a secret field was cleared. */
  readField(input: { targetId: string; selector: string }): Promise<string | null>;
  /** Whether the element is still in the DOM at all. */
  hasField(input: { targetId: string; selector: string }): Promise<boolean>;
  /** The page's current URL, for the domain check and for proof-of-navigation. */
  currentUrl(input: { targetId: string }): Promise<string | null>;
}

export type FillRefusal =
  GrantRefusal | "vault_locked" | "never_filled" | "not_stored" | "element_missing" | "fill_failed";

export type FillResult =
  | { ok: true; field: string; elementId: string }
  | { ok: false; reason: FillRefusal; detail: string };

export interface SecureFillerOptions {
  vault: ProfileVault;
  grants: GrantRegistry;
  sensitive: SensitiveElementRegistry;
  port: FillPort;
  audit?: VaultAudit | null;
}

export class SecureFiller {
  constructor(private readonly deps: SecureFillerOptions) {}

  /**
   * Fills one field, or refuses and says why.
   *
   * Refusals are values, not exceptions: "that grant expired" is an ordinary thing for an agent to
   * hear and act on, and the audit entry that goes with it is part of the answer rather than an
   * error report.
   */
  async fill(input: { handle: string; taskId: string; target: FillTarget }): Promise<FillResult> {
    const parsed = parseHandle(input.handle);
    const field = parsed?.field ?? "unknown";

    const verdict = this.deps.grants.authorizeHandle({
      handle: input.handle,
      taskId: input.taskId,
      domain: input.target.domain,
    });
    if (!verdict.ok) {
      await this.reject(field, input, verdict.reason, verdict.detail);
      return { ok: false, reason: verdict.reason, detail: verdict.detail };
    }

    if (isNeverFilled(verdict.field) || isNeverPersisted(verdict.field)) {
      const detail =
        `"${verdict.field}" is never filled by this application: it is entered by the person, in ` +
        `the site's own field or their bank's app.`;
      await this.reject(verdict.field, input, "never_filled", detail);
      return { ok: false, reason: "never_filled", detail };
    }

    if (!this.deps.vault.unlocked) {
      const detail = "The vault is locked, so there is nothing to fill from.";
      return { ok: false, reason: "vault_locked", detail };
    }
    if (!this.deps.vault.has(verdict.field)) {
      const detail = `Nothing is stored for "${verdict.field}".`;
      await this.reject(verdict.field, input, "not_stored", detail);
      return { ok: false, reason: "not_stored", detail };
    }

    if (!(await this.deps.port.hasField(input.target))) {
      const detail = `No element matches ${input.target.selector} on that page any more.`;
      await this.reject(verdict.field, input, "element_missing", detail);
      return { ok: false, reason: "element_missing", detail };
    }

    // From here the plaintext exists, in this process only, for the length of one write.
    let value: string | null = await this.deps.vault.reveal(verdict.field, {
      reason: "secure fill",
      grantId: verdict.grant.grantId,
    });
    let buffer: Buffer | null = Buffer.from(value, "utf8");
    try {
      const written = await this.deps.port.fillField({
        targetId: input.target.targetId,
        selector: input.target.selector,
        value,
      });
      if (!written.filled) {
        const detail =
          `The field did not accept the value. Some sites use a custom control that ignores a ` +
          `direct write; the person can type it themselves, or the page may need a different step.`;
        await this.reject(verdict.field, input, "fill_failed", detail);
        return { ok: false, reason: "fill_failed", detail };
      }

      const element = this.deps.sensitive.register({
        field: verdict.field,
        value,
        targetId: input.target.targetId,
        selector: input.target.selector,
        ...(written.box ? { box: written.box } : {}),
      });

      await this.deps.audit?.append("fill_performed", {
        grantId: verdict.grant.grantId,
        taskId: input.taskId,
        domain: input.target.domain,
        field: verdict.field,
        targetId: input.target.targetId,
      });
      return { ok: true, field: verdict.field, elementId: element.id };
    } finally {
      // The window in which this process holds the value ends here, whatever happened above.
      wipe(buffer);
      buffer = null;
      value = null;
    }
  }

  private async reject(
    field: string,
    input: { taskId: string; target: FillTarget },
    reason: string,
    detail: string,
  ): Promise<void> {
    await this.deps.audit?.append("fill_rejected", {
      taskId: input.taskId,
      domain: input.target.domain,
      field,
      targetId: input.target.targetId,
      reason,
      outcome: detail.slice(0, 200),
    });
  }
}
