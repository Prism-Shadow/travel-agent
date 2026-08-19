/**
 * The two ends of an interaction: the agent that raises a card, and the person who answers it.
 *
 * They are different surfaces with different credentials, and that is the whole reason this file
 * exists as one module — the pair is easier to reason about together than apart.
 *
 * **The agent end** (`/api/agent/*`) is authenticated by the task token in the agent's own
 * environment (see `interaction/tokens.ts`), because the caller is a subprocess with no cookie and
 * no browser. It mounts outside the cookie middleware for the same reason `/api/desktop` does. Every
 * call is bound to the session *and* the turn the token was minted for: a token that outlived its
 * turn authenticates nothing, which is the same rule Phase 2 applied to browser tabs and for the
 * same reason — a command that keeps running after its turn ended still holds a real id.
 *
 * **The person's end** lives under the session routes (`/api/sessions/:id/interactions/:id`) and is
 * the ordinary cookie-authenticated surface the chat UI already uses, with the ordinary project
 * access check. Answering a card is exactly as privileged as reading the conversation it is in.
 *
 * Nothing here decides anything: the routes validate shapes and hand off to `InteractionService`,
 * which holds the rules worth testing.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { HttpError } from "../errors.js";
import { readJson, requireEnum, requireString } from "../validate.js";
import type { AppDeps } from "../../app.js";
import type { AppEnv } from "../../auth/middleware.js";
import type {
  InteractionInput,
  InteractionOutcome,
  PaymentSummary,
  SecretField,
} from "../../api/types.js";

/** How long a waiting agent's request is held open before it is told to ask again. */
const MAX_WAIT_MS = 120_000;

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", `${what} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${key} must be a string.`);
  }
  return value;
}

/**
 * The turn a token names, or a 401.
 *
 * The session id is taken from the request and then *checked against the token* rather than
 * trusted: a token is minted for one conversation's turn, and a caller naming another conversation
 * is either confused or trying, and both get the same answer.
 */
function authorizeAgent(deps: AppDeps, c: Context, sessionId: string): { taskId: string } {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const entry = deps.manager.interactionTokens.verify(sessionId, token);
  if (!entry) {
    throw new HttpError(
      401,
      "unauthorized",
      "This request needs the interaction token of a running turn. It is in the environment of " +
        "the commands this turn starts (PENGUIN_INTERACTION_TOKEN) and stops working when the " +
        "turn ends.",
    );
  }
  return { taskId: entry.taskId };
}

/** Reads a payment summary from an agent's request, leaving the seven-field check to the builder. */
function readPaymentSummary(record: Record<string, unknown>, taskId: string): PaymentSummary {
  const payment = asRecord(record.payment, "payment");
  const merchant = asRecord(payment.merchant, "payment.merchant");
  const amount = asRecord(payment.amount, "payment.amount");
  const cancellation = asRecord(payment.cancellation, "payment.cancellation");
  const method = asRecord(payment.paymentMethod, "payment.paymentMethod");
  if (typeof amount.value !== "number" || !Number.isFinite(amount.value)) {
    throw new HttpError(400, "invalid_request", "payment.amount.value must be a finite number.");
  }
  return {
    merchant: {
      name: requireString(merchant, "name", { maxLen: 200 }),
      domain: requireString(merchant, "domain", { maxLen: 253 }),
    },
    item: requireString(payment, "item", { maxLen: 500 }),
    amount: { value: amount.value, currency: requireString(amount, "currency", { maxLen: 8 }) },
    cancellation: {
      summary: requireString(cancellation, "summary", { maxLen: 2000 }),
      ...(optionalString(cancellation, "url") ? { url: optionalString(cancellation, "url")! } : {}),
    },
    paymentMethod: {
      alias: requireString(method, "alias", { maxLen: 120 }),
      ...(optionalString(method, "brand") ? { brand: optionalString(method, "brand")! } : {}),
      ...(optionalString(method, "last4") ? { last4: optionalString(method, "last4")! } : {}),
    },
    // Carried through as written; the ceiling and the validity of it are decided by
    // `InteractionService.confirmationExpiry`, which is the one place that knows what "now" is.
    expiresAt: optionalString(payment, "expiresAt") ?? "",
    taskId,
  };
}

