/**
 * Chat tweaks:
 * - the chat details card shows the Session id as a click-to-copy row (label flips to
 *   "已复制").
 *
 * The schedule-form section was removed: the Agent settings page (and its schedules tab)
 * no longer exists in the consumer surface (removed in eff07d2–0956fb9).
 */
import { test, expect } from "@playwright/test";
import { composer, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "tweakuser";
const P = "password123";

test("details Session-id copy", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
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

  // A session to open in chat for the details card.
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  // --- Details card Session id + copy ---
  // The id is selectable mono text with the copy button beside it (not inside it); the
  // "已复制" feedback appears AT the button (text), and the "Session id" label is untouched.
  await page.goto(`${BASE}/chat/${sessionId}`);
  await composer(page).waitFor();
  await page.locator('button[title="Session 信息"]').click();
  await expect(page.getByText(sessionId, { exact: true }).first()).toBeVisible();
  const copyBtn = page.getByRole("button", { name: "复制 Session id" });
  await copyBtn.click();
  await expect(copyBtn).toContainText("已复制");
  // The section label above the id is not the feedback target — it stays "Session id".
  await expect(page.getByText("Session id", { exact: true })).toBeVisible();
});
