import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
async function setup(page, suffix) {
  const user = `saved${suffix}`;
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, user, "password123");
  const project = `${user}-default_project`;
  const model = await page.request.put(`${BASE}/api/projects/${project}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: process.env.MOCK_URL,
        },
      ],
    },
  });
  expect(model.ok()).toBe(true);
  return project;
}
async function createSession(page, project, title, agent = "default_agent", archived = true) {
  const response = await page.request.post(
    `${BASE}/api/projects/${project}/agents/${agent}/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8" } },
  );
  expect(response.ok()).toBe(true);
  const session = (await response.json()).session;
  expect(
    (
      await page.request.patch(`${BASE}/api/sessions/${session.sessionId}`, {
        data: { title, archived },
      })
    ).ok(),
  ).toBe(true);
  return session;
}

test("Saved includes existing conversations across Agents, paginates, and unsaves without losing the Trip", async ({
  page,
}, testInfo) => {
  const project = await setup(page, "records");
  expect(
    (
      await page.request.post(`${BASE}/api/projects/${project}/agents`, {
        data: { agentId: "other", name: "Other" },
      })
    ).ok(),
  ).toBe(true);
  const originals = [];
  for (let i = 0; i < 13; i++)
    originals.push(await createSession(page, project, `Kyoto research ${i + 1}`));
  const other = await createSession(page, project, "Shanghai hotel shortlist", "other");
  const tripResponse = await page.request.post(`${BASE}/api/projects/${project}/trips`, {
    data: { name: "Shanghai weekend", destination: "Shanghai" },
  });
  expect(tripResponse.ok()).toBe(true);
  const trip = (await tripResponse.json()).trip;
  expect(
    (
      await page.request.put(`${BASE}/api/sessions/${other.sessionId}/trip`, {
        data: { tripId: trip.tripId },
      })
    ).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`${BASE}/saved`);
  const main = page.getByRole("main");
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByRole("link", { name: "Saved", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    await sidebar
      .locator('a[href="/trips"], a[href="/saved"], a[href="/models"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  ).toEqual(["/trips", "/saved", "/models"]);
  await expect(main.locator("[data-saved-conversation]")).toHaveCount(11);
  await expect(main.getByText("14 saved conversations", { exact: true })).toBeVisible();
  await expect(sidebar.getByText(/Saved \(/)).toHaveCount(0);
  await expect(sidebar.getByText("Shanghai hotel shortlist", { exact: true })).toHaveCount(0);
  const target = main.locator(`[data-saved-conversation="${other.sessionId}"]`);
  await expect(target).toContainText("Shanghai weekend");
  await page.screenshot({ path: testInfo.outputPath("saved-desktop.png"), animations: "disabled" });
  await main.getByRole("button", { name: "Load more conversations", exact: true }).click();
  await expect(main.locator("[data-saved-conversation]")).toHaveCount(14);
  await expect(
    main.getByRole("button", { name: "Load more conversations", exact: true }),
  ).toHaveCount(0);
  await target.getByRole("link", { name: "Shanghai hotel shortlist", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/chat/${other.sessionId}`);
  await expect(page.locator("[data-conversation-trip]")).toContainText("Shanghai weekend");
  await page.getByRole("button", { name: "Back to Saved", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/saved`);
  await expect(main.locator("[data-saved-conversation]")).toHaveCount(14);
  await target.getByRole("button", { name: "Unsave", exact: true }).click();
  await expect(target).toHaveCount(0);
  const unchanged = (
    await (await page.request.get(`${BASE}/api/sessions/${other.sessionId}`)).json()
  ).session;
  expect(unchanged.archived).toBe(false);
  expect(unchanged.tripId).toBe(trip.tripId);
  expect(unchanged.workspace).toBe(other.workspace);
  await expect(sidebar.getByText("Shanghai hotel shortlist", { exact: true })).toBeVisible();
  // A removal resets offsets; loading again must still include every remaining saved record.
  await main.getByRole("button", { name: "Load more conversations", exact: true }).click();
  await expect(main.locator("[data-saved-conversation]")).toHaveCount(13);
  const ids = await main
    .locator("[data-saved-conversation]")
    .evaluateAll((rows) => rows.map((row) => row.dataset.savedConversation));
  expect(ids.sort()).toEqual(originals.map((session) => session.sessionId).sort());
  await page.reload();
  await expect(main.getByText("13 saved conversations", { exact: true })).toBeVisible();
  await expect(target).toHaveCount(0);
});

test("Saved failure is retryable and a failed unsave leaves the conversation available", async ({
  page,
}) => {
  const project = await setup(page, "retry");
  const session = await createSession(page, project, "Keep my flight comparison");
  await page.route("**/sessions?*category=archived*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Try again" } }),
    }),
  );
  await page.goto(`${BASE}/saved`);
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await expect(page.getByText("No saved conversations yet", { exact: true })).toHaveCount(0);
  await page.unroute("**/sessions?*category=archived*");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const row = page.locator(`[data-saved-conversation="${session.sessionId}"]`);
  await expect(row).toBeVisible();
  await page.route(`**/api/sessions/${session.sessionId}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "unavailable", message: "Could not update" } }),
        })
      : route.continue(),
  );
  await row.getByRole("button", { name: "Unsave", exact: true }).click();
  await expect(row.getByRole("button", { name: "Unsave", exact: true })).toBeEnabled();
  await expect(row).toBeVisible();
  expect(
    (await (await page.request.get(`${BASE}/api/sessions/${session.sessionId}`)).json()).session
      .archived,
  ).toBe(true);
});

test("Saved has a mobile empty state and the drawer entry opens the same list", async ({
  page,
}, testInfo) => {
  const project = await setup(page, "mobile");
  await page.setViewportSize({ width: 390, height: 750 });
  await page.goto(`${BASE}/saved`);
  await expect(
    page.getByRole("heading", { name: "No saved conversations yet", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("saved-empty.png"), animations: "disabled" });
  await createSession(
    page,
    project,
    "A relaxed weekend in Shanghai, with a hotel near the station and room for an unhurried afternoon",
  );
  await page.reload();
  await expect(page.locator("[data-saved-conversation]")).toHaveCount(1);
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("link", { name: "Saved", exact: true }).last().click();
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Saved", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Saved", exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("saved-mobile.png"), animations: "disabled" });
  await page.locator("[data-saved-conversation]").getByRole("link").click();
  await page.getByRole("button", { name: "Back to Saved", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/saved`);
});

test("Saved return survives reload without changing ordinary conversation navigation", async ({
  page,
}) => {
  const project = await setup(page, "return");
  const saved = await createSession(page, project, "Saved weekend ideas");
  const ordinary = await createSession(
    page,
    project,
    "A separate conversation",
    "default_agent",
    false,
  );
  await page.goto(`${BASE}/saved`);
  await page.getByRole("link", { name: "Saved weekend ideas", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/chat/${saved.sessionId}`);
  await page.reload();
  await page.getByRole("button", { name: "Back to Saved", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/saved`);
  await page.getByRole("link", { name: "Saved weekend ideas", exact: true }).click();
  await page
    .getByRole("complementary")
    .getByText("A separate conversation", { exact: true })
    .click();
  await expect(page).toHaveURL(`${BASE}/chat/${ordinary.sessionId}`);
  await expect(page.getByRole("button", { name: "Back to Saved", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back home", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/chat/new`);
  // A direct visit to a saved chat has no Saved entry to return to.
  await page.goto(`${BASE}/chat/${saved.sessionId}`);
  await page.getByRole("button", { name: "Back home", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/chat/new`);
});