/** Builds the interaction input from an agent request, kind by kind. */
function readInteractionInput(
  deps: AppDeps,
  record: Record<string, unknown>,
  taskId: string,
): InteractionInput {
  const kind = requireEnum(record, "kind", [
    "info_request",
    "selection",
    "commitment_confirmation",
    "secret_entry",
    "human_challenge",
    "browser_takeover",
  ] as const);
  const ask = requireString(record, "ask", { maxLen: 2000 });
  const summary = optionalString(record, "summary") ?? "";
  const timeoutMs = typeof record.timeoutMs === "number" ? record.timeoutMs : undefined;

  const base = { ask, summary, taskId, ...(timeoutMs ? { timeoutMs } : {}) };

  switch (kind) {
    case "info_request":
      return { ...base, kind };
    case "selection": {
      if (!Array.isArray(record.options)) {
        throw new HttpError(400, "invalid_request", "selection needs an options array.");
      }
      const options = record.options.map((raw, index) => {
        const option = asRecord(raw, `options[${index}]`);
        return {
          id: requireString(option, "id", { maxLen: 120 }),
          label: requireString(option, "label", { maxLen: 300 }),
          rationale: requireString(option, "rationale", { maxLen: 300 }),
          plan: (option.plan ?? {}) as Record<string, unknown>,
        };
      });
      return { ...base, kind, options };
    }
    case "commitment_confirmation": {
      const summaryInput = readPaymentSummary(record, taskId);
      // Validated and clamped rather than taken: an agent may shorten the window, never lengthen
      // it, and a malformed or already-past expiry is a 400 rather than a card that lies about
      // how long the person has.
      const expiresAt = deps.interactions.confirmationExpiry(summaryInput.expiresAt || undefined);
      return {
        ...base,
        kind,
        payment: { ...summaryInput, expiresAt },
      };
    }
    case "secret_entry": {
      const field = requireEnum(record, "field", [
        "cvv",
        "otp",
        "three_d_secure",
        "card_number",
        "payment_password",
        "passkey",
      ] as const) as SecretField;
      // `live` is never taken from the request. The agent does not get to decide whether the app
      // fills a one-time code: that is a product decision behind two flags, and in this phase both
      // are off, so the card explains what is needed and the person types it themselves.
      return {
        ...base,
        kind,
        field,
        purpose: requireString(record, "purpose", { maxLen: 500 }),
        live: false,
      };
    }
    case "human_challenge":
      return {
        ...base,
        kind,
        ...(optionalString(record, "targetSelector")
          ? { targetSelector: optionalString(record, "targetSelector")! }
          : {}),
      };
    case "browser_takeover":
      return {
        ...base,
        kind,
        reason: requireString(record, "reason", { maxLen: 500 }),
        ...(optionalString(record, "targetSelector")
          ? { targetSelector: optionalString(record, "targetSelector")! }
          : {}),
      };
  }
}

/** Reads the outcome a person submitted from the chat UI. */
export function readInteractionOutcome(body: unknown): InteractionOutcome {
  const record = asRecord(body, "body");
  const status = requireEnum(record, "status", ["answered", "declined"] as const);
  if (status === "declined") {
    const message = optionalString(record, "message");
    return { status, ...(message ? { message } : {}) };
  }
  const values = record.values ? asRecord(record.values, "values") : null;
  return {
    status: "answered",
    ...(optionalString(record, "value") ? { value: optionalString(record, "value")! } : {}),
    ...(values
      ? { values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])) }
      : {}),
    ...(optionalString(record, "optionId")
      ? { optionId: optionalString(record, "optionId")! }
      : {}),
    ...(typeof record.approved === "boolean" ? { approved: record.approved } : {}),
    ...(optionalString(record, "message") ? { message: optionalString(record, "message")! } : {}),
  };
}

/**
 * The agent's surface.
 *
 * Mounted outside the cookie middleware, exactly like the desktop shutdown route, and every
 * handler starts by resolving its token to a running turn.
 */
export function agentInteractionRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Raise a card. Returns its id; the answer is fetched separately. */
  app.post("/interactions", async (c) => {
    const body = asRecord(await readJson(c), "body");
    const sessionId = requireString(body, "sessionId", { maxLen: 120 });
    const { taskId } = authorizeAgent(deps, c, sessionId);
    const locator = deps.manager.locate(sessionId);
    if (!locator) throw new HttpError(404, "session_not_found", "Session does not exist.");

    let input: InteractionInput;
    try {
      input = readInteractionInput(deps, body, taskId);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "invalid_request", (error as Error).message);
    }

    try {
      const interaction = deps.interactions.request(locator, input);
      return c.json({
        interactionId: interaction.id,
        kind: interaction.kind,
        expiresInMs: interaction.timeoutMs,
      });
    } catch (error) {
      // The builder's refusals are contract violations by the caller — a takeover with no reason,
      // a purchase with no cancellation terms — so they are the agent's to fix, not a 500.
      throw new HttpError(400, "invalid_interaction", (error as Error).message);
    }
  });

  /**
   * Wait for the answer.
   *
   * Long-polls, and re-attaching is safe: the registry remembers a settled outcome, so a command
   * whose socket died still learns what the person said instead of asking them again.
   */
  app.get("/interactions/:interactionId", async (c) => {
    const sessionId = c.req.query("sessionId") ?? "";
    authorizeAgent(deps, c, sessionId);
    const locator = deps.manager.locate(sessionId);
    if (!locator) throw new HttpError(404, "session_not_found", "Session does not exist.");

    const interactionId = c.req.param("interactionId");
    const budget = Math.min(
      Number(c.req.query("waitMs") ?? MAX_WAIT_MS) || MAX_WAIT_MS,
      MAX_WAIT_MS,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    timer.unref?.();
    try {
      const outcome = await deps.interactions.awaitOutcome(
        locator,
        interactionId,
        controller.signal,
      );
      return c.json({ outcome });
    } catch {
      throw new HttpError(404, "interaction_not_found", "No such interaction in this session.");
    } finally {
      clearTimeout(timer);
    }
  });

  return app;
}
