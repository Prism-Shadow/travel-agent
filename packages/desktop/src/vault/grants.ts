/**
 * Permission to use one person's data, for one purpose, on one site, for a while.
 *
 * There is deliberately no "allow this app to use my profile" switch. A grant names a **turn**, a
 * **domain**, a **purpose** and an **exact set of fields**, and it expires. Changing any of those
 * means asking again. That is more friction than a blanket permission, and it is the point: the
 * blanket version cannot be reasoned about after the fact, and it is the shape every "the assistant
 * filled in something I did not expect" story starts with.
 *
 * What the agent receives depends on the tier of what it asked for:
 *
 * - **projection** — L1 values, masked where the table says so, in the model's context.
 * - **handle** — `pv:<grantId>:<field>`, an opaque string that is worth nothing on its own. It can
 *   only be redeemed by the main process, which re-checks the grant *at the moment of the fill*:
 *   right turn, right domain, right field, still alive. A handle that leaks tells an attacker which
 *   field exists and nothing else.
 *
 * The re-check at redemption time is the part that matters. A grant approved for `ctrip.com` and
 * then redeemed on a page that has navigated elsewhere is refused — the check is against the page
 * the fill is about to happen on, not against the page that was open when the person said yes.
 */
import { randomUUID } from "node:crypto";

import { tierOf, type SensitivityTier } from "./tiers.js";

/** How the agent gets at the data: as values it can read, or as handles it cannot. */
export type GrantMode = "projection" | "handle";

export interface ProfileGrant {
  grantId: string;
  /** The turn it was approved for. It dies with that turn, whatever its expiry says. */
  taskId: string;
  /** eTLD+1, matched exactly. No wildcards, no subdomain matching. */
  domain: string;
  /** Human-readable, shown on the card and written to the audit. */
  purpose: string;
  /** Exact field names. `"*"` is not a field. */
  fields: string[];
  mode: GrantMode;
  approvedAt: string;
  expiresAt: string;
  /** Where the approval came from, for the audit trail. */
  channel: string;
  revokedAt?: string;
}

/**
 * Why a grant does not authorise this use.
 *
 * The first six are the grant checks, one refusal each. `wrong_mode` is the seventh, and it exists
 * because the two modes are not interchangeable: a projection grant hands values to a model and
 * issues no handles, so a handle presented against one is not a near-miss to be repaired but a sign
 * that something built a reference it was never given.
 */
export type GrantRefusal =
  | "unknown_grant"
  | "revoked"
  | "expired"
  | "wrong_task"
  | "wrong_domain"
  | "field_not_granted"
  | "wrong_mode";

export type GrantVerdict =
  | { ok: true; grant: ProfileGrant; field: string }
  | { ok: false; reason: GrantRefusal; detail: string };

export class GrantError extends Error {
  override readonly name = "GrantError";
}

/** L2 material gets a short window; L1 lives as long as the turn. */
export const L2_GRANT_TTL_MS = 15 * 60_000;
export const L1_GRANT_TTL_MS = 8 * 60 * 60_000;

const HANDLE_PATTERN = /^pv:([A-Za-z0-9_-]{4,}):([A-Za-z0-9_.-]{1,64})$/;

/** Builds the opaque reference an agent may hold for an L2 field. */
export function handleFor(grantId: string, field: string): string {
  return `pv:${grantId}:${field}`;
}

export function parseHandle(handle: string): { grantId: string; field: string } | null {
  const match = HANDLE_PATTERN.exec(handle);
  if (!match) return null;
  return { grantId: match[1]!, field: match[2]! };
}

export interface ApproveGrantInput {
  taskId: string;
  domain: string;
  purpose: string;
  fields: readonly string[];
  mode: GrantMode;
  channel: string;
  /** Overrides the tier-derived window. Never lengthens it beyond the L1 ceiling. */
  ttlMs?: number;
}

export interface GrantRegistryOptions {
  now?: () => Date;
  /** Records what happened. Values never reach it; the registry only ever passes names. */
  audit?: (
    event: "grant_approved" | "grant_denied" | "grant_revoked" | "fill_rejected",
    details: {
      grantId?: string;
      taskId?: string;
      domain?: string;
      field?: string;
      fields?: string[];
      purpose?: string;
      reason?: string;
    },
  ) => void | Promise<void>;
  /** Injected in tests so grant ids are stable. */
  newId?: () => string;
}

