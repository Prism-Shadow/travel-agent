/**
 * End-to-end test for built-in skills (locale zh-CN), against the trimmed one-skill library
 * (`penguin-browser`):
 * - built-in policy: every agent — default_agent and a freshly created one — comes with
 *   penguin-browser installed (no library page and no sidebar entry exist anymore; the skill
 *   ships with the agent);
 * - **nothing offers the person a skill to choose.** There is no toolbar dropdown and no
 *   `/<skill_name>` command, in draft state or in session state. Every skill here is built in
 *   and the model finds the one it needs by reading the library, so a chooser only asked a
 *   traveller a question the engine answers better — and a selection nothing displays is a
 *   state they can neither see nor undo.
 *
 * The `[use_skills]` block itself is not gone: the home screen's starter cards still name the
 * skill their scenario needs, and messages carrying the block still render as a banner. That
 * path is covered by the marker unit tests (`test/skill-use.test.ts`).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = "skillsuser";
const P = "password123";

const SKILLS = ["penguin-browser"];

test("skills: built-in on every agent, and nowhere for a person to choose one", async ({
  page,
}) => {
  const { projectId } = await provisionAndLogin(page, { username: U, password: P });

  // —— Built-in policy: the skill ships with every agent, including one created just now. ——
  const created = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: "agent_helper", name: "helper" },
  });
  expect(created.ok(), "create helper agent").toBeTruthy();
  for (const agentId of ["default_agent", "agent_helper"]) {
    const res = await (
      await page.request.get(`${BASE}/api/projects/${projectId}/agents/${agentId}/skills`)
    ).json();
    expect(
      res.skills.map((s) => s.name),
      `${agentId} built-in skills`,
    ).toEqual(SKILLS);
  }

  // —— The sidebar has no skill-library entry (the skill is built-in, nothing to manage). ——
  await page.goto(`${BASE}/chat`);
  await expect(page.getByRole("link", { name: "智能体" })).toBeVisible();
  await expect(page.getByRole("link", { name: "技能库" })).toHaveCount(0);

  // —— Draft state: no picker in the toolbar, and no slash command for a skill. ——
  await page.goto(`${BASE}/chat/new`);
  const ta = page.getByPlaceholder(/输入消息|告诉我/);
  await ta.waitFor();
  await expect(page.getByRole("button", { name: "技能", exact: true })).toHaveCount(0);
  await expect(page.locator('button[aria-label="Skills"]')).toHaveCount(0);

  // A slash still opens the command menu — it just never offers a skill.
  await ta.fill("/penguin-b");
  await expect(page.getByRole("button", { name: /\/penguin-browser/ })).toHaveCount(0);
  await ta.fill("");

  // —— Session state: same, on the docked composer. ——
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();
  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  const sessionTa = page.getByPlaceholder(/输入消息/);
  await sessionTa.waitFor();
  await expect(page.getByRole("button", { name: "技能", exact: true })).toHaveCount(0);
  await sessionTa.fill("/penguin-b");
  await expect(page.getByRole("button", { name: /\/penguin-browser/ })).toHaveCount(0);
  await sessionTa.fill("");

  // —— An ordinary send carries no [use_skills] block, because nothing could have added one. ——
  await sessionTa.fill("你好");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("你好", { exact: true })).toBeVisible();
  const messages = await (
    await page.request.get(`${BASE}/api/sessions/${sess.session.sessionId}/messages`)
  ).json();
  expect(JSON.stringify(messages), "no marker block reaches storage").not.toContain("[use_skills]");
});
