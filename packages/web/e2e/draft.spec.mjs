/**
 * End-to-end test for the draft-state new-conversation flow:
 * - /chat/new lets you pick Model / approval mode up front; the Session is only created when
 *   the first message is sent, and all four selections land faithfully in its meta;
 * - the draft auto-caches (body persisted via debounce): after a page reload, both the body and
 *   the selections are restored, and the cache clears once sending succeeds;
 * - the sidebar groups conversations by Trip: one belonging to no journey lands in the
 *   scratch group;
 * - both switch commands are **staged**: `/model` and `/agent` pin a chip and send nothing, the
 *   chip is cached with the body text (it survives a reload), and pressing Enter afterwards is
 *   what actually forks the conversation onto the picked model / hands it to the picked Agent —
 *   carrying the text typed after the pick into the new conversation.
 */
import { test, expect } from "@playwright/test";
import { composer, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "draftuser";
const P = "password123";

test("draft: pick model/approval -> reload restores them -> send creates the session and clears the cache -> sidebar + scopes the Agent", async ({
  page,
}) => {
  // Draft keys are isolated by user x Project/Session (#68); building the key needs userId (i.e. the username).
  const userId = (await provisionAndLogin(page.request, U, P)).userId;

  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

  // Two models: claude-4-8 as default, plus claude-4-8-mini for the draft to switch to (both point at the mock).
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
        {
          provider: "custom",
          modelId: "claude-4-8-mini",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 100000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  // The only builtin Agent is default_agent, so the /agent handoff and sidebar group-header "+" targets use a custom-created Agent.
  const created = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: "agent_helper", name: "Helper Agent" },
  });
  expect(created.ok(), "create helper agent").toBeTruthy();

  // No Session exists yet: entering the site lands on the draft page (the brand heading marks the draft page).
  await page.goto(`${BASE}/chat`);
  await expect(page.getByRole("heading", { name: /今天想去哪里/ })).toBeVisible();

  const ta = composer(page);

  // `/agent` is a SESSION command: a draft has no conversation to hand over, and its Agent is
  // chosen by the draft page's own selector — so the slash menu must not offer it here (the
  // staged-handoff flow itself is covered in the session section below). The bare "/" opens the
  // menu with `/compact` in it — which is what makes the absent `/agent` row a real assertion
  // rather than a menu that simply never appeared. It used to anchor on `/penguin-browser`, and
  // skills no longer have slash commands: every skill here is built in, so there was nothing
  // left for a person to pick.
  await ta.fill("/");
  await expect(page.getByRole("button", { name: /^\/compact/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "/agent 交给其他 Agent，发送时开启新会话" }),
  ).toHaveCount(0);
  await ta.fill("Draft body must not be lost");

  // Switch the model: the selector sits to the left of the send button, opens downward, with a quick-search field at the top.
  await page.getByRole("button", { name: "选择模型" }).click();
  await page.getByPlaceholder(/搜索模型/).fill("mini");
  await page.getByRole("button", { name: /claude-4-8-mini/ }).click();

  // Switch the approval mode to read-only (the trigger button shows the Chinese description).
  await page.getByRole("button", { name: "审批模式" }).click();
  await page.getByRole("button", { name: /放行只读/ }).click();
  await expect(page.getByRole("button", { name: "审批模式" })).toContainText("放行只读");

  // Conversation-time thinking level (backed by the Agent settings): the picker shows the
  // seeded default (medium, short name 中); the menu carries a title bar and the short-name
  // rows 低/中/高/极高 only — no descriptions, no default row, and no 无 (many models cannot
  // disable thinking); picking 高 writes straight through to the Agent config, so the session
  // created on send runs with it and it becomes the Agent's new default.
  const thinkingBtn = page.getByRole("button", { name: "思考等级" });
  await expect(thinkingBtn).toContainText("中");
  await thinkingBtn.click();
  await expect(page.getByText("思考等级", { exact: true })).toBeVisible(); // menu title bar
  await expect(page.getByRole("button", { name: "低", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "无", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "高", exact: true }).click();
  await expect(thinkingBtn).toContainText("高");
  await expect
    .poll(async () => {
      const cfg = await (
        await page.request.get(`${BASE}/api/projects/${projectId}/agents/default_agent/config`)
      ).json();
      return cfg.config.model?.thinkingLevel;
    })
    .toBe("high");

  // Reload only after the body is persisted via debounce: both the body and the two selections should restore from the cache.
  const draftKey = `penguin.chatDraft.${userId}.${projectId}`;
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), draftKey))
    .toContain("Draft body must not be lost");

  await page.reload();
  await expect(ta).toHaveValue("Draft body must not be lost");
  // After restoring, the cursor lands at the end of the draft (focus defaults to the start, so it must be explicitly moved to the end to keep typing).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector("textarea");
        return el ? el.selectionStart === el.value.length && el.value.length > 0 : false;
      }),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "选择模型" })).toContainText("claude-4-8-mini");
  await expect(page.getByRole("button", { name: "审批模式" })).toContainText("放行只读");
  // The thinking level is NOT draft state: it restores from the Agent config (written through above), not the cache.
  await expect(page.getByRole("button", { name: "思考等级" })).toContainText("高");
  // Send: the Session is only created now, and the selections land faithfully in its meta.
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForURL(/\/chat\/session-/);
  const firstSessionId = page.url().split("/chat/")[1];
  const first = await (await page.request.get(`${BASE}/api/sessions/${firstSessionId}`)).json();
  expect(first.session.agentId).toBe("default_agent");
  expect(first.session.modelId).toBe("claude-4-8-mini");
  expect(first.session.provider).toBe("custom");
  expect(first.session.approvalMode).toBe("read-only");

  // session_meta holds per-session invariants only: the thinking level became a per-turn
  // Task parameter and is no longer recorded in the trace meta. The session composer shows
  // the editable per-turn picker instead of the old read-only tag: while the user hasn't
  // picked, it displays the Agent config's level (auto-follow — "high" was written through
  // above) and sends omit the level; a pick sticks and rides on every subsequent send.
  const replay = await (
    await page.request.get(`${BASE}/api/sessions/${firstSessionId}/messages`)
  ).json();
  const meta = replay.messages.find((m) => m.type === "session_meta");
  expect(meta?.payload?.thinking_level).toBeUndefined();
  await expect(page.getByTitle("思考等级：高")).toBeVisible();

  // On a successful send the cache clears — except the model selection, which carries over as
  // the next conversation's default (switch-becomes-default, like the thinking level above).
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), draftKey))
    .toContain("claude-4-8-mini");
  expect(await page.evaluate((k) => localStorage.getItem(k), draftKey)).not.toContain(
    "Draft body must not be lost",
  );

  // —— Trip grouping: a conversation belonging to no journey lands in the scratch group ——
  //
  // This replaced a long section on Workspace grouping — the merged "临时工作区" group, a named
  // directory's group header and its "+", pinning, and the agent-mode toggle. The sidebar groups
  // by Trip now, and the draft screen no longer asks for a Workspace or an Agent at all, so
  // every one of those affordances was asserting a product that no longer exists.
  await expect(page.getByRole("complementary").getByText("随手问", { exact: true })).toBeVisible();

  // —— A second conversation, which the per-session input draft below needs ——
  await page.getByRole("complementary").getByRole("button", { name: "新建对话" }).click();
  await expect(page.getByRole("heading", { name: /今天想去哪里/ })).toBeVisible();
  await ta.fill("First message for the second conversation");
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForURL(/\/chat\/session-/);
  const secondSessionId = page.url().split("/chat/")[1];
  expect(secondSessionId).not.toBe(firstSessionId);
  const second = await (await page.request.get(`${BASE}/api/sessions/${secondSessionId}`)).json();
  // The previously picked model carries over as the new default (switch-becomes-default);
  // approval mode falls back to allow-all (the rest of the draft was cleared, so read-only
  // does not linger).
  expect(second.session.modelId).toBe("claude-4-8-mini");
  expect(second.session.provider).toBe("custom");
  expect(second.session.approvalMode).toBe("allow-all");

  // Under allow-all the mock's exec_command is auto-approved, so the round runs to completion.
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // —— Input draft for an existing session: cached by user x Session, restored on reload, cleared once sending succeeds ——
  await ta.fill("Draft inside the session");
  const sessionKey = `penguin.chatDraft.session.${userId}.${secondSessionId}`;
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), sessionKey))
    .toContain("Draft inside the session");

  await page.reload();
  await expect(ta).toHaveValue("Draft inside the session");
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), sessionKey)).toBeNull();

  // —— /model stages the fork; Enter is what performs it ——
  // Wait for the run above to finish first: the slash menu is suppressed while a Task runs, and
  // a staged fork deliberately refuses to send until the Session is idle (it continues from a
  // Trace the run is still appending to). Two signals, in order: the second round's closing
  // text lands (this Session has now answered two messages), then the action button stops being
  // Stop — which it is for as long as a Task runs with an empty composer.
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  await ta.fill("/model");
  await ta.press("Enter");
  await expect(page.getByText("切换模型", { exact: true })).toBeVisible(); // picker title bar
  await expect(ta).toHaveValue(""); // the command consumed its own token
  await page.getByPlaceholder(/搜索模型/).fill("claude-4-8");
  // Both models match the query (one id is the other's prefix); pick the non-mini one, i.e. not
  // the model this Session already runs on.
  await page
    .getByRole("button", { name: /claude-4-8/ })
    .filter({ hasNotText: "mini" })
    .click();

  // Nothing was sent: we are still in the same Session, with the pick pinned as a chip — which
  // is why the body can be typed AFTER the pick and still ride along.
  await expect(page).toHaveURL(new RegExp(`/chat/${secondSessionId}$`));
  await expect(page.getByLabel("移除切换模型")).toBeVisible();
  await ta.fill("Fork body typed after the pick");

  // The chip is draft content, cached in the SAME entry as the text (poll on the text: it is
  // the debounced field, so its arrival means everything is flushed), and a reload restores
  // BOTH. A chip lost while its text survived would send that text to the current Session on
  // the old model — the opposite of what was staged.
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), sessionKey))
    .toContain("Fork body typed after the pick");
  expect(await page.evaluate((k) => localStorage.getItem(k), sessionKey)).toContain("claude-4-8");
  await page.reload();
  await expect(ta).toHaveValue("Fork body typed after the pick");
  await expect(page.getByLabel("移除切换模型")).toBeVisible();

  // Enter performs the fork: a NEW Session on the picked model, same Agent, carrying the body.
  await ta.press("Enter");
  await page.waitForURL(
    (url) => /\/chat\/session-/.test(url.pathname) && !url.href.endsWith(secondSessionId),
  );
  const thirdSessionId = page.url().split("/chat/")[1];
  const third = await (await page.request.get(`${BASE}/api/sessions/${thirdSessionId}`)).json();
  expect(third.session.modelId).toBe("claude-4-8");
  expect(third.session.agentId).toBe("agent_helper");
  // The source block collapses into the "switched model" banner, and the typed body follows it.
  await expect(page.getByText(/已切换模型（原为 claude-4-8-mini）/)).toBeVisible();
  await expect(page.getByText("Fork body typed after the pick")).toBeVisible();

  // —— /agent stages the handoff; Enter is what performs it ——
  // The forked Session started its own run; wait it out the same way (a fresh stream, so its
  // first closing text is the only one).
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
  await ta.fill("/agent");
  await ta.press("Enter");
  await page.getByPlaceholder(/搜索 Agent/).fill("default");
  await page.getByRole("button", { name: /default_agent/ }).click();
  // Staged only: still in the forked Session, still able to type the message to hand over.
  await expect(page).toHaveURL(new RegExp(`/chat/${thirdSessionId}$`));
  await expect(page.getByLabel("移除交接目标")).toBeVisible();
  await ta.fill("Handoff body typed after the pick");

  await ta.press("Enter");
  await page.waitForURL(
    (url) => /\/chat\/session-/.test(url.pathname) && !url.href.endsWith(thirdSessionId),
  );
  const fourthSessionId = page.url().split("/chat/")[1];
  const fourth = await (await page.request.get(`${BASE}/api/sessions/${fourthSessionId}`)).json();
  expect(fourth.session.agentId).toBe("default_agent");
  // The [handoff_from] block collapses into the origin banner (the source agent is named
  // without an @ sigil, matching the composer chip), and the typed body follows it.
  await expect(page.getByText(/由 .*agent_helper.* 的对话交接而来/)).toBeVisible();
  await expect(page.getByText("Handoff body typed after the pick")).toBeVisible();
});
