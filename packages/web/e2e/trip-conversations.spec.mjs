/** Unified entry and explicit promotion, exercised against real persistence and a mock model. */
import { test, expect } from "@playwright/test";
import { composer, provisionAndLogin } from "./auth.mjs";
const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const RUN = Date.now().toString(36);

async function setup(page, suffix) {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  const user = `tripflow${suffix}${RUN}`;
  await provisionAndLogin(page.request, user, "password123");
  const project = `${user}-default_project`;
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
  await page.goto(`${BASE}/chat/new`);
  return project;
}
async function trips(page, project) {
  return (await (await page.request.get(`${BASE}/api/projects/${project}/trips`)).json()).trips;
}
async function session(page, id) {
  return (await (await page.request.get(`${BASE}/api/sessions/${id}`)).json()).session;
}
async function messages(page, id) {
  return (await (await page.request.get(`${BASE}/api/sessions/${id}/messages`)).json()).messages;
}
async function send(page, text) {
  await expect(page.locator(".draft-welcome-primary")).toBeVisible();
  await composer(page).fill(text);
  await expect(composer(page)).toHaveValue(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/session-/);
  await expect(
    page.getByText("Command finished; the result looks as expected.").last(),
  ).toBeVisible();
  return page.url().split("/chat/")[1];
}
async function openJoin(page) {
  await page
    .locator("[data-conversation-trip]")
    .getByRole("button", { name: "Add to trip", exact: true })
    .click();
}

