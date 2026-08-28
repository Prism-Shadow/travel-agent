/**
 * Regression (#68): switching accounts in the same browser must keep draft caches isolated per user.
 *
 * Old bug: the draft key only included the Project/Session ID, with no user dimension. If user A
 * left an unsent draft in a shared Project and logged out, user B logging in and visiting the
 * same Project would restore A's body and selections — an info leak across accounts. After the
 * fix, the key includes userId (penguin.chatDraft.<userId>.<projectId>), so each account only sees its own draft.
 */
import { test, expect } from "@playwright/test";
import { composer, provisionAndLogin, provisionUser } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const P = "password123";
const UA = "draftowner";
const UB = "draftguest";

test("switching accounts: B does not restore A's draft; both drafts coexist", async ({ page }) => {
  // A is provisioned and logged in (page's cookie belongs to A); B is only provisioned, logging in via the UI later. userId is the username.
  const userA = (await provisionAndLogin(page.request, UA, P)).userId;
  await provisionUser(UB, P);
  const userB = UB;

  // Configure a model on A's initial Project (missing credentials would trigger the onboarding
  // prompt), then add B as a member (shared Project). After logging in, B lands on projects[0] —
  // the list is sorted by creation time ascending, and A's Project is older, exactly reproducing the issue's scenario.
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  const add = await page.request.post(`${BASE}/api/projects/${projectId}/members`, {
    data: { userId: UB },
  });
  expect(add.ok(), "add member").toBeTruthy();

  // A types a body on the draft page and waits for debounce to persist it under A's key; after a reload it restores as usual (confirming it was persisted).
  await page.goto(`${BASE}/chat`);
  const ta = composer(page);
  await ta.fill("A's secret draft");
  const keyA = `penguin.chatDraft.${userA}.${projectId}`;
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), keyA))
    .toContain("A's secret draft");
  await page.reload();
  await expect(ta).toHaveValue("A's secret draft");

  // A logs out from the bottom-left user menu. Scoped to the sidebar rather than taken as the
  // last page-wide match: the Project switcher used to carry the same name (a lone Project's
  // display name defaults to the username) and no longer renders at all when there is only one,
  // so "the last one" is now whatever else happens to be on the page.
  await page.getByRole("complementary").getByRole("button", { name: UA }).click();
  await page.getByRole("button", { name: "登出" }).click();
  await page.waitForURL(/\/login/);

  // B logs in on the same browser, landing on the draft page for the shared Project.
  await page.getByLabel("用户名").fill(UB);
  // `密码*` — the required marker is part of the label text, so an exact match on 密码 finds
  // nothing. Anchored instead: a bare substring would also hit the show/hide toggle button
  // beside the field, whose aria-label is 显示密码.
  await page.getByLabel(/^密码\*?$/).fill(P);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/chat/);
  await expect(page.getByRole("heading", { name: /今天想去哪里/ })).toBeVisible();

  // The leak's regression point: B's input area must be empty (before the fix, it would restore A's body and selections).
  await expect(ta).toHaveValue("");

  // B writes their own draft: it lands under B's key (the key includes projectId, confirming B
  // is on the same shared Project), while A's draft is left untouched — neither overwrites the other.
  await ta.fill("B's own draft");
  const keyB = `penguin.chatDraft.${userB}.${projectId}`;
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), keyB))
    .toContain("B's own draft");
  expect(await page.evaluate((k) => localStorage.getItem(k), keyA)).toContain("A's secret draft");
});
