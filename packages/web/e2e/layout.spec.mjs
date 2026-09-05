/**
 * Layout regressions:
 * - the English draft page must not overflow horizontally on desktop (1280) or mobile (390)
 *   (the input card's toolbar row help text / button text must wrap to fit the **card width**;
 *   it used to blow out the card under English copy);
 * - the draft state doesn't show the context-usage ring (no session yet); it shows normally
 *   once inside a session;
 * - the models page at 390x844 must not overflow horizontally, and text must not overlap
 *   (the group header's provider name used to get pushed out of the button box and overlap
 *   the group-level actions), and its model dialog opts every field out of browser autofill
 *   (the API-key box used to receive the account's saved password, the box above it the
 *   username);
 * - every chat-page dropdown menu, opened at phone widths (375/390), must keep its panel
 *   inside the viewport and must not shove the page sideways (the model menu used to run
 *   ~34px off-screen left, the skills menu ~92px off-screen right — with its autofocused
 *   search box then horizontally scrolling the whole draft page — and the workspace menu
 *   ~143px off-screen right when the ownership pills share one row);
 * - no page grows the **document**: the app shell is height-constrained and each page scrolls
 *   inside its own container, so a second scrollbar means either an absolutely positioned
 *   descendant escaped its scroller (the Traces tree and the Agent settings page both had one,
 *   visible only with a second Agent below a long list) or something that cannot shrink no
 *   longer fits — checked at 420/320/240px tall in both sidebar states, since the sidebar's
 *   chrome used to stop fitting below ~412px;
 * - the sidebar's "New trip" button carries the selected navy fill;
 * - the collapsed rail shows, in product-specified order, last conversation / new chat /
 *   Agents / Models / Cost Center / Trajectories / Evaluation Center with localized
 *   (en + zh) hover
 *   tooltips; "last conversation" targets the newest non-archived session and is disabled
 *   while none exists; expanding from the rail restores the pinned sidebar;
 * - login page: decorative routes share the theme, animation can stop, and the form
 *   remains accessible on narrow screens and with reduced motion.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, composer, provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "layoutuser";
const P = "password123";

const docWidths = (page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

/** Count of pairwise rectangle intersections among visible leaf text elements (2px tolerance; ancestor-descendant pairs excluded). */
const textOverlapCount = (page) =>
  page.evaluate(() => {
    // Visibility is inherited, so this has to walk up. A leaf can be perfectly opaque inside a
    // container the page has faded out — the Models page collapses a vendor group by animating
    // `grid-template-rows` to `0fr` and its contents to `opacity: 0`, and the rows keep their own
    // computed opacity of 1. Checking only the leaf counted a group nobody can see as text on
    // screen, and reported it overlapping the button that is drawn where the group used to be.
    // That is not a layout defect; it is this function failing to look past one element.
    const isVisible = (el) => {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) <= 0.05) {
          return false;
        }
      }
      return true;
    };
    const leaves = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!isVisible(el)) continue;
      const hasText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent && n.textContent.trim(),
      );
      if (!hasText) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      leaves.push({ el, r });
    }
    const TOL = 2;
    let count = 0;
    for (let i = 0; i < leaves.length; i += 1) {
      for (let j = i + 1; j < leaves.length; j += 1) {
        const a = leaves[i];
        const b = leaves[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > TOL && h > TOL) count += 1;
      }
    }
    return count;
  });

