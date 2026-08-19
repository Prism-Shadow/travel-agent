/**
 * Regression: clicking the "currently selected" Project in the Project dropdown must not clear
 * the Agent list and the Sessions under it.
 *
 * Old bug: setCurrentProjectId unconditionally called setAgents([]) + setAgentsLoading(true),
 * while currentProjectId itself didn't change — reloadAgents' effect depends on it and wouldn't
 * re-run, so the sidebar's Agents and the Sessions hanging under them would all disappear and
 * never come back (reproducible by simply clicking the current Project in the dropdown).
 *
 * A Project is deliberately created with a display name different from the username: a newly
 * registered user's initial Project display name defaults to the username, and the bottom-left
 * user menu also shows the username, so locating by name would match both.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "projswitcher";
const P = "password123";
const PROJ = "SwitchTarget";

test("clicking the current Project in the dropdown: Agent and Session lists must not disappear", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);

  const initial = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0];

  // A non-admin's Project id must be prefixed with <username>-.
  const created = await page.request.post(`${BASE}/api/projects`, {
    data: { projectId: `${U}-target`, name: PROJ },
  });
  expect(created.ok(), "create project").toBeTruthy();
  const projectId = (await created.json()).project.projectId;

  // Configure Model + credentials on both Projects: a Project without credentials pops an
  // onboarding overlay (fixed inset-0) as soon as the page loads, which would block every click on the sidebar.
  for (const id of [initial.projectId, projectId]) {
    const put = await page.request.put(`${BASE}/api/projects/${id}/models`, {
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
    expect(put.ok(), `put models ${id}`).toBeTruthy();
  }

  await page.goto("/");

  // First wait for the initial Project's sidebar to settle: during this time it fetches the
  // Agent list and lands on the draft page (the brand heading marks the draft page); operating
  // the dropdown midway through would get closed by a subsequent re-render.
  const generalAgent = page.getByText("General Agent").first();
  const draftTitle = page.getByRole("heading", { name: "PenguinHarness" });
  await expect(generalAgent).toBeVisible();
  await expect(draftTitle).toBeVisible();

  // Switch to this newly created Project (a different id: takes the normal switch path).
  const byName = page.getByRole("button", { name: PROJ });
  await page.getByRole("button", { name: U }).first().click(); // the initial Project's display name defaults to the username
  await byName.first().click();

  // Wait for the new Project's sidebar to settle too (Agent list + draft page).
  await expect(generalAgent).toBeVisible();
  await expect(draftTitle).toBeVisible();

  // The key action: click this "currently selected" Project again in the dropdown.
  await byName.first().click(); // the top trigger button (currently displaying PROJ)
  await expect(byName).toHaveCount(2); // the trigger button + the same-named item in the menu
  await byName.nth(1).click();

  // The regression point: both the Agent and the draft page are still there (before the fix,
  // these two assertions would fail — the sidebar gets cleared and stuck in loading).
  await expect(generalAgent).toBeVisible();
  await expect(draftTitle).toBeVisible();

  // (The former second half of this spec — the skill library page's per-Project snapshot
  // regression, #74 comment — went away with the page itself: skills are built-in now, and
  // the library-browse/install UI no longer exists.)
});
