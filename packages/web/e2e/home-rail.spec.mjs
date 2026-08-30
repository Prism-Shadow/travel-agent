/**
 * The draft screen's discovery rail has two mutually exclusive states.
 *
 * First run: "Get inspired" only — editorial prompts are scaffolding for the person with
 * nothing to continue. Returning: "Up next" (the soonest-departing trip as one data-rendered
 * card: countdown, meta line, chat count) over "Jump back in", and the inspiration cards are
 * gone — a returning traveller's own Kyoto trip outranks a canned card that cannot see it.
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

  // A dated future trip (the Up next pick), plus one attached and one loose conversation.
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
  const card = page.locator("[data-up-next-card]");
  await expect(card).toContainText("Kyoto");
  await expect(card).toContainText("Departs in 12 days");
  await expect(card).toContainText("2 travellers");
  // Dates compact to month-day on the card; the full ISO form belongs to the sidebar.
  await expect(card).not.toContainText(isoPlusDays(12));
  await expect(card).toContainText("1 chat");
  await expect(page.getByRole("heading", { name: "Jump back in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get inspired" })).toHaveCount(0);

  // The card is the trip's front door.
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.tripId}$`));
});
