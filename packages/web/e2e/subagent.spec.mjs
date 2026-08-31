/**
 * Subagent chips: a spawned child session leaves a full-width shortcut row in the main stream,
 * and clicking it opens the child's OWN conversation (`/chat/<childId>`) — a subagent session
 * is an ordinary session, and that ordinary view is where its pending approvals are answered.
 * (The subagents side panel, its call graph and its auto-open were retired; the chip and the
 * sidebar's Subagents folder are the ways in.)
 *
 * Verifies: the chip appears live and survives reloads (the parent Trace stores only a
 * session_meta pointer; the server expands the child Trace on history rebuild); chip click
 * navigates to the child conversation, live and after completion (deep-link self-heal loads a
 * child that was never in the sidebar's fetched pages); an approval INSIDE the child stays
 * discoverable via the chip's 待审批 badge and is answered INLINE under the chip — the spawn
 * runs inside the parent's task, so the child's own page holds no live approval; the
 * child-session title generated from the child's own conversation; source=subagent in the
 * child's Trace and in the category listing; and the draft flow (/chat/new): a child spawned
 * by the session born from the draft leaves a working chip.
 *
 * Standalone spec: shares one server with chat.spec.mjs, so it registers its own users here
 * (registration auto-provisions a `project-<8hex>`), independent of chat.spec's execution order.
 */
