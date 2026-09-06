/**
 * Auto-compaction triggered at the **end** of a round: item order is
 * assistant_text -> compaction -> task_stats, with the compaction banner sandwiched between
 * the reply and its stats line.
 *
 * This ordering used to break the "reply + stats line" pairing, leaving the stats line
 * orphaned — and since the whole line is transparent by default, being orphaned meant it was
 * neither visible nor hoverable (the element's own `group` class has no effect on itself:
 * group-hover is a descendant selector). Now the entire round's AI-side content, stats line
 * included, is wrapped in the same group, so hovering any content in the round reveals it.
 *
 * Trigger mechanism: the mock's usage grows with context length, pinning the threshold between
 * "below the first request" and "above the second request (which carries the tool result)", so
 * compaction only happens once, at the end of the round.
 */
import { test, expect } from "@playwright/test";
import { composer, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "compactuser";
const P = "password123";
/**
 * The mock reports usage as cache_read=40*msgCount, input=40, cache_creation=10,
 * plus output_tokens from message_stop. Through the Anthropic adapter:
 *   cached_tokens = cache_read = 40 * msgCount
 *   prompt_tokens = input + cache_creation = 50
 *   total = cached + prompt + output
 * Turn 1 (msgCount=1, output=30): total = 40 + 50 + 30 = 120
 * Turn 2 (msgCount~4, output=20): total = 160 + 50 + 20 = 230
 *
 * The Agent's compaction.max_context_length is set to 180 via the config API,
 * so turn 1 (120) is below the threshold and turn 2 (230) exceeds it.
 * contextWindow must be >= MIN_USABLE_CONTEXT_WINDOW (4096) to avoid fallback.
 */
const CONTEXT_WINDOW = 5000;
const COMPACTION_THRESHOLD = 180;

test("compaction mid-turn: the reply's stats line is still reachable by hovering the reply", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: CONTEXT_WINDOW,
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
      ],
    },
  });
  // Set the compaction threshold low enough for the mock's usage to trigger it.
  // effectiveMaxContextLength = min(COMPACTION_THRESHOLD, CONTEXT_WINDOW - 2048) = min(180, 2952) = 180.
  await page.request.put(`${BASE}/api/projects/${projectId}/agents/default_agent/config`, {
    data: { config: { compaction: { maxContextLength: COMPACTION_THRESHOLD } } },
  });
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();

  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  const ta = composer(page);
  await ta.waitFor();
  await ta.fill("Help me set up @theme");
  await page.getByRole("button", { name: "发送" }).click();

  const reply = page.getByText("Command finished; the result looks as expected.").first();
  await expect(reply).toBeVisible();
  const banner = page.getByText("压缩", { exact: true }).first();
  await expect(banner).toBeVisible();

  // The compaction banner doesn't show Token counts: compaction at round end isn't attributed
  // to this round (its usage shows up in the Session total and the Trace page's compaction-round
  // card instead) — the banner only states "compaction happened, succeeded or not."
  await expect(page.getByText(/压缩.*tokens/)).toHaveCount(0);

  // Order: reply -> **this round's stats line** -> compaction banner. The stats line is about
  // this round of conversation; compaction is housekeeping outside this round, listed after this
  // round's tally. (It used to be the other way around: the banner sat between the reply and the
  // stats line, making the stats line read like "compaction's stats," and this round's elapsed
  // time would fold in the entire compaction request — compaction is itself a full LLM request.)
  const copyBtn = page.getByRole("button", { name: "复制回复" }).first();
  const statsLine = copyBtn.locator("xpath=..");
  const yOf = async (l) => (await l.boundingBox()).y;
  expect(await yOf(statsLine)).toBeGreaterThan(await yOf(reply));
  expect(await yOf(banner)).toBeGreaterThan(await yOf(statsLine));

  // Transparent by default but space-reserved; hovering **the reply itself** reveals it
  // (it used to be orphaned -> never revealable).
  await page.mouse.move(0, 0);
  await expect(statsLine).toHaveCSS("opacity", "0");
  await reply.hover();
  await expect(statsLine).toHaveCSS("opacity", "1");
  await expect(statsLine.locator("text=/\\d{1,2}:\\d{2}/")).toBeVisible();

  // Compaction succeeded and no ordinary request has reported usage since, so the context ring must
  // read UNKNOWN (`—`), not 0. Zero would claim the context is empty — but the summary itself costs
  // tokens; we simply have not measured the new size yet.
  // humanizeTokens(5000) = "5k", so the display reads "—/5k".
  await expect(page.getByText(`—/5k`)).toBeVisible();
  await expect(page.getByText(`0/5k`)).toHaveCount(0);

  // The traces page was removed from the consumer surface; the compaction contract
  // (banner rendered, stats ordering, context ring unknown) is fully proven by the
  // UI assertions above. The trace-level compaction analysis (two tasks, elapsed-time
  // invariant) is covered by the unit test in stream-model.
});