/**
 * The live grants of one application run.
 *
 * In memory only, deliberately: a grant that survived a restart would be a permission nobody is
 * present for. Everything durable about it — that it was asked for, approved, used, revoked — is in
 * the audit log.
 */
export class GrantRegistry {
  private readonly grants = new Map<string, ProfileGrant>();
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly audit: GrantRegistryOptions["audit"];

  constructor(options: GrantRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => `g-${randomUUID().slice(0, 8)}`);
    this.audit = options.audit;
  }

  list(taskId?: string): ProfileGrant[] {
    const all = [...this.grants.values()];
    return taskId ? all.filter((grant) => grant.taskId === taskId) : all;
  }

  get(grantId: string): ProfileGrant | undefined {
    return this.grants.get(grantId);
  }

  /**
   * Records an approval and returns the grant.
   *
   * Refuses inputs that would make the grant unenforceable rather than storing them: a wildcard
   * field set, an empty domain, a domain with a scheme or a path (which would not be an eTLD+1),
   * an L3 field (which has no grantable form at all).
   */
  async approve(input: ApproveGrantInput): Promise<ProfileGrant> {
    const domain = normaliseDomain(input.domain);
    if (!domain) {
      throw new GrantError(
        `"${input.domain}" is not a domain a grant can be bound to. It must be an eTLD+1 such as ` +
          `"ctrip.com" — no scheme, no path, no wildcard.`,
      );
    }
    if (!input.taskId?.trim()) {
      throw new GrantError("A grant belongs to one turn, and this one names none.");
    }
    if (!input.purpose?.trim()) {
      throw new GrantError(
        "A grant needs a purpose in the person's words: it is what the card shows and what the " +
          "audit log records months later.",
      );
    }
    const fields = [...new Set(input.fields)];
    if (fields.length === 0) throw new GrantError("A grant with no fields grants nothing.");
    for (const field of fields) {
      if (field === "*" || field.includes("*")) {
        throw new GrantError(
          `"${field}" is not a field name. Grants list fields exactly; there is no wildcard, ` +
            `because "everything" is precisely the permission this design refuses to offer.`,
        );
      }
      if (tierOf(field) === "L3") {
        throw new GrantError(
          `"${field}" is never stored and never filled from storage, so there is nothing to ` +
            `grant access to.`,
        );
      }
    }

    const holdsL2 = fields.some((field) => tierOf(field) !== "L1");
    const ceiling = holdsL2 ? L2_GRANT_TTL_MS : L1_GRANT_TTL_MS;
    const ttl = Math.min(input.ttlMs ?? ceiling, ceiling);
    const at = this.now();
    const grant: ProfileGrant = {
      grantId: this.newId(),
      taskId: input.taskId,
      domain,
      purpose: input.purpose,
      fields,
      mode: input.mode,
      approvedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + ttl).toISOString(),
      channel: input.channel,
    };
    this.grants.set(grant.grantId, grant);
    await this.audit?.("grant_approved", {
      grantId: grant.grantId,
      taskId: grant.taskId,
      domain: grant.domain,
      fields: grant.fields,
      purpose: grant.purpose,
      reason: grant.mode,
    });
    return grant;
  }

  /** Records a refusal. There is no grant to return — that is the point of recording it. */
  async deny(input: {
    taskId: string;
    domain: string;
    fields: readonly string[];
    purpose: string;
  }): Promise<void> {
    await this.audit?.("grant_denied", {
      taskId: input.taskId,
      domain: normaliseDomain(input.domain) ?? input.domain,
      fields: [...input.fields],
      purpose: input.purpose,
    });
  }

  async revoke(grantId: string, reason: string): Promise<boolean> {
    const grant = this.grants.get(grantId);
    if (!grant || grant.revokedAt) return false;
    grant.revokedAt = this.now().toISOString();
    await this.audit?.("grant_revoked", { grantId, taskId: grant.taskId, reason });
    return true;
  }

  /** Ends every grant of a turn. Called when the turn ends, however it ends. */
  async revokeTask(taskId: string, reason = "turn ended"): Promise<number> {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (grant.taskId !== taskId || grant.revokedAt) continue;
      await this.revoke(grant.grantId, reason);
      count += 1;
    }
    return count;
  }

  /** Ends everything. Called when the vault locks: a handle that still resolves is not locked. */
  async revokeAll(reason = "vault locked"): Promise<number> {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (grant.revokedAt) continue;
      await this.revoke(grant.grantId, reason);
      count += 1;
    }
    return count;
  }

  /** Drops revoked and expired grants from memory. Nothing about the audit trail changes. */
  sweep(): number {
    const now = this.now().getTime();
    let removed = 0;
    for (const [id, grant] of this.grants) {
      const dead = grant.revokedAt !== undefined || Date.parse(grant.expiresAt) <= now;
      if (dead) {
        this.grants.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * The check that runs at the moment of use, not at the moment of approval.
   *
   * `domain` is the page the fill is about to happen on. That is the whole reason this is checked
   * again here: a grant approved while `ctrip.com` was open must not still be good after the page
   * has navigated to somewhere else, and only the caller at redemption time knows where it is.
   */
  authorize(input: {
    grantId: string;
    field: string;
    taskId: string;
    domain: string;
    mode?: GrantMode;
  }): GrantVerdict {
    const grant = this.grants.get(input.grantId);
    if (!grant) {
      return {
        ok: false,
        reason: "unknown_grant",
        detail: `No grant ${input.grantId} exists in this run. Ask for one.`,
      };
    }
    if (grant.revokedAt) {
      return {
        ok: false,
        reason: "revoked",
        detail: `Grant ${grant.grantId} was revoked at ${grant.revokedAt}.`,
      };
    }
    if (Date.parse(grant.expiresAt) <= this.now().getTime()) {
      return {
        ok: false,
        reason: "expired",
        detail: `Grant ${grant.grantId} lapsed at ${grant.expiresAt}. Ask again if it is still needed.`,
      };
    }
    if (grant.taskId !== input.taskId) {
      return {
        ok: false,
        reason: "wrong_task",
        detail: `Grant ${grant.grantId} belongs to turn ${grant.taskId}, not ${input.taskId}.`,
      };
    }
    const domain = normaliseDomain(input.domain);
    if (!domain || domain !== grant.domain) {
      return {
        ok: false,
        reason: "wrong_domain",
        detail:
          `Grant ${grant.grantId} is for ${grant.domain} and the page is ${input.domain || "unknown"}. ` +
          `Domains are matched exactly: a subdomain or a redirect is a different site.`,
      };
    }
    if (!grant.fields.includes(input.field)) {
      return {
        ok: false,
        reason: "field_not_granted",
        detail:
          `Grant ${grant.grantId} covers ${grant.fields.join(", ")} — not ${input.field}. ` +
          `Field sets are exact.`,
      };
    }
    if (input.mode && grant.mode !== input.mode) {
      return {
        ok: false,
        reason: "wrong_mode",
        detail:
          `Grant ${grant.grantId} was approved for ${grant.mode}, and this is a ${input.mode} ` +
          `use. A projection grant issues no handles.`,
      };
    }
    return { ok: true, grant, field: input.field };
  }

  /** Resolves a handle the agent presented, with the same checks plus the handle's own shape. */
  authorizeHandle(input: { handle: string; taskId: string; domain: string }): GrantVerdict {
    const parsed = parseHandle(input.handle);
    if (!parsed) {
      return {
        ok: false,
        reason: "unknown_grant",
        detail:
          "That is not a vault handle. A handle looks like pv:<grantId>:<field> and is issued " +
          "when a grant is approved.",
      };
    }
    return this.authorize({
      grantId: parsed.grantId,
      field: parsed.field,
      taskId: input.taskId,
      domain: input.domain,
      mode: "handle",
    });
  }

  /** What the agent is handed for a `handle` grant: one opaque reference per field. */
  handles(grant: ProfileGrant): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of grant.fields) {
      if (tierOf(field) === "L1") continue;
      out[field] = handleFor(grant.grantId, field);
    }
    return out;
  }
}

/**
 * Reduces whatever the caller has — a URL, a host, a domain — to the eTLD+1 shape a grant binds to.
 *
 * Deliberately small and strict rather than a public-suffix implementation: it rejects anything
 * with a scheme, a path, a port, a wildcard or a leading dot, and it lowercases. A real
 * public-suffix list belongs on the *caller* side, where the page's own origin is known; what this
 * refuses to do is let a loose string through as if it had been checked.
 */
export function normaliseDomain(input: string): string | null {
  const trimmed = (input ?? "").trim().toLowerCase();
  if (trimmed === "" || trimmed.includes("*") || trimmed.startsWith(".")) return null;
  if (/[\s/\\?#@:]/.test(trimmed)) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(trimmed)) return null;
  return trimmed;
}

/** The tier a grant's field sits at, for callers deciding projection vs handle. */
export function grantTier(field: string): SensitivityTier {
  return tierOf(field);
}