test("layout: en draft + context gauge + mobile models", async ({ page }) => {
  // English copy is longer, making it the worst case for layout wrapping.
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, U, P);
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
          contextWindow: 200000,
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
        { provider: "openai", modelId: "gpt-5.5", apiKey: "sk-mock2" },
        { provider: "google", modelId: "gemini-3-pro" },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  // --- Draft page: must not overflow horizontally on desktop or mobile; no context ring in draft state ---
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE}/chat/new`);
  await composer(page).waitFor();
  let d = await docWidths(page);
  expect(d.scrollWidth, "draft @1280 no horizontal overflow").toBeLessThanOrEqual(d.clientWidth);
  await expect(page.locator('[title*="Context usage"]')).toHaveCount(0);

  // --- Session state shows the ring as usual (creating a session via the API and entering it directly, no need to actually run a Task) ---
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8" },
    })
  ).json();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  await composer(page).waitFor();
  await expect(page.locator('[title*="Context usage"]')).toHaveCount(1);

  // --- Models page @390: must not overflow, text must not overlap ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/models`);
  await page.getByText("claude-4-8").first().waitFor();
  d = await docWidths(page);
  expect(d.scrollWidth, "models @390 no horizontal overflow").toBeLessThanOrEqual(d.clientWidth);
  expect(await textOverlapCount(page), "models @390 no overlapping text").toBe(0);

  // --- Model dialog: no field may invite the browser's saved login. The dialog's fields are
  // unowned (no <form>), so the browser groups them with the rest of the page and picks a
  // "username" box on its own — it used to fill the account credentials into the API key and
  // the field above it. A password box additionally has to say "new-password": Chrome and
  // Safari ignore autocomplete="off" there. ---
  //
  // Its vendor group starts collapsed, and a collapsed group is faded out with its height driven
  // to zero — the row is in the DOM and Playwright happily resolves it, but the group header is
  // what actually receives the click. Expand first.
  // The vendor group holding it, located by name. Not the first `aria-expanded` on the page:
  // that is the sidebar's developer-console row, and clicking it opened a menu over the list.
  const group = page.getByRole("button", { name: /Custom/, expanded: false });
  if ((await group.count()) > 0) await group.first().click();
  await page.getByText("claude-4-8").first().click();
  const dialogFields = await page.evaluate(() =>
    [...document.querySelectorAll("input")]
      .filter((i) => i.type !== "checkbox" && i.type !== "file")
      .map((i) => ({
        type: i.type,
        autocomplete: i.getAttribute("autocomplete"),
        ignored: i.hasAttribute("data-1p-ignore") && i.getAttribute("data-lpignore") === "true",
      })),
  );
  expect(dialogFields.length, "model dialog fields found").toBeGreaterThan(3);
  expect(
    dialogFields.filter((f) => f.type === "password"),
    "the API-key box opts out as new-password",
  ).toEqual([{ type: "password", autocomplete: "new-password", ignored: true }]);
  expect(
    dialogFields.filter((f) => f.autocomplete !== "off" && f.type !== "password"),
    "no other field declares an autofill role",
  ).toEqual([]);
  expect(
    dialogFields.filter((f) => !f.ignored),
    "every field carries the password-manager opt-out",
  ).toEqual([]);
  await page.keyboard.press("Escape");

  // --- The unified New trip entry uses the compact navigation style: transparent off the draft page. ---
  //
  // Scoped to the sidebar rather than to `nav`: the expanded sidebar has no `nav` element at all
  // now -- that markup belongs to the collapsed rail, and the rail lost its page links when the
  // engine's console moved behind the settings row.
  await page.setViewportSize({ width: 1280, height: 720 });
  const newChat = page.getByRole("complementary").getByRole("button", { name: "New trip" }).first();
  await expect(newChat).toBeVisible();
  expect(
    await newChat.evaluate((el) => getComputedStyle(el).backgroundColor),
    "new-trip button has no background fill outside the draft page",
  ).toBe("rgba(0, 0, 0, 0)");
});