import { test, expect } from "@playwright/test";
import { composer, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const P = "password123";

/** Register a user, wire the mock model into their auto-provisioned Project, and create one session. */
async function provisionSession(page, username, sessionOverrides = {}) {
  await provisionAndLogin(page.request, username, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  expect(projects.projects, "auto-provisioned project").toHaveLength(1);
  const projectId = projects.projects[0].projectId;

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

  const agentId = "default_agent";
  const sessRes = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/${agentId}/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8", ...sessionOverrides } },
  );
  expect(sessRes.ok(), `create session: ${await sessRes.text()}`).toBeTruthy();
  const sess = await sessRes.json();
  return { projectId, agentId, sessionId: sess.session.sessionId };
}

/** The subagent shortcut row in the message stream (accessible name leads with 子会话 + the resolved agent name). */
const chipOf = (page) => page.getByRole("button", { name: /子会话/ }).first();

/** The child session's own user prompt (run_subagent's `prompt`): must show in the child's conversation. */
const CHILD_PROMPT = "Count the TODO items in the repository";

/**
 * Wait for the chip, expanding its "Reasoning & Tools" group when needed: the group is open
 * while the turn runs but collapses (chip included) once the turn is over, and around a reload
 * either state is possible — poll the whole reveal so every interleaving converges.
 */
async function revealChip(page) {
  const chip = chipOf(page);
  await expect(async () => {
    if (await chip.isVisible()) return;
    const done = page.getByRole("button", { name: /运行完毕/ }).first();
    if (await done.isVisible()) await done.click();
    expect(await chip.isVisible()).toBeTruthy();
  }).toPass({ timeout: 15_000 });
}

/**
 * Click the chip and land on the child's own conversation. The reveal + click runs as one
 * polled block: the turn can finish between the two steps and collapse the group over the
 * chip, so a failed click retries from the reveal.
 */
async function openChildViaChip(page, parentSessionId) {
  const chip = chipOf(page);
  await expect(async () => {
    if (!(await chip.isVisible())) {
      const done = page.getByRole("button", { name: /运行完毕/ }).first();
      if (await done.isVisible()) await done.click();
    }
    await chip.click({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  // An ordinary session route, and not the parent's.
  await page.waitForURL(/\/chat\/session-/);
  await expect(page).not.toHaveURL(new RegExp(parentSessionId));
}

test("the chip navigates to the child's own conversation, live-ish and across reloads", async ({
  page,
}) => {
  // Approval defaults to allow-all: child sessions inherit the parent's approval mode, no
  // manual approval needed in this test.
  const { projectId, agentId, sessionId } = await provisionSession(page, "subuser");

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = composer(page);
  await ta.waitFor();
  await ta.fill("run a subagent");
  await page.getByRole("button", { name: "发送" }).click();

  // The child session leaves a shortcut row in the stream (the nested conversation renders
  // nowhere else); it appears as soon as the child's first message binds.
  await revealChip(page);

  // The retired panel's toolbar toggle must be gone for good.
  await expect(page.getByRole("button", { name: "智能体面板" })).toHaveCount(0);

  // Parent's final answer: the whole turn has ended; navigation below is deterministic.
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // --- Chip click: an ordinary session route. The child was never part of any sidebar page
  // (subagent category rows load only on folder expand), so this also proves the deep-link
  // self-heal path. Its own conversation carries its user side (run_subagent's prompt) and
  // its report. ---
  await openChildViaChip(page, sessionId);
  await expect(page.getByText(CHILD_PROMPT)).toBeVisible();
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();

  // --- Back on the parent, after a full reload (the finished turn's group is collapsed now —
  // revealChip expands it first): the chip comes back from the rebuilt history and still
  // navigates. ---
  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.reload();
  await revealChip(page);
  await openChildViaChip(page, sessionId);
  await expect(page.getByText(CHILD_PROMPT)).toBeVisible();
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();

  // --- Child session title: generated by the model from the child session's own conversation (async, poll until persisted). ---
  const childOf = async () => {
    const list = await (
      await page.request.get(`${BASE}/api/projects/${projectId}/agents/${agentId}/sessions`)
    ).json();
    return list.sessions.find((s) => s.sessionId !== sessionId) ?? null;
  };
  await expect
    .poll(async () => (await childOf())?.title ?? null, { timeout: 10000 })
    .toBe("Subagent TODO summary");
  const child = await childOf();

  // --- The child's OWN Trace session_meta records source=subagent: written by core's spawn
  // site, the single source of truth (the server's registration fallback cannot mask this —
  // it never writes the child Trace), and what the derived list source ultimately rests on. ---
  const childMessages = await (
    await page.request.get(`${BASE}/api/sessions/${child.sessionId}/messages`)
  ).json();
  const childMeta = childMessages.messages.find(
    (m) => m.type === "session_meta" && !m.origin?.length,
  );
  expect(childMeta, "child trace session_meta").toBeTruthy();
  expect(childMeta.payload.source).toBe("subagent");

  // --- Sidebar: the child session (source=subagent) must exist in the session list with its
  // persisted title and category. Trip-mode groups carry no server-side per-category totals,
  // so the collapsed "Subagents" folder only appears once its rows are loaded — assert the
  // child's existence and category via the API, and verify the sidebar shows the parent. ---
  await page.goto(`${BASE}/chat/${sessionId}`);
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByText("Configure Tailwind theme")).toBeVisible({ timeout: 15000 });
  const listRes = await page.request.get(
    `${BASE}/api/projects/${projectId}/agents/${agentId}/sessions?limit=20&offset=0&category=subagent`,
  );
  const subagentSessions = (await listRes.json()).sessions;
  expect(subagentSessions.some((s) => s.sessionId === child.sessionId)).toBeTruthy();
});

test("an approval inside the subagent stays discoverable via the chip badge and is answered inline under the chip", async ({
  page,
}) => {
  // always-ask: the parent's run_subagent needs a manual allow, and the child's own
  // exec_command then parks on a NESTED approval (the child inherits the approval mode).
  const { sessionId } = await provisionSession(page, "subuser2", { approvalMode: "always-ask" });

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = composer(page);
  await ta.waitFor();
  await ta.fill("run a subagent");
  await page.getByRole("button", { name: "发送" }).click();

  // Approve the parent's run_subagent in the main stream.
  await page.getByRole("button", { name: "允许" }).click();

  // The child's exec_command approval surfaces on the chip (待审批 joins its accessible name)…
  const pendingChip = page.getByRole("button", { name: /子会话.*待审批/ });
  await expect(pendingChip).toBeVisible();

  // …and is answered right here, on an inline row under the chip naming the child's tool. The
  // parent's own run_subagent approval is already decided, so this 允许 is the nested row's.
  await expect(page.getByText("exec_command").first()).toBeVisible();
  await page.getByRole("button", { name: "允许" }).click();

  // The parent's turn then runs to completion, and the pending badge (and its row) are gone.
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("button", { name: /子会话.*待审批/ })).toHaveCount(0);
});

test("draft flow: a child spawned by the session born from the draft leaves a working chip", async ({
  page,
}) => {
  // No pre-created session: the conversation is BORN FROM THE /chat/new DRAFT — the flow where
  // the session (and its chip) has to materialize under the first send's navigation.
  await provisionAndLogin(page.request, "subuser3", P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
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

  await page.goto(`${BASE}/chat/new`);
  const ta = composer(page);
  await ta.waitFor();
  await ta.fill("run a subagent");
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForURL(/\/chat\/session-/);
  const parentUrl = page.url();
  const parentSessionId = parentUrl.match(/session-[^/?#]+/)[0];

  // The chip appears once the child binds; the turn then runs to completion.
  await revealChip(page);
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // The chip leads to the child's own conversation, which carries the child's user side
  // (run_subagent forwards the prompt as the child's own input) and its report.
  await openChildViaChip(page, parentSessionId);
  await expect(page.getByText(CHILD_PROMPT)).toBeVisible();
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();
});