test("a delayed Trip index cannot erase a Trip created while it was loading", async ({ page }) => {
  const project = await setup(page, "delayed");
  const response = await page.request.post(
    `${BASE}/api/projects/${project}/agents/default_agent/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8" } },
  );
  expect(response.ok()).toBe(true);
  const { session: created } = await response.json();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let captured;
  const ready = new Promise((resolve) => {
    captured = resolve;
  });
  let first = true;
  await page.route(`**/api/projects/${project}/trips`, async (route) => {
    if (route.request().method() !== "GET" || !first) return route.continue();
    first = false;
    const snapshot = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response: snapshot });
  });
  try {
    await page.goto(`${BASE}/chat/${created.sessionId}`);
    await ready;
    await openJoin(page);
    await page
      .getByRole("textbox", { name: "Trip name", exact: true })
      .fill("Keep the new journey");
    await page.getByRole("button", { name: "Create trip and continue", exact: true }).click();
    await expect.poll(async () => (await session(page, created.sessionId)).tripId).not.toBeNull();
    release();
    await expect(page.locator("[data-conversation-trip]")).toContainText("Keep the new journey");
    await page
      .getByRole("complementary")
      .getByRole("link", { name: "My trips", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Keep the new journey", exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});

test("independent draft constraints survive reload and parking with their text", async ({
  page,
}) => {
  const project = await setup(page, "constraints");
  await composer(page).fill("Keep my weekend preferences");
  await page.getByRole("button", { name: "Where", exact: true }).click();
  await page.getByPlaceholder("City or region — several is fine").fill("Kyoto");
  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Who", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "+", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: /^Total budget/ })
    .fill("2000");
  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  const expectConstraints = async () => {
    await expect(page.getByRole("button", { name: "Kyoto", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "2 travelers", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "$2,000", exact: true })).toBeVisible();
    await expect(composer(page)).toHaveValue("Keep my weekend preferences");
  };
  await expectConstraints();
  await page.reload();
  await expectConstraints();
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "New trip", exact: true })
    .click();
  await expect(composer(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Where", exact: true })).toBeVisible();
  await page
    .getByRole("complementary")
    .getByText("Keep my weekend preferences", { exact: true })
    .click();
  await expectConstraints();
  const id = await send(page, "Keep my weekend preferences");
  const input = JSON.stringify(await messages(page, id));
  expect(input).toContain("Kyoto");
  expect(input).toContain("2000");
  expect((await session(page, id)).tripId).toBeNull();
  expect(await trips(page, project)).toHaveLength(0);
});

test("one entry starts independently, promotes in place, and shares details across separate topics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const project = await setup(page, "main");
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByRole("button", { name: "New trip", exact: true })).toHaveCount(1);
  await expect(sidebar.getByRole("button", { name: "New chat", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "My trips", exact: true })).toBeVisible();
  await sidebar.getByRole("link", { name: "Models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "New trip", exact: true }).click();
  const welcomeHeading = await page.getByRole("heading", { name: /^Where to today,/ }).innerText();
  await expect(page.locator(".draft-jump-back-in")).toBeVisible();
  const globalComposerWidth = (await page.locator(".draft-welcome-primary").boundingBox()).width;
  const id = await send(page, "Plan a relaxed autumn journey.");
  const before = await session(page, id);
  const history = await messages(page, id);
  expect(before.tripId).toBeNull();
  expect(await trips(page, project)).toHaveLength(0);
  await openJoin(page);
  await page.getByRole("button", { name: "Keep chatting", exact: true }).click();
  expect(await trips(page, project)).toHaveLength(0);
  await openJoin(page);
  await page.getByRole("textbox", { name: "Trip name", exact: true }).fill("Autumn in Kyoto");
  await page
    .getByRole("textbox", { name: "Trip notes", exact: true })
    .fill("Quiet accommodation; leave afternoons free.");
  await page.getByRole("button", { name: "Create trip and continue", exact: true }).click();
  await expect(page.locator("[data-conversation-trip]")).toContainText("Autumn in Kyoto");
  const after = await session(page, id);
  expect(after.sessionId).toBe(id);
  expect(after.workspace).toBe(before.workspace);
  expect(await messages(page, id)).toEqual(history);
  expect(await trips(page, project)).toHaveLength(1);

  // Preferences preserve an existing conversation's unsent input and Trip membership.
  await composer(page).fill("Keep this question for the Kyoto conversation.");
  await page
    .getByRole("button", { name: project.replace(/-default_project$/, ""), exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  let settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Language & region", exact: true }).click();
  await settings.getByRole("button", { name: "中文", exact: true }).click();
  settings = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(composer(page)).toHaveValue("Keep this question for the Kyoto conversation.");
  await settings.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page).toHaveURL(`${BASE}/chat/${id}`);
  await expect(composer(page)).toHaveValue("Keep this question for the Kyoto conversation.");
  expect((await session(page, id)).tripId).toBe(after.tripId);
  await composer(page).fill("");

  const draftWrites = [];
  const recordDraftWrite = (request) => {
    if (request.method() === "POST" && /\/(sessions|tasks|trips)$/.test(request.url())) {
      draftWrites.push(request.url());
    }
  };
  page.on("request", recordDraftWrite);
  await page
    .locator("[data-conversation-trip]")
    .getByRole("button", { name: "New chat", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: welcomeHeading, exact: true })).toBeVisible();
  await expect(
    page.getByText("Trip details from “Autumn in Kyoto” are ready for this conversation.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".draft-jump-back-in")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Up next", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jump back in", exact: true })).toBeVisible();
  const tripComposer = await page.locator(".draft-welcome-primary").boundingBox();
  const discovery = await page.locator(".draft-jump-back-in").boundingBox();
  expect(Math.abs(tripComposer.width - globalComposerWidth)).toBeLessThan(1);
  expect(discovery.x).toBeGreaterThan(tripComposer.x + tripComposer.width);
  for (const [name, prompt] of [
    ["Accommodation", "Help me compare accommodation options for this trip."],
    ["Transport", "Help me plan transport for this trip."],
    ["Daily plans", "Help me arrange the days of this trip at a comfortable pace."],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(composer(page)).toHaveValue(prompt);
    await expect(composer(page)).toBeFocused();
  }
  await expect(page).toHaveURL(/\/chat\/new$/);
  // Opening settings must not treat a Trip-scoped draft as a fresh, independent entry.
  await page
    .getByRole("button", { name: project.replace(/-default_project$/, ""), exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Language & region", exact: true }).click();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(composer(page)).toHaveValue(
    "Help me arrange the days of this trip at a comfortable pace.",
  );
  await expect(
    page.getByText("Trip details from “Autumn in Kyoto” are ready for this conversation.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".draft-jump-back-in")).toBeHidden();
  await expect(composer(page)).toBeVisible();
  const narrowWidth = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(narrowWidth.scroll).toBeLessThanOrEqual(narrowWidth.client + 1);
  await page.setViewportSize({ width: 1600, height: 1000 });
  expect(draftWrites).toEqual([]);
  page.off("request", recordDraftWrite);
  const topic = await send(page, "Compare accommodation areas.");
  expect(topic).not.toBe(id);
  expect((await session(page, topic)).tripId).toBe(after.tripId);
  expect(JSON.stringify(await messages(page, topic))).toContain(
    "Quiet accommodation; leave afternoons free.",
  );
  expect(JSON.stringify(await messages(page, topic))).not.toContain(
    "Plan a relaxed autumn journey.",
  );
  await page
    .locator("[data-conversation-trip]")
    .getByRole("button", { name: "Edit details", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Trip notes", exact: true })
    .fill("Stay near a station instead.");
  await page
    .getByRole("button", { name: "Save", exact: true })
    .and(page.locator('button[type="submit"]'))
    .click();
  await page.goto(`${BASE}/chat/${id}`);
  const taskRequest = page.waitForRequest(
    (req) => req.url().endsWith(`/api/sessions/${id}/tasks`) && req.method() === "POST",
  );
  await composer(page).fill("Continue with the latest preferences.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const request = await taskRequest;
  expect(JSON.stringify(request.postDataJSON().input)).toContain("Stay near a station instead.");
  await sidebar.getByRole("button", { name: "New trip", exact: true }).click();
  const loose = await send(page, "What should I pack?");
  expect((await session(page, loose)).tripId).toBeNull();
  await openJoin(page);
  await page.getByRole("button", { name: "Join an existing trip", exact: true }).click();
  await page.getByRole("radio").check();
  await page.getByRole("button", { name: "Join and continue", exact: true }).click();
  expect((await session(page, loose)).tripId).toBe(after.tripId);
  expect(await trips(page, project)).toHaveLength(1);
  await page.reload();
  await expect(page.locator("[data-conversation-trip]")).toContainText("Autumn in Kyoto");
  await page.locator("[data-conversation-trip]").getByRole("link").click();
  await expect(page.getByText("Stay near a station instead.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
});

test("failed attachment reuses the created Trip and leaves the conversation usable", async ({
  page,
}) => {
  const project = await setup(page, "retry");
  const id = await send(page, "Help me plan a break.");
  await page.route(`**/api/sessions/${id}/trip`, async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "unavailable", message: "Try again" } }),
      });
    } else await route.continue();
  });
  await openJoin(page);
  await page.getByRole("textbox", { name: "Trip name", exact: true }).fill("Retry journey");
  await page.getByRole("button", { name: "Create trip and continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("trip was created");
  expect((await session(page, id)).tripId).toBeNull();
  expect(await trips(page, project)).toHaveLength(1);
  await page.unroute(`**/api/sessions/${id}/trip`);
  await page.getByRole("button", { name: "Join and continue", exact: true }).click();
  await expect(page.locator("[data-conversation-trip]")).toContainText("Retry journey");
  expect(await trips(page, project)).toHaveLength(1);
});

test("parked topics retain their Trip across global starts and reload", async ({ page }) => {
  const project = await setup(page, "draft");
  const res = await page.request.post(`${BASE}/api/projects/${project}/trips`, {
    data: { name: "Topic draft journey", notes: "Travel slowly" },
  });
  const trip = (await res.json()).trip;
  await page.goto(`${BASE}/trips/${trip.tripId}`);
  await expect(
    page.getByRole("button", { name: "New chat in this trip", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await composer(page).fill("Unsent transport topic");
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "New trip", exact: true })
    .click();
  await expect(composer(page)).toHaveValue("");
  await page
    .getByRole("complementary")
    .getByText("Unsent transport topic", { exact: true })
    .click();
  await page.reload();
  await expect(composer(page)).toHaveValue("Unsent transport topic");
  await expect(page.getByRole("heading", { name: /^Where to today,/ })).toBeVisible();
  await expect(
    page.getByText("Trip details from “Topic draft journey” are ready for this conversation.", {
      exact: true,
    }),
  ).toBeVisible();
  const id = await send(page, "Unsent transport topic");
  expect((await session(page, id)).tripId).toBe(trip.tripId);
  expect(JSON.stringify(await messages(page, id))).toContain("Travel slowly");
});
