/**
 * Where a broker call meets the vault — and where the caller's claims meet the truth.
 *
 * The wire carries a `domain` and a `targetId` because design/003 §11.2 requires every call to be
 * bound to one. This module is the reason those bindings are worth anything: it does not *trust*
 * them, it **compares** them. Main resolves the tab the turn is actually working in, reads the page
 * that tab is actually on, and refuses when either differs from what the caller said.
 *
 * That single check is what makes a redirect visible. An agent that believed it was on `ctrip.com`
 * and is in fact on a payment page somewhere else does not get a fill; it gets a refusal that says
 * which two domains disagreed, and the audit log gets the same pair.
 *
 * Everything below returns refusals as values. The only thing that throws is a genuine fault, and
 * the broker turns that into an `internal` response that says nothing about what main was holding.
 */
import type { BrokerRequest, BrokerResponse } from "@prismshadow/penguin-server/broker-protocol";

import type { VaultAudit } from "./audit.js";
import type { GrantMode, GrantRegistry, ProfileGrant } from "./grants.js";
import { normaliseDomain } from "./grants.js";
import type { PaymentAuthority } from "./payment-authority.js";
import type { SecureFiller } from "./secure-fill.js";
import type { ProfileVault } from "./store.js";
import { tierOf } from "./tiers.js";

/** What the person decided when asked for access to some fields. */
export type GrantDecision =
  { approved: true; fields: string[]; full?: string[] } | { approved: false; reason?: string };

export interface BrokerHandlerDeps {
  vault: ProfileVault;
  grants: GrantRegistry;
  filler: SecureFiller;
  payments: PaymentAuthority;
  audit?: VaultAudit | null;
  /** The tab this turn is working in, when the call says "current". */
  currentTarget: (input: { sessionId: string; taskId: string }) => Promise<string | null>;
  /** The eTLD+1 of the page that tab is on *now*, as main reads it. */
  pageDomain: (input: { targetId: string }) => Promise<string | null>;
  /**
   * Puts the question in front of the person and waits.
   *
   * Wired to the interaction card in the shell. Separated so this module can be exercised without
   * a window, and so that "who asked" is one named dependency rather than a call into the UI from
   * inside a security check.
   */
  askForGrant: (input: {
    sessionId: string;
    taskId: string;
    domain: string;
    purpose: string;
    fields: string[];
    mode: GrantMode;
  }) => Promise<GrantDecision>;
}

export function createBrokerHandlers(deps: BrokerHandlerDeps) {
  return {
    request_grant: (call: Extract<BrokerRequest, { op: "request_grant" }>) =>
      requestGrant(deps, call),
    secure_fill: (call: Extract<BrokerRequest, { op: "secure_fill" }>) => secureFill(deps, call),
    execute_payment: (call: Extract<BrokerRequest, { op: "execute_payment" }>) =>
      executePayment(deps, call),
  };
}

/** A refusal in the broker's shape. `refused` is the code for "allowed to ask, answer is no". */
function refuse(message: string, detail: string[] = []): BrokerResponse {
  return { ok: false, code: "refused", message, ...(detail.length > 0 ? { detail } : {}) };
}

/**
 * Resolves the tab and the page, and refuses when the caller's claim does not match.
 *
 * Returns the *true* domain, never the claimed one — every check downstream of here runs against
 * what main can see.
 */
async function resolveTarget(
  deps: BrokerHandlerDeps,
  call: BrokerRequest,
  requestedTarget?: string,
): Promise<
  { ok: true; targetId: string; domain: string } | { ok: false; response: BrokerResponse }
> {
  const targetId =
    requestedTarget && requestedTarget !== "current"
      ? requestedTarget
      : await deps.currentTarget({ sessionId: call.sessionId, taskId: call.taskId });

  if (!targetId) {
    return {
      ok: false,
      response: refuse(
        "This turn has no page open, so there is nothing to check a permission against.",
      ),
    };
  }

  const actual = normaliseDomain((await deps.pageDomain({ targetId })) ?? "");
  if (!actual) {
    return {
      ok: false,
      response: refuse(
        `The page in ${targetId} could not be read, so its site cannot be confirmed. Refusing ` +
          `rather than assuming it is the right one.`,
      ),
    };
  }

  const claimed = normaliseDomain(call.domain);
  if (claimed !== actual) {
    await deps.audit?.append("fill_rejected", {
      sessionId: call.sessionId,
      taskId: call.taskId,
      domain: actual,
      targetId,
      reason: "domain_claim_mismatch",
      outcome: `claimed ${call.domain}`,
    });
    return {
      ok: false,
      response: refuse(
        `That call is for ${call.domain}, and the page is on ${actual}. The site is judged by ` +
          `what the application can see, not by what the request says — if the page moved, stop ` +
          `and tell the person.`,
      ),
    };
  }

  return { ok: true, targetId, domain: actual };
}