test("layout: collapsed rail — order, bilingual tooltips, last conversation", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, "railuser", P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [{ provider: "custom", modelId: "claude-4-8", apiKey: "sk-mock" }],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  // --- No sessions yet: the rail renders its two entries, "last conversation" disabled ---
  //
  // Two, not the seven it once had. Agents, Models, Cost Center, Trajectories and Evaluation
  // Center are the engine's console, not a traveller's navigation, and they moved behind the
  // settings row at the bottom of the expanded sidebar. The collapsed rail is what remains when
  // there is room for almost nothing: it holds only what someone on a trip would reach for.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE}/chat`);
  const accountAvatar = page.getByRole("complementary").locator('img[src="/user-avatar.png"]');
  await expect(accountAvatar).toBeVisible();
  await expect.poll(() => accountAvatar.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  const brand = page.getByRole("complementary").getByText("Travel Agent", { exact: true });
  const brandBox = await brand.boundingBox();
  const collapseBox = await collapse.boundingBox();
  expect(
    collapseBox.x,
    "collapse control follows the brand without overlapping it",
  ).toBeGreaterThan(brandBox.x + brandBox.width);
  expect(
    Math.abs(brandBox.y + brandBox.height / 2 - collapseBox.y - collapseBox.height / 2),
    "brand and collapse control share a header row",
  ).toBeLessThan(3);
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  const railAvatar = page.getByRole("button", { name: "railuser", exact: true }).locator("img");
  await expect(railAvatar).toHaveAttribute("src", "/user-avatar.png");
  await expect(railAvatar).toBeVisible();
  await expect.poll(() => railAvatar.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  const rail = page.locator("aside nav");
  const entries = rail.locator("a, button");
  await expect(entries).toHaveCount(2);
  await expect(rail.getByRole("button", { name: "Last conversation" })).toBeDisabled();

  // --- Order and tooltips (en): aria-label defines the order, title carries the same copy ---
  const EN = ["Last conversation", "New trip"];
  const attrs = (name) =>
    entries.evaluateAll((els, n) => els.map((el) => el.getAttribute(n)), name);
  expect(await attrs("aria-label"), "rail order (en)").toEqual(EN);
  expect(await attrs("title"), "rail tooltips (en)").toEqual(EN);

  // --- Three sessions via the API (distinct createdAt), newest archived: the rail must target the newest *non-archived* one ---
  const mkSession = async () => {
    const res = await page.request.post(
      `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
      { data: { provider: "custom", modelId: "claude-4-8" } },
    );
    expect(res.ok(), "create session").toBeTruthy();
    return (await res.json()).session.sessionId;
  };
  await mkSession();
  await page.waitForTimeout(25);
  const target = await mkSession();
  await page.waitForTimeout(25);
  const archived = await mkSession();
  const patched = await page.request.patch(`${BASE}/api/sessions/${archived}`, {
    data: { archived: true },
  });
  expect(patched.ok(), "archive newest session").toBeTruthy();
  await page.reload(); // the session store loads on mount; the collapsed state persists via localStorage

  // A click during the fetch window is a graceful no-op (the entry stays enabled while the
  // list loads), so retry click+assert until the store has settled.
  await expect(async () => {
    await rail.getByRole("button", { name: "Last conversation" }).click();
    await expect(page, "last conversation → newest non-archived session").toHaveURL(
      `${BASE}/chat/${target}`,
      { timeout: 1000 },
    );
  }).toPass({ timeout: 15_000 });
  // Active fill = the *unprefixed* bg-gray-200/70 token (the resting state carries hover:bg-gray-200/70, which a bare substring match would also hit).
  const ACTIVE_FILL = /(^|\s)bg-gray-200\/70(\s|$)/;
  // On a conversation, the entry lights as "you are here" (any non-draft /chat/:id).
  await expect(rail.getByRole("button", { name: "Last conversation" })).toHaveClass(ACTIVE_FILL);

  // --- New chat enters the draft page and shows the rail's gray active fill there ---
  await rail.getByRole("button", { name: "New trip" }).click();
  await expect(page).toHaveURL(`${BASE}/chat/new`);
  await expect(rail.getByRole("button", { name: "New trip" })).toHaveClass(ACTIVE_FILL);
  // The draft belongs to the new-chat entry: the last-conversation one must not stay lit here.
  await expect(rail.getByRole("button", { name: "Last conversation" })).not.toHaveClass(
    ACTIVE_FILL,
  );

  // --- No console routes here: those pages are reached from the settings row, not the rail ---
  await expect(rail.getByRole("link", { name: "Models" })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: "Agents" })).toHaveCount(0);

  // --- zh: tooltips follow the product-specified wording ---
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "zh"));
  await page.reload();
  await expect(entries).toHaveCount(2);
  const ZH = ["最近一次对话", "新行程"];
  expect(await attrs("aria-label"), "rail order (zh)").toEqual(ZH);
  expect(await attrs("title"), "rail tooltips (zh)").toEqual(ZH);

  // --- Expand: the rail's top button (localized) restores the pinned sidebar ---
  //
  // Scoped to the sidebar that holds the rail. A bare `aside` is ambiguous now: the draft screen
  // renders a second one, the "jump back in" column, and a strict locator resolves to both.
  await page.getByRole("button", { name: "展开侧栏" }).click();
  const pinned = page
    .locator("aside")
    .filter({ has: page.getByRole("button", { name: "收起侧栏" }) });
  await expect(pinned).toHaveClass(/w-64/);
  await expect(page.getByRole("button", { name: "收起侧栏" })).toBeVisible();
});

test("layout: mobile chat dropdowns stay inside the viewport", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, "layoutdropdowns", P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  // Keyed models unblock the draft page (no "missing key" modal); the long-id model pushes the
  // model menu's w-max width to its clamp, and the key-less one adds the show-all expander row.
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
        { provider: "openai", modelId: "gpt-5.5", apiKey: "sk-mock2" },
        {
          provider: "custom",
          modelId: "anthropic/claude-sonnet-4-5-thinking-preview",
          apiKey: "sk-mock3",
        },
        { provider: "google", modelId: "gemini-3-pro" },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();

  const panel = page.locator("body > div.anim-pop, div.anim-pop.z-40");
  /** Assert the one open menu panel and the page itself stay inside the viewport. */
  const checkPanel = async (name) => {
    await expect(panel, `${name}: menu open`).toHaveCount(1);
    await page.waitForTimeout(200); // let the pop-in scale animation settle before measuring
    const m = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      // A horizontally scrolled ancestor is the old failure mode: the menu's autofocused
      // search box dragged the overflowing panel into view, shoving the page sideways.
      let scrolled = 0;
      for (let p = el.parentElement; p; p = p.parentElement) {
        scrolled = Math.max(scrolled, Math.abs(p.scrollLeft));
      }
      return { left: r.left, right: r.right, vw: window.innerWidth, scrolled };
    });
    expect(m.left, `${name}: panel left edge on-screen`).toBeGreaterThanOrEqual(0);
    expect(m.right, `${name}: panel right edge on-screen`).toBeLessThanOrEqual(m.vw);
    expect(m.scrolled, `${name}: page not scrolled sideways`).toBe(0);
    const d = await docWidths(page);
    expect(d.scrollWidth, `${name}: no horizontal overflow`).toBeLessThanOrEqual(d.clientWidth);
    // On-screen coordinates alone don't prove the panel is *painted*: an ancestor with a
    // non-visible overflow (the composer toolbar scrolls horizontally on phones) clips it
    // while leaving its rect intact. Hit-test a point inside the panel's **visible** area —
    // the rect's intersection with the viewport, since a long menu may legitimately extend
    // past the fold on a page that scrolls.
    await expect(panel, `${name}: panel visible`).toBeInViewport();
    const hit = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      if (bottom - top < 2) return "no visible area";
      const x = Math.round(Math.max(r.left, 0) + Math.min(r.width / 2, 40));
      const y = Math.round(top + Math.min((bottom - top) / 2, 20));
      const hitEl = document.elementFromPoint(x, y);
      if (!hitEl) return "nothing at the sampled point";
      return el.contains(hitEl) || el === hitEl ? true : `covered by ${hitEl.tagName}`;
    });
    expect(hit, `${name}: panel not clipped by an ancestor`).toBe(true);
  };
  const open = async (label, name) => {
    await page.locator(`button[aria-label="${label}"]`).click();
    await checkPanel(name);
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  };

  // The draft screen's Workspace and Agent pickers are gone: a traveller does not choose a
  // directory or an engine persona to plan a trip in, so the menus this section measured -- and
  // the desktop regression about the Workspace menu flipping over the greeting -- have nothing
  // left to open. What remains below still covers the pickers the composer does have.

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE}/chat/new`);
  await composer(page).waitFor();

  // Draft page, both common phone widths. The two widths exercise different geometry for the
  // ownership pills below the card: at 375 they wrap onto two rows (workspace pill at the row
  // start), at 390 they share one row (workspace pill anchored mid-screen).
  for (const vp of [
    { width: 375, height: 667 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(vp);
    await page.goto(`${BASE}/chat/new`);
    await composer(page).waitFor();
    // Model / thinking-level buttons stay disabled until models and the agent config load.
    await expect(page.locator('button[aria-label="Choose model"]')).toBeEnabled();
    await expect(page.locator('button[aria-label="Thinking level"]')).toBeEnabled();
    await open("Approval mode", `approval @${vp.width}`);
    await close();
    await open("Thinking level", `thinking @${vp.width}`);
    await close();
    await open("Choose model", `model @${vp.width}`);
    // Reveal the key-less remainder — the widest state of the w-max panel — and re-check.
    await page.getByRole("button", { name: /without a key/ }).click();
    await checkPanel(`model show-all @${vp.width}`);
    await close();
  }

  // Session state (bottom-docked composer, menus open upward). The composer toolbar scrolls
  // horizontally at phone widths, so every picker in it must escape that clipping ancestor —
  // checked idle **and** while a Task runs (an always-ask session parks on a pending
  // approval), at the narrowest widths we support.
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "always-ask" },
    })
  ).json();
  const sessionPickers = ["Approval mode", "More input options", "Thinking level"];
  for (const vp of [
    { width: 320, height: 640 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(vp);
    await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
    await composer(page).waitFor();
    for (const label of sessionPickers) {
      await open(label, `${label} @session ${vp.width}`);
      await close();
    }
  }

  // Running state: send a message, wait for the pending approval (the run stays running), then
  // re-open every picker. The composer stays enabled for steering, so the row is at its
  // busiest here — this is the state the toolbar overflowed in.
  await composer(page).fill("Help me set up @theme");
  await page.locator('button[aria-label="Send"]').click();
  await page.getByRole("button", { name: /^Allow$/ }).waitFor();
  // There is no skills picker to lock: skills are built in and never chosen here.
  await expect(page.locator('button[aria-label="Skills"]')).toHaveCount(0);
  for (const label of ["Approval mode", "More input options", "Thinking level"]) {
    await open(label, `${label} @running 375`);
    await close();
  }
  // …and the toolbar itself still fits, with the merged Stop/Send button reachable.
  const running = await docWidths(page);
  expect(running.scrollWidth, "running toolbar: no horizontal overflow").toBeLessThanOrEqual(
    running.clientWidth,
  );
  await expect(page.locator('button[aria-label="Stop"]')).toBeVisible();

  // Running + pending approval at 390x844: every running-state row must stay one line below
  // sm — the page must not scroll sideways, the work-group header must not wrap to a second
  // line, and the Allow/Deny action buttons read as text at every breakpoint (per review:
  // buttons the user presses must be words, iconic shorthand is for passive indicators only).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const d390 = await docWidths(page);
  expect(d390.scrollWidth, "running @390 no horizontal overflow").toBeLessThanOrEqual(
    d390.clientWidth,
  );
  // Single line = ~33px (py-2 + one text line); a wrapped header would measure ~48px+.
  const workHeader = page.locator("button[aria-expanded]").filter({ hasText: "Running" }).first();
  expect(
    await workHeader.evaluate((el) => el.clientHeight),
    "work-group header stays single-line @390",
  ).toBeLessThanOrEqual(40);
  await expect(page.getByRole("button", { name: /^Allow$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Deny$/ })).toBeVisible();
  // The words themselves are rendered — not a glyph with an aria-label.
  await expect(page.getByRole("button", { name: /^Allow$/ })).toHaveText("Allow", {
    useInnerText: true,
  });
  await expect(page.getByRole("button", { name: /^Deny$/ })).toHaveText("Deny", {
    useInnerText: true,
  });
  expect(await textOverlapCount(page), "running @390 no overlapping text").toBe(0);

  // While PENDING the one-line rule yields on purpose: the user must read the whole command
  // before deciding, so below sm the preview wraps in full (pre-wrap, no truncation, the block
  // may grow) instead of clipping.
  const pendingPreview = page.getByText("$ ls -la").first();
  await expect(pendingPreview, "full command shown while pending @390").toBeVisible();
  const pv = await pendingPreview.evaluate((el) => ({
    whiteSpace: getComputedStyle(el).whiteSpace,
    clipped: el.scrollWidth > el.clientWidth + 1,
  }));
  expect(pv.whiteSpace, "pending preview wraps below sm").toBe("pre-wrap");
  expect(pv.clipped, "pending preview not clipped @390").toBe(false);

  // Approve and let the turn finish: the per-reply stats footer must keep to its one fixed
  // line at 390 (it used to wrap its chips onto a clipped second row that painted over the
  // content below). On phones the row is slimmed to FIT: TPS is dropped and cost/elapsed use
  // compact decimals, the hidden-scrollbar sideways scroll remaining only as a fallback; the
  // copy button sits outside the scroll area so it can't scroll out of reach.
  await page.getByRole("button", { name: /^Allow$/ }).click();
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();
  const footer = page.getByRole("button", { name: "Copy reply" }).first().locator("xpath=..");
  // Below sm the footer is ALWAYS visible at rest (no hover on touch screens — hover-gated
  // opacity meant phones could never see the stats at all); ≥sm keeps the hover reveal, which
  // chat.spec asserts at desktop width.
  await page.mouse.move(0, 0);
  await expect(footer, "stats footer visible at rest @390").toHaveCSS("opacity", "1");
  // The USER message's footer (time + copy, bubble bottom-right) gets the same treatment:
  // always visible below sm, since touch has no hover to reveal it with.
  const userCopy = page.getByRole("button", { name: "Copy message" }).first();
  await expect(userCopy, "user copy button visible at rest @390").toBeVisible();
  await expect(userCopy.locator("xpath=.."), "user footer visible at rest @390").toHaveCSS(
    "opacity",
    "1",
  );
  // Chips at 390: input/output/elapsed shown (no pricing configured -> no cost chip); TPS is
  // deliberately dropped below sm to keep the row inside the width.
  for (const chip of ["Input tokens", "Output tokens", "Elapsed"]) {
    await expect(footer.locator(`[title="${chip}"]`), `${chip} chip present @390`).toBeVisible();
  }
  await expect(footer.locator('[title="Output TPS"]'), "TPS chip in DOM").toHaveCount(1);
  await expect(footer.locator('[title="Output TPS"]'), "TPS chip hidden @390").toBeHidden();
  // With TPS dropped and compact decimals the common case FITS at 390 — no sideways scroll
  // needed (the scroll container remains only as a fallback for extreme values).
  const statsSpan = footer.locator("span").first();
  const fit = await statsSpan.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(fit.sw, "stats row fits @390 without scrolling").toBeLessThanOrEqual(fit.cw + 1);
  const footerH = await footer.evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(footerH.scroll, "stats footer stays single-line @390").toBeLessThanOrEqual(
    footerH.client + 1,
  );
  const copyBox = await page.getByRole("button", { name: "Copy reply" }).first().boundingBox();
  expect(copyBox.x, "copy button not pushed off-screen left @390").toBeGreaterThanOrEqual(0);
  expect(copyBox.x + copyBox.width, "copy button pinned on-screen @390").toBeLessThanOrEqual(390);
  // Inner scroll containers are fine; the page itself must not gain a sideways scroll.
  const dDone = await docWidths(page);
  expect(dDone.scrollWidth, "finished @390 no horizontal overflow").toBeLessThanOrEqual(
    dDone.clientWidth,
  );

  // The decision lives ONLY in the tool card's left status icon: "Approved · manual" on the
  // icon's title/aria-label, zero visible decision text on the row (the right-side indicator
  // was removed per review), and the header stays one line.
  await page.locator("button[aria-expanded]").filter({ hasText: "Done" }).last().click();
  const decided = page.locator('[aria-label="Approved · manual"]').first();
  await expect(decided, "status icon carries the decision @390").toBeVisible();
  const toolHeader = page.locator("button[aria-expanded]", { has: decided }).first();
  await expect(
    toolHeader.getByText(/Approved|Denied/).filter({ visible: true }),
    "no visible decision text on the card",
  ).toHaveCount(0);
  expect(
    await toolHeader.evaluate((el) => el.clientHeight),
    "tool-card header stays single-line @390",
  ).toBeLessThanOrEqual(40);
  expect(await textOverlapCount(page), "finished @390 no overlapping text").toBe(0);

  // A DENIED call must state its outcome once, not twice: the deny path itself reports
  // stop_reason "aborted", so the left status icon alone carries "Denied · manual"
  // (title/aria-label) and the redundant "aborted" badge is dropped. Fresh session: the mock
  // answers with plain text once any tool_result exists in the history.
  const sess2 = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "always-ask" },
    })
  ).json();
  await page.goto(`${BASE}/chat/${sess2.session.sessionId}`);
  await composer(page).fill("Help me check the directory");
  await page.locator('button[aria-label="Send"]').click();
  await page.getByRole("button", { name: /^Deny$/ }).click();
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();
  await page.locator("button[aria-expanded]").filter({ hasText: "Done" }).last().click();
  const denied = page.locator('[aria-label="Denied · manual"]').first();
  await expect(denied, "status icon carries the denial @390").toBeVisible();
  const deniedHeader = page.locator("button[aria-expanded]", { has: denied }).first();
  await expect(
    deniedHeader.getByText("aborted"),
    "no duplicate aborted badge on a denied call",
  ).toHaveCount(0);
  expect(
    await deniedHeader.evaluate((el) => el.clientHeight),
    "denied card header stays single-line @390",
  ).toBeLessThanOrEqual(40);
});

