/**
 * End-to-end test for built-in skill invocation from the composer (locale zh-CN), against
 * the trimmed one-skill library (`penguin-browser`):
 * - built-in policy: every agent — default_agent and a freshly created one — comes with
 *   penguin-browser installed (no library page and no sidebar entry exist anymore; the skill
 *   ships with the agent);
 * - the toolbar's skill dropdown lists the installed skill; the search box filters by name
 *   (a non-matching query empties the list); clicking a row toggles selection **without
 *   closing the menu**, and the button shows a selected-count badge;
 * - selections are written into the draft (#74 comment): in draft state, checking the dropdown
 *   then reloading keeps both the body and the selection; in session state, selecting via slash
 *   then reloading likewise persists (keyed by user x Session);
 * - sending with a selection -> the message stream collapses the [use_skills] block into a
 *   "使用技能" ("Use skills") banner, the typed text still renders normally, the stored
 *   message really does start with the block, and the selection clears once sending succeeds;
 * - slash invocation: typing /<prefix> shows a skill command item, and pressing Enter selects
 *   that skill and clears the input box (without sending).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "skillsuser";
const P = "password123";

const SKILLS = ["penguin-browser"];

test("skills: built-in install on every agent -> dropdown filter and selection -> send banner -> slash selection", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

  // The default model points at the mock LLM (once sent, the mock provides the fallback
  // reply). The model reference is given as a pair: provider and modelId are separate fields,
  // and modelId is the upstream id verbatim (no concatenation of any kind).
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

  // —— Built-in policy: a freshly created agent comes with penguin-browser installed (the
  // preinstalled set is seeded at initialization for every agent, not just default_agent). ——
  const created = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: "agent_helper", name: "Helper Agent" },
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

  // —— The sidebar has no skill-library entry anymore (the skill is built-in, nothing to manage). ——
  await page.goto(`${BASE}/chat`);
  await expect(page.getByRole("link", { name: "智能体" })).toBeVisible();
  await expect(page.getByRole("link", { name: "技能库" })).toHaveCount(0);

  // —— Draft state: select the skill from the toolbar dropdown and type the invoke text. ——
  await page.goto(`${BASE}/chat/new`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("使用 penguin-browser 技能");

  // The toolbar's skill dropdown button (badge appears once something is selected).
  const skillsBtn = page.getByRole("button", { name: "技能", exact: true });
  await expect(skillsBtn).toBeVisible();

  // Open the menu: every installed skill occupies a row (built-in set), none selected yet.
  const row = (name) => page.getByRole("button", { name: new RegExp(`^${name}`) });
  await skillsBtn.click();
  for (const s of SKILLS) {
    await expect(row(s)).toBeVisible();
  }
  await expect(row("penguin-browser")).toHaveAttribute("aria-pressed", "false");

  // Search filter: a non-matching query empties the list; clearing it brings the row back.
  await page.getByPlaceholder("搜索技能").fill("sdk");
  await expect(row("penguin-browser")).toHaveCount(0);
  await page.getByPlaceholder("搜索技能").fill("browser");
  await expect(row("penguin-browser")).toBeVisible();
  await page.getByPlaceholder("搜索技能").fill("");

  // Clicking a row toggles its selection **without closing the menu**: select, deselect, reselect.
  await row("penguin-browser").click();
  await expect(row("penguin-browser")).toHaveAttribute("aria-pressed", "true");
  await expect(skillsBtn).toContainText("1");
  await row("penguin-browser").click();
  await expect(row("penguin-browser")).toHaveAttribute("aria-pressed", "false");
  await expect(skillsBtn).not.toContainText("1");
  await row("penguin-browser").click();
  await expect(row("penguin-browser")).toHaveAttribute("aria-pressed", "true");
  await expect(skillsBtn).toContainText("1");

  // —— Survives a reload (#74 comment): checking the dropdown writes into the draft immediately, so both the body and the selection persist after a reload ——
  await page.reload();
  await expect(ta).toHaveValue("使用 penguin-browser 技能");
  await expect(skillsBtn).toContainText("1");
  await skillsBtn.click();
  await expect(row("penguin-browser")).toHaveAttribute("aria-pressed", "true");
  // Escape closes the menu (built into the Dropdown).
  await page.keyboard.press("Escape");

  // —— Sending the body -> "使用技能" ("Use skills") banner + invoke text lands in the message ——
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForURL(/\/chat\/session-/);
  const sessionId = page.url().split("/chat/")[1];

  // Message stream: the block collapses into a "使用技能" ("Use skills") banner, and the typed
  // body "使用 penguin-browser 技能" still renders normally; the selection clears once
  // sending succeeds (the dropdown button's badge disappears).
  await expect(page.getByText(/使用技能.*penguin-browser/)).toBeVisible();
  await expect(page.getByText("使用 penguin-browser 技能", { exact: true })).toBeVisible();
  await expect(skillsBtn).not.toContainText("1");

  // The mock LLM's fallback reply completes a full round (allow-all auto-approves exec_command).
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // —— Slash invocation: typing /penguin-b shows a skill command item; pressing Enter selects it and clears the input box (without sending) ——
  await ta.fill("/penguin-b");
  await expect(page.getByRole("button", { name: /\/penguin-browser/ })).toBeVisible();
  await ta.press("Enter");
  await expect(ta).toHaveValue("");
  await expect(skillsBtn).toContainText("1");
  await skillsBtn.click();
  await expect(row("penguin-browser")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // The session-state selection is likewise written into the draft (keyed by user x Session): the selection persists after a reload.
  await page.reload();
  await expect(skillsBtn).toContainText("1");
  await skillsBtn.click();
  await expect(row("penguin-browser")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // The stored message really does start with the [use_skills] block (the banner is only a
  // rendering-layer collapse; Trace/storage keeps the raw text), with the body being the
  // typed invoke text.
  const messages = await (
    await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)
  ).json();
  const flat = JSON.stringify(messages);
  expect(flat, "stored message keeps the [use_skills] block").toContain("[use_skills]");
  expect(flat, "block lists the selected skill").toContain("skills: penguin-browser");
  expect(flat, "typed body follows the block").toContain("使用 penguin-browser 技能");
});
