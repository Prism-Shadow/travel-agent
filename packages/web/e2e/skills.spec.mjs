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
import { composer, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "skillsuser";
const P = "password123";

// The full built-in set, asserted by name and sorted: this list is the contract between the
// skills package and every agent created here, and a skill added or renamed must show up as a
// failure right here rather than silently changing what ships.
const SKILLS = ["amap-lbs-skill", "penguin-browser", "trip-workspace"];

test("skills: built-in on every agent, and nowhere for a person to choose one", async ({
  page,
}) => {
  // `provisionAndLogin(ctx, userId, password)` takes a request context and two positional
  // arguments, and returns the user — not the project. The project is looked up separately, as
  // every other spec here does.
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

  // The default model has to point at the mock LLM, or the send below reaches nothing.
  await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          baseUrl: `${MOCK}/v1`,
          apiKey: "test",
          api: "anthropic-messages",
        },
      ],
    },
  });

  // —— Built-in policy: the skill ships with every agent, including one created just now. ——
  const created = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: "agent_helper", name: "helper" },
  });
  // 409 is "already exists", which is success for what this asserts: the built-in set is checked
  // on an agent that exists, not on one this run happened to create. Tolerating it lets the spec
  // be re-run against a server that is already seeded — the same idempotency `provisionUser` uses.
  expect(
    created.ok() || created.status() === 409,
    `create helper agent: ${created.status()}`,
  ).toBeTruthy();
  for (const agentId of ["default_agent", "agent_helper"]) {
    const res = await (
      await page.request.get(`${BASE}/api/projects/${projectId}/agents/${agentId}/skills`)
    ).json();
    expect(res.skills.map((s) => s.name).sort(), `${agentId} built-in skills`).toEqual(SKILLS);
  }

  // —— The sidebar has no skill-library entry (the skill is built-in, nothing to manage). ——
  //
  // Nor an Agents link: the engine's own surfaces — agents, models, settings — moved behind the
  // single developer-console entry when the sidebar became a list of trips. What a traveller
  // sees at this level is trips and conversations, and nothing that names the machinery.
  await page.goto(`${BASE}/chat`);
  // The consumer sidebar shows only the Models link (engine consoles were removed); verify
  // the sidebar is loaded, and no Skills Library or Agents link is exposed.
  await expect(page.getByRole("link", { name: "模型配置" })).toBeVisible();
  await expect(page.getByRole("link", { name: "技能库" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "智能体" })).toHaveCount(0);

  // —— Draft state: no picker in the toolbar, and no slash command for a skill. ——
  await page.goto(`${BASE}/chat/new`);
  // The draft screen has its own placeholder: it asks where you want to go, not how to operate a
  // text box. `inputPlaceholder` is what an active conversation shows.
  const ta = page.getByPlaceholder(/告诉我想去哪里/);
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
  const sessionTa = composer(page);
  await sessionTa.waitFor();
  await expect(page.getByRole("button", { name: "技能", exact: true })).toHaveCount(0);
  await sessionTa.fill("/penguin-b");
  await expect(page.getByRole("button", { name: /\/penguin-browser/ })).toHaveCount(0);
  await sessionTa.fill("");

  // —— An ordinary send carries no [use_skills] block, because nothing could have added one. ——
  await sessionTa.fill("你好");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("你好", { exact: true })).toBeVisible();
  // Scoped to the user's own message, not the whole payload. The literal `[use_skills]` also
  // appears in the system prompt, where the Skills section explains that a message may begin with
  // one — so a substring search over the transcript matches every session ever recorded and
  // proves nothing about this one.
  // The bubble is optimistic; its visibility does not establish server persistence.
  // Wait for the stored message before asserting what was delivered to the model.
  let userText = "";
  await expect
    .poll(
      async () => {
        const messages = await (
          await page.request.get(`${BASE}/api/sessions/${sess.session.sessionId}/messages`)
        ).json();
        userText = messages.messages
          .filter((m) => m.type === "model_msg" && m.payload?.role === "user")
          .map((m) => m.payload?.text ?? "")
          .join("\n");
        return userText;
      },
      { message: "the user message reached storage" },
    )
    .toContain("你好");
  expect(userText, "no marker block was added to it").not.toContain("[use_skills]");
});
