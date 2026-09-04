/**
 * The draft screen's discovery rail has two mutually exclusive states.
 *
 * First run: "Get inspired" only — editorial prompts are scaffolding for the person with
 * nothing to continue. Returning: "Up next" (up to three trips as data-rendered cards,
 * soonest departure first: countdown, meta line, chat count) over "Jump back in", and the
 * inspiration cards are gone — a returning traveller's own Kyoto trip outranks a canned card
 * that cannot see it.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin, composer } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
// First-run state cannot survive a reused database (tasks/lessons.md), so every run gets its
// own users: the credential dialog and the empty rail exist only for a genuinely new account.
const RUN = Date.now().toString(36);

function isoPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

test("first run shows Get inspired and no trip rail", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, `railfirst${RUN}`, "password123");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/chat/new`);
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await composer(page).waitFor();

  await expect(page.getByRole("heading", { name: "Get inspired" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Up next" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Jump back in" })).toHaveCount(0);
});

test("choosing an inspiration card fills the composer and sends nothing", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, `railpick${RUN}`, "password123");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/chat/new`);
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await composer(page).waitFor();
  await composer(page).fill("half a sentence");

  await page.getByRole("button", { name: "Chase autumn in Kyoto" }).click();

  // The prompt is now the draft — focused and editable — and no Session was created: the
  // route is still the draft's, and the rail is still in its first-run state.
  await expect(composer(page)).toHaveValue(/^Design a five-day Kyoto trip/);
  await expect(composer(page)).toBeFocused();
  await expect(page).toHaveURL(/\/chat\/new/);
  await expect(page.getByRole("heading", { name: "Get inspired" })).toBeVisible();
});

test("a returning user leads with the next trip and the inspiration cards yield", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, `railret${RUN}`, "password123");
  const projectId = `railret${RUN}-default_project`;

  // Session creation needs a default model; point the project at the suite's mock LLM the way
  // every other data-seeding spec does.
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

  // Three dated future trips (Kyoto departs sooner, so it leads the rail), plus one attached
  // and one loose conversation.
  const tripRes = await page.request.post(`${BASE}/api/projects/${projectId}/trips`, {
    data: {
      destination: "Kyoto",
      when: { kind: "dates", start: isoPlusDays(12), end: isoPlusDays(17) },
      who: { adults: 2, children: 0, infants: 0, pets: 0 },
      budget: "mid",
    },
  });
  expect(tripRes.ok()).toBe(true);
  const { trip } = await tripRes.json();
  const laterTripRes = await page.request.post(`${BASE}/api/projects/${projectId}/trips`, {
    data: {
      destination: "Lisbon",
      when: { kind: "dates", start: isoPlusDays(30), end: isoPlusDays(35) },
      who: { adults: 1, children: 0, infants: 0, pets: 0 },
      budget: "mid",
    },
  });
  expect(laterTripRes.ok()).toBe(true);
  const latestTripRes = await page.request.post(`${BASE}/api/projects/${projectId}/trips`, {
    data: {
      destination: "Reykjavik",
      when: { kind: "dates", start: isoPlusDays(45), end: isoPlusDays(50) },
      who: { adults: 2, children: 0, infants: 0, pets: 0 },
      budget: "mid",
    },
  });
  expect(latestTripRes.ok()).toBe(true);

  const mkSession = async (title) => {
    const created = await page.request.post(
      `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
      { data: {} },
    );
    expect(created.ok()).toBe(true);
    const { session } = await created.json();
    const patched = await page.request.patch(`${BASE}/api/sessions/${session.sessionId}`, {
      data: { title },
    });
    expect(patched.ok()).toBe(true);
    return session.sessionId;
  };
  const attached = await mkSession("Kyoto ryokan shortlist");
  await mkSession("Ctrip flight to Osaka");
  const attach = await page.request.put(`${BASE}/api/sessions/${attached}/trip`, {
    data: { tripId: trip.tripId },
  });
  expect(attach.ok()).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/chat/new`);
  // With a model configured above, the credential dialog never opens; dismiss only if present.
  const later = page.getByRole("button", { name: "Later", exact: true });
  if (await later.isVisible().catch(() => false)) await later.click();
  await composer(page).waitFor();

  await expect(page.getByRole("heading", { name: "Up next" })).toBeVisible();
  const cards = page.locator("[data-up-next-card]");
  await expect(cards).toHaveCount(3);
  // Soonest departure leads the rail; the later trips follow it in date order.
  const card = cards.first();
  await expect(card).toContainText("Kyoto");
  await expect(cards.nth(1)).toContainText("Lisbon");
  await expect(cards.nth(2)).toContainText("Reykjavik");
  await expect(card).toContainText("Departs in 12 days");
  await expect(card).toContainText("2 travellers");
  // Dates compact to month-day on the card; the full ISO form belongs to the sidebar.
  await expect(card).not.toContainText(isoPlusDays(12));
  await expect(card).toContainText("1 chat");
  await expect(page.getByRole("heading", { name: "Jump back in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get inspired" })).toHaveCount(0);

  // Cards beyond the visible pair are reachable through the rail controls, not merely present
  // offscreen.
  const rail = page.locator("[data-up-next-rail]");
  const railSize = await rail.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(railSize.scrollWidth, "the Up next cards overflow their rail").toBeGreaterThan(
    railSize.clientWidth,
  );
  const next = page.getByRole("button", { name: "Scroll upcoming trips right" });
  await expect(next).toBeVisible();
  await next.click();
  await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  const previous = page.getByRole("button", { name: "Scroll upcoming trips left" });
  await expect(previous).toBeVisible();
  await previous.click();
  await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeLessThanOrEqual(8);
  await expect(previous).toHaveCount(0);

  // The card is the trip's front door.
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.tripId}$`));
});