async function requestGrant(
  deps: BrokerHandlerDeps,
  call: Extract<BrokerRequest, { op: "request_grant" }>,
): Promise<BrokerResponse> {
  const resolved = await resolveTarget(deps, call);
  if (!resolved.ok) return resolved.response;

  if (!deps.vault.unlocked) {
    return refuse(
      "The vault is locked, so there is nothing to grant access to. The person can unlock it in " +
        "settings, or type the details themselves.",
    );
  }

  // Asked before anything is decided: a grant is a person's decision, and this is the only place
  // that decision is made.
  await deps.audit?.append("grant_requested", {
    sessionId: call.sessionId,
    taskId: call.taskId,
    domain: resolved.domain,
    fields: call.fields,
    purpose: call.purpose,
  });

  const decision = await deps.askForGrant({
    sessionId: call.sessionId,
    taskId: call.taskId,
    domain: resolved.domain,
    purpose: call.purpose,
    fields: call.fields,
    mode: call.mode,
  });

  if (!decision.approved) {
    await deps.grants.deny({
      taskId: call.taskId,
      domain: resolved.domain,
      fields: call.fields,
      purpose: call.purpose,
    });
    return refuse(
      decision.reason?.trim()
        ? `The person declined: ${decision.reason}`
        : "The person declined. Ask for what you need in the conversation instead, or continue " +
            "without it.",
    );
  }

  // Only what they approved — never what was asked for. A card the person narrowed is the whole
  // point of asking.
  const approvedFields = decision.fields.filter((field) => call.fields.includes(field));
  if (approvedFields.length === 0) {
    return refuse("Nothing was approved.");
  }

  let grant: ProfileGrant;
  try {
    grant = await deps.grants.approve({
      taskId: call.taskId,
      domain: resolved.domain,
      purpose: call.purpose,
      fields: approvedFields,
      mode: call.mode,
      channel: "card",
    });
  } catch (error) {
    return refuse((error as Error).message);
  }

  const projection =
    call.mode === "projection"
      ? await deps.vault.project(approvedFields, {
          grantId: grant.grantId,
          ...(decision.full ? { full: decision.full } : {}),
        })
      : {};

  return {
    ok: true,
    result: {
      grantId: grant.grantId,
      domain: grant.domain,
      expiresAt: grant.expiresAt,
      mode: grant.mode,
      /** L1 values, masked per the table. Empty for a handle grant. */
      projection,
      /** Opaque references for everything that may only be typed, never read. */
      handles: deps.grants.handles(grant),
      /** What was asked for and not approved, so the agent can stop asking for it. */
      declined: call.fields.filter((field) => !approvedFields.includes(field)),
      tiers: Object.fromEntries(approvedFields.map((field) => [field, tierOf(field)])),
    },
  };
}

async function secureFill(
  deps: BrokerHandlerDeps,
  call: Extract<BrokerRequest, { op: "secure_fill" }>,
): Promise<BrokerResponse> {
  const resolved = await resolveTarget(deps, call, call.targetId);
  if (!resolved.ok) return resolved.response;

  const result = await deps.filler.fill({
    handle: call.handle,
    taskId: call.taskId,
    target: {
      targetId: resolved.targetId,
      selector: call.selector,
      domain: resolved.domain,
    },
  });

  if (!result.ok) return refuse(`${result.reason}: ${result.detail}`);
  // Deliberately says only that it worked, and for which field name.
  return { ok: true, result: { filled: true, field: result.field } };
}

async function executePayment(
  deps: BrokerHandlerDeps,
  call: Extract<BrokerRequest, { op: "execute_payment" }>,
): Promise<BrokerResponse> {
  const resolved = await resolveTarget(deps, call);
  if (!resolved.ok) return resolved.response;

  const outcome = await deps.payments.execute({
    capabilityId: call.capabilityId,
    taskId: call.taskId,
    sessionId: call.sessionId,
    domain: resolved.domain,
    action: call.action,
    actualPlan: call.actualPlan,
  });

  if (outcome.status === "refused") {
    return { ok: false, code: "refused", message: outcome.reason, detail: outcome.detail };
  }
  return {
    ok: true,
    result: { paid: true, replayed: outcome.replayed, outcome: outcome.outcome },
  };
}
