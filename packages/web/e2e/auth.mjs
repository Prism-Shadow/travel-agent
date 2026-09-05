/**
 * e2e auth helper: with signup disabled, test users are always provisioned via
 * the built-in admin account, then logged in. The constants below are the
 * product's fixed initial credentials (server INITIAL_ADMIN_CREDENTIALS); run.sh
 * starts the e2e server on a fresh data root without pinning a password, so the
 * suite signs in through the same seed path a real installation uses.
 * A single e2e run shares one data root, and provisioning is idempotent
 * (reuses the user if it already exists) so a single spec can be rerun on its
 * own.
 */
import { request } from "@playwright/test";

const BASE = process.env.BASE_URL;
export const ADMIN_ID = "traveler";
export const ADMIN_PASSWORD = "traveler-2026";

/** Log in: the cookie lands in the given request context (page.request is the browser context); returns user. */
export async function login(ctx, userId, password) {
  const res = await ctx.post(`${BASE}/api/auth/login`, { data: { userId, password } });
  if (!res.ok()) {
    throw new Error(`login ${userId} failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()).user;
}

/** Admin creates the user (409 is treated as already-exists, idempotent). */
export async function provisionUser(userId, password) {
  const adminCtx = await request.newContext();
  await login(adminCtx, ADMIN_ID, ADMIN_PASSWORD);
  const created = await adminCtx.post(`${BASE}/api/admin/users`, { data: { userId, password } });
  if (!created.ok() && created.status() !== 409) {
    throw new Error(`create user ${userId} failed: ${created.status()} ${await created.text()}`);
  }
  await adminCtx.dispose();
}

/** Provision the user and log ctx in as them; returns user. */
export async function provisionAndLogin(ctx, userId, password) {
  await provisionUser(userId, password);
  return login(ctx, userId, password);
}

/**
 * The composer textarea, wherever it is.
 *
 * Two placeholders, not one: the draft screen asks where you want to go
 * (`draftInputPlaceholder`), and an active conversation explains the text box
 * (`inputPlaceholder`). Both locales are covered because specs set either. Every spec that
 * reaches `/chat/new` needs this rather than the session placeholder — thirty-three call sites
 * hard-coded the session one and every one of them timed out the day the draft screen got a
 * voice of its own.
 */
export function composer(page) {
  return page.getByPlaceholder(/输入消息|告诉我想去哪里|Type a message|Tell me where/);
}
