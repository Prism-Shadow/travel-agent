/** Real Trip index, navigation and first-message creation; no model call on the overview. */
import { test, expect } from "@playwright/test";
import { provisionAndLogin, composer } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const RUN = Date.now().toString(36);
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dates = (start, end) => ({ kind: "dates", start: day(start), end: day(end) });
async function setup(page, suffix, locale = "en") {
  await page.addInitScript((lang) => localStorage.setItem("penguin.lang", lang), locale);
  const userId = `overview${suffix}${RUN}`;
  await provisionAndLogin(page.request, userId, "password123");
  const projectId = `${userId}-default_project`;
  const response = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
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
  return projectId;
}
async function createTrip(page, projectId, body) {
  const response = await page.request.post(`${BASE}/api/projects/${projectId}/trips`, {
    data: body,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).trip;
}
async function listTrips(page, projectId) {
  return (await (await page.request.get(`${BASE}/api/projects/${projectId}/trips`)).json()).trips;
}

for (const locale of ["en", "zh"]) {
  test(`first visit offers a background and a working new-trip draft (${locale})`, async ({
    page,
  }) => {
    const projectId = await setup(page, locale, locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/trips`);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", {
        name: locale === "en" ? "Your next journey starts here" : "下一段旅程，从这里开始",
      }),
    ).toBeVisible();
    await expect(main.locator("[data-trip-card]")).toHaveCount(0);
    const background = main.locator('img[src="/trips/empty-background.webp"]');
    await expect(background).toHaveAttribute("alt", "");
    await expect
      .poll(() => background.evaluate((image) => image.complete && image.naturalWidth > 0))
      .toBe(true);
    const label = locale === "en" ? "New trip" : "新建行程";
    await main.getByRole("button", { name: label, exact: true }).last().click();
    await expect(page).toHaveURL(/\/chat\/new$/);
    await expect(composer(page)).toBeVisible();
    expect(await listTrips(page, projectId)).toHaveLength(0);
    await composer(page).fill("Plan four days in Kyoto.");
    await composer(page).press("Enter");
    await expect(page).toHaveURL(/\/chat\/session-/);
    await expect.poll(async () => (await listTrips(page, projectId)).length).toBe(0);
    await page.goto(`${BASE}/trips`);
    await expect(main.locator("[data-trip-card]")).toHaveCount(0);
    await expect(main.locator(".trips-empty")).toHaveCount(1);
  });
}

test("overview groups every trip, keeps history collapsed and opens the selected journey", async ({
  page,
}, testInfo) => {
  const projectId = await setup(page, "groups");
  const future = await createTrip(page, projectId, {
    name: "Shanghai weekend",
    destination: "Shanghai",
    when: dates(13, 15),
    who: { adults: 2, children: 0, infants: 0, pets: 0 },
  });
  const ongoing = await createTrip(page, projectId, {
    name: "Kyoto now",
    destination: "Kyoto",
    when: dates(-2, 2),
  });
  const past = await createTrip(page, projectId, {
    name: "Lisbon memory",
    destination: "Lisbon",
    when: dates(-10, -5),
  });
  const flexible = await createTrip(page, projectId, {
    name: "Chengdu someday",
    when: { kind: "flexible", days: 4, months: [] },
  });
  const endOnly = await createTrip(page, projectId, {
    name: "Return date only",
    when: { kind: "dates", start: "", end: day(7) },
  });
  const blank = await createTrip(page, projectId, {
    destination: "Reykjavik",
    when: { kind: "dates", start: "", end: "" },
  });
  await page.setViewportSize({ width: 1488, height: 1058 });
  await page.goto(`${BASE}/chat/new`);
  await page.getByRole("link", { name: "My trips", exact: true }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByRole("link", { name: "My trips", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const upcoming = page.locator('[data-trip-section="upcoming"]');
  const unscheduled = page.locator('[data-trip-section="unscheduled"]');
  const history = page.locator('[data-trip-section="past"]');
  await expect(upcoming.getByRole("link")).toHaveCount(3);
  await expect(upcoming.getByRole("link").first()).toHaveAttribute(
    "data-trip-card",
    ongoing.tripId,
  );
  await expect(upcoming.getByRole("link").first()).toContainText("In progress");
  await expect(upcoming.locator(`[data-trip-card="${endOnly.tripId}"]`)).toBeVisible();
  await expect(unscheduled.locator(`[data-trip-card="${flexible.tripId}"]`)).toBeVisible();
  await expect(unscheduled.locator(`[data-trip-card="${blank.tripId}"]`)).toBeVisible();
  const images = await page
    .locator("[data-trip-card] img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("src")));
  await expect(history).not.toHaveAttribute("open");
  await history.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(history.locator(`[data-trip-card="${past.tripId}"]`)).toBeVisible();
  expect(
    await page
      .locator("[data-trip-card] img")
      .evaluateAll((images) => images.map((image) => image.getAttribute("src"))),
  ).toEqual(images);
  await expect(upcoming.locator(`[data-trip-card="${future.tripId}"] img`)).toHaveAttribute(
    "src",
    "/travel-covers/shanghai-night.jpg",
  );
  await upcoming.locator(`[data-trip-card="${future.tripId}"]`).click();
  await expect(page).toHaveURL(`${BASE}/trips/${future.tripId}`);
  await expect(page.getByRole("link", { name: "Back to My trips", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shanghai weekend", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("trip-detail-back.png"),
    animations: "disabled",
  });
  await page.getByRole("link", { name: "Back to My trips", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My trips", exact: true })).toBeVisible();
  // A direct detail link has the same destination even without overview history.
  await page.goto(`${BASE}/trips/${future.tripId}`);
  await page.getByRole("link", { name: "Back to My trips", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/trips`);
  await page.setViewportSize({ width: 390, height: 844 });
  await unscheduled.locator(`[data-trip-card="${blank.tripId}"]`).scrollIntoViewIfNeeded();
  await expect(unscheduled.locator(`[data-trip-card="${blank.tripId}"]`)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await unscheduled.locator(`[data-trip-card="${blank.tripId}"]`).click();
  await page.getByRole("link", { name: "Back to My trips", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/trips`);
  await page.goto(`${BASE}/trips/missing-trip`);
  await expect(page.getByRole("status")).toContainText("This trip no longer exists");
  await page.getByRole("link", { name: "Back to My trips", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/trips`);
});

test("loading and retryable failure never masquerade as a first visit", async ({ page }) => {
  await setup(page, "failure");
  let releaseProject;
  const projectHeld = new Promise((resolve) => {
    releaseProject = resolve;
  });
  await page.route("**/api/projects", async (route) => {
    await projectHeld;
    await route.continue();
  });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let fail = true;
  await page.route("**/api/projects/*/trips", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await held;
    if (fail)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unavailable" }),
      });
    return route.continue();
  });
  await page.goto(`${BASE}/trips`);
  await expect(page.getByRole("status", { name: "Loading trips…" })).toBeVisible();
  await expect(page.locator(".trips-empty")).toHaveCount(0);
  releaseProject();
  await expect(page.getByRole("status", { name: "Loading trips…" })).toBeVisible();
  release();
  await expect(page.getByRole("alert")).toContainText("We couldn't load your trips");
  await expect(page.locator(".trips-empty")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your next journey starts here" })).toBeVisible();
});

test("a mutation revalidates in place: deleting from the sidebar never flashes the skeleton", async ({
  page,
}) => {
  const projectId = await setup(page, "revalidate");
  const keep = await createTrip(page, projectId, { name: "Keep me", destination: "Oslo" });
  const doomed = await createTrip(page, projectId, { name: "Doomed", destination: "Bergen" });
  await page.setViewportSize({ width: 1488, height: 1058 });
  await page.goto(`${BASE}/trips`);
  await expect(page.locator(`[data-trip-card="${doomed.tripId}"]`)).toBeVisible();
  await expect(page.locator(".trips-load-state")).toHaveCount(0);

  // Record the skeleton if it is ever attached from here on — a retrying assertion cannot see a
  // one-frame flash, but an observer can.
  await page.evaluate(() => {
    window.__skeletonSeen = false;
    new MutationObserver(() => {
      if (document.querySelector(".trips-load-state")) window.__skeletonSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  });

  // The Trip's sidebar group header holds its name and, on hover, its delete button.
  const header = page
    .getByRole("complementary")
    .locator("div", { has: page.getByText("Doomed", { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Delete trip", exact: true }) })
    .last();
  await header.hover();
  await header.getByRole("button", { name: "Delete trip", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.locator(`[data-trip-card="${doomed.tripId}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-trip-card="${keep.tripId}"]`)).toBeVisible();
  // The refetch after the delete has landed by the time the card is gone; the list stayed put.
  expect(await page.evaluate(() => window.__skeletonSeen)).toBe(false);
  expect((await listTrips(page, projectId)).map((trip) => trip.tripId)).toEqual([keep.tripId]);
});

test("header New trip preserves unsent text before starting another draft", async ({ page }) => {
  const projectId = await setup(page, "draft");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/chat/new`);
  await composer(page).fill("Keep my unfinished Kyoto plan");
  await page.getByRole("link", { name: "My trips", exact: true }).click();
  await page
    .getByRole("main")
    .getByRole("button", { name: "New trip", exact: true })
    .first()
    .click();
  await expect(composer(page)).toHaveValue("");
  expect(await listTrips(page, projectId)).toHaveLength(0);
  await page.getByRole("button", { name: "Keep my unfinished Kyoto plan", exact: true }).click();
  await expect(composer(page)).toHaveValue("Keep my unfinished Kyoto plan");
});

test("a long overview remains scrollable without hiding long names or overflowing narrow screens", async ({
  page,
}) => {
  const projectId = await setup(page, "long");
  const longName = "Averylongtriptitle".repeat(8).slice(0, 119);
  await createTrip(page, projectId, {
    name: longName,
    when: dates(1, 3),
    who: { adults: 4, children: 1, infants: 0, pets: 0 },
    budgetAmount: 25000,
    budgetCurrency: "USD",
  });
  await createTrip(page, projectId, { name: "Lisbon next", when: dates(10, 14) });
  await createTrip(page, projectId, {
    name: longName + "2",
    when: dates(20, 24),
    who: { adults: 4, children: 1, infants: 0, pets: 0 },
    budgetAmount: 25000,
    budgetCurrency: "USD",
  });
  for (let i = 0; i < 28; i++) await createTrip(page, projectId, { name: `Untitled ${i}` });
  await page.goto(`${BASE}/trips`);
  const cards = page.locator("[data-trip-card]");
  await expect(cards).toHaveCount(31);
  for (const width of [1488, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const first = cards.first();
    await first.scrollIntoViewIfNeeded();
    await expect(first).toBeInViewport();
    await expect(first.getByRole("heading")).toHaveAttribute("title", longName);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const bounds = await page
      .locator("[data-trips-overview]")
      .evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
    await cards.last().scrollIntoViewIfNeeded();
    await expect(cards.last()).toBeInViewport();
  }
});

test("the local midnight moves a completed trip into history without another API request", async ({
  page,
}) => {
  const projectId = await setup(page, "midnight");
  const trip = await createTrip(page, projectId, { name: "Returns today", when: dates(-3, 0) });
  const time = new Date();
  time.setHours(23, 59, 59, 0);
  await page.clock.install({ time });
  let indexReads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(`/projects/${projectId}/trips`) && request.method() === "GET")
      indexReads++;
  });
  await page.goto(`${BASE}/trips`);
  await expect(
    page.locator(`[data-trip-section="upcoming"] [data-trip-card="${trip.tripId}"]`),
  ).toBeVisible();
  const reads = indexReads;
  await page.clock.fastForward(2100);
  await expect(page.locator('[data-trip-section="upcoming"]')).toHaveCount(0);
  await expect(page.locator('[data-trip-section="past"]')).toBeVisible();
  expect(indexReads).toBe(reads);
});
