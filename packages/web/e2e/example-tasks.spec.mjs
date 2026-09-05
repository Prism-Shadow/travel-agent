/** Starter cards prepare an editable draft; only the composer can start the task. */
import { test, expect } from "@playwright/test";
import { composer, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const RUN = Date.now().toString(36);

for (const locale of ["en", "zh"]) {
  test(`${locale}: all three starters fill the draft and wait for an explicit send`, async ({
    page,
  }) => {
    await page.addInitScript((lang) => localStorage.setItem("penguin.lang", lang), locale);
    await page.setViewportSize(
      locale === "en" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    );
    const user = `starter${locale}${RUN}`;
    await provisionAndLogin(page.request, user, "password123");
    const project = `${user}-default_project`;
    const configureModel = async () => {
      const response = await page.request.put(`${BASE}/api/projects/${project}/models`, {
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
      expect(response.ok()).toBe(true);
    };
    // Exercise both configured models and a first visit with no model configured.
    if (locale === "en") await configureModel();
    const writes = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/(sessions|tasks|trips)$/.test(request.url())) {
        writes.push(request);
      }
    });
    await page.goto(`${BASE}/chat/new`);
    if (locale === "zh") {
      await page.getByRole("button", { name: "稍后再说", exact: true }).click();
    }
    const input = composer(page);
    await input.fill("An unfinished idea");
    const cards =
      locale === "en"
        ? [
            ["Book tomorrow's flight on Ctrip", /^I'm going to Shanghai.*service bundles\.$/],
            ["Compare Ctrip and Fliggy prices", /^下周六.*等我选择后再继续预定$/],
            ["Turn Xiaohongshu guides into a trip", /^搜索上海出发.*预算400以内一晚。$/],
          ]
        : [
            ["在携程订明天的机票", /^我准备明天去上海出差.*不要多余的服务包。$/],
            ["携程飞猪多标签比价", /^下周六.*等我选择后再继续预定$/],
            ["把小红书攻略变成一趟旅行", /^搜索上海出发.*预算400以内一晚。$/],
          ];
    for (const [name, prompt] of cards) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(input).toHaveValue(prompt);
      await expect(input).toBeFocused();
      // Typing immediately must append at the end, rather than replacing a selected prompt.
      const selected = await input.inputValue();
      await input.pressSequentially(" Please keep the pace relaxed.");
      await expect(input).toHaveValue(`${selected} Please keep the pace relaxed.`);
      await expect(page).toHaveURL(/\/chat\/new$/);
    }

    const edited = await input.inputValue();
    const key = `penguin.chatDraft.${user}.${project}`;
    await expect
      .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}").text, key))
      .toBe(edited);
    if (locale === "zh") await configureModel();
    await page.reload();
    await expect(input).toHaveValue(edited);
    expect(writes).toHaveLength(0);
    const sessionList = await page.request.get(
      `${BASE}/api/projects/${project}/agents/default_agent/sessions`,
    );
    expect(sessionList.ok()).toBe(true);
    const sessions = await sessionList.json();
    expect(sessions.sessions).toHaveLength(0);

    await page
      .getByRole("button", { name: locale === "en" ? "Send" : "发送", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chat\/session-/);
    await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();
    expect(writes.filter((request) => request.url().endsWith("/sessions"))).toHaveLength(1);
    const tasks = writes.filter((request) => request.url().endsWith("/tasks"));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].postDataJSON().input).toEqual([{ type: "text", text: edited }]);
    await expect
      .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}").text, key))
      .not.toBe(edited);
  });
}