/**
 * The app shell is height-constrained: every page scrolls inside its own container and the
 * document itself must never scroll. What breaks that is an absolutely positioned descendant
 * whose containing block is the initial containing block — nothing between it and the root
 * clips it, so its static position past the fold grows the **document**, producing a second
 * scrollbar that drags the whole shell up. The Traces tree and the Agent settings page both
 * had one (the `sr-only` file inputs of their import controls), visible only once a second
 * Agent sat below a long list. This sweep is the general guard: with the data that exposes it,
 * no page may grow the document.
 */
test("layout: no page grows the document (absolute descendants stay in their scroller)", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "layoutheight", P);
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
  // A second Agent is what moves an import control below the fold; the Traces tree only lists
  // Sessions that have a Trace file, so each one has to actually run a Task.
  const second = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: "agent_two", name: "Agent Two" },
  });
  // 409 = the Agent survives from an earlier run of this spec against the same data root
  // (provisioning is idempotent by convention here, so a spec can be rerun on its own).
  expect([201, 409], "create second agent").toContain(second.status());
  for (const agentId of ["default_agent", "agent_two"]) {
    for (let i = 0; i < (agentId === "default_agent" ? 14 : 2); i += 1) {
      const created = await (
        await page.request.post(`${BASE}/api/projects/${projectId}/agents/${agentId}/sessions`, {
          data: { provider: "custom", modelId: "claude-4-8" },
        })
      ).json();
      await page.request.post(`${BASE}/api/sessions/${created.session.sessionId}/tasks`, {
        data: { input: [{ type: "text", text: "hi" }] },
      });
    }
  }

  // A short viewport puts the second Agent's node below the fold with a handful of Sessions
  // instead of dozens — the same geometry a full-height window reaches with a longer list.
  await page.setViewportSize({ width: 1440, height: 420 });
  const paths = ["/chat", "/agents", "/agents/default_agent", "/models"];
  const grewBy = (p) =>
    p.evaluate(() => {
      const de = document.documentElement;
      return de.scrollHeight - de.clientHeight;
    });
  const overflowing = [];
  for (const path of paths) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(1200);
    const grew = await grewBy(page);
    if (grew > 0) overflowing.push(`${path} (+${grew}px)`);
  }
  expect(overflowing, "pages whose document scrolls").toEqual([]);

  // The other way to grow the document: content that cannot shrink. The sidebar's own chrome
  // (Project switcher, New chat, the nav entries, user row) used to be fixed height and
  // stopped fitting below ~412px — a window that short is reachable by browser zoom or docked
  // devtools. The nav now scrolls with the session list, and the collapsed rail scrolls its
  // icons the same way, so both states shrink to nothing instead of pushing the page out.
  const railToggle = page.getByRole("button", { name: "收起侧栏" });
  for (const height of [420, 320, 240]) {
    await page.setViewportSize({ width: 1440, height });
    await page.goto(`${BASE}/chat`);
    await page.waitForTimeout(900);
    expect(await grewBy(page), `pinned sidebar @${height}`).toBe(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/chat`);
  await railToggle.click();
  for (const height of [420, 320, 240]) {
    await page.setViewportSize({ width: 1440, height });
    await page.waitForTimeout(700);
    expect(await grewBy(page), `collapsed rail @${height}`).toBe(0);
  }
});

test("layout: login — autoplay world map, reduced motion and responsive sign-in", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await page.goto(`${BASE}/login`);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.locator('header img[src*="travel-agent-logo"]')).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Welcome back" }).locator('img[src*="travel-agent-logo"]'),
  ).toBeVisible();
  const map = page.getByTestId("world-map");
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("aria-hidden", "true");
  await expect(map).toHaveAttribute("data-motion", "animated");
  const basemap = await page.request.get(`${BASE}/maps/world-dots.svg`);
  expect(basemap.ok()).toBe(true);
  expect(basemap.headers()["content-type"]).toContain("image/svg+xml");
  await expect(
    page.getByRole("button", { name: /(?:Pause|Play) background animation/ }),
  ).toHaveCount(0);

  // The English language option sits left of 中文 (asserted by geometric position); switching takes effect immediately (headless defaults to the en environment).
  const enBtn = page.getByRole("button", { name: "English", exact: true });
  const zhBtn = page.getByRole("button", { name: "中文", exact: true });
  const [enBox, zhBox] = [await enBtn.boundingBox(), await zhBtn.boundingBox()];
  expect(enBox.x, "English left of 中文").toBeLessThan(zhBox.x);
  await zhBtn.click();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // Theme toggle: Dark adds html.dark, Light removes it.
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  // The operating system setting disables both SVG travel and path-drawing motion.
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.getByRole("button", { name: "System", exact: true }).last().click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(map).toHaveAttribute("data-motion", "static");
  await expect(map.locator("animateMotion")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(map).toHaveAttribute("data-motion", "animated");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const { scrollWidth, clientWidth } = await docWidths(page);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    const submit = page.getByRole("button", { name: "Sign in", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await expect(page.getByRole("textbox", { name: /^Username/ })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("textbox", { name: /^Username/ }).fill(ADMIN_ID);
  await page
    .getByRole("textbox", { name: "Password Show password", exact: true })
    .fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/chat/);
  await expect(page.getByRole("button", { name: ADMIN_ID, exact: true })).toBeVisible();
});
