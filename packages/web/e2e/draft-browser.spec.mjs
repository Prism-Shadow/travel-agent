/** Draft browser choice through the real UI/API and a controllable desktop bridge. */
import { test, expect } from "@playwright/test";
import { composer, provisionAndLogin } from "./auth.mjs";
const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const RUN = Date.now().toString(36);

async function setup(page, suffix, desktop = true, lang = "en") {
  await page.addInitScript(
    ({ desktop, lang }) => {
      localStorage.setItem("penguin.lang", lang);
      localStorage.setItem("penguin.theme", lang === "zh" ? "dark" : "light");
      if (!desktop) return;
      const choices = JSON.parse(localStorage.getItem("qa.browserChoices") || "{}");
      const listeners = new Set();
      const readyListeners = new Set();
      const state = {
        present: false,
        visible: false,
        requested: false,
        tabs: [],
        activeTabId: null,
        sessionScope: null,
        backend: "iab",
        backendLocked: false,
        extensionBackendAvailable: true,
        profileResetLocked: false,
      };
      const publish = () => listeners.forEach((fn) => fn({ ...state }));
      const controls = {
        state,
        choices,
        promotions: [],
        fail: false,
        defer: false,
        finish: null,
        connected: false,
        ready() {
          readyListeners.forEach((fn) => fn());
        },
        update(patch) {
          Object.assign(state, patch);
          publish();
        },
      };
      window.qaBrowser = controls;
      window.travelAgentBrowser = {
        available: true,
        getState: async () => ({ ...state }),
        onState(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        onFocusAddress: () => () => {},
        onExtensionReady(fn) {
          readyListeners.add(fn);
          return () => readyListeners.delete(fn);
        },
        hideNow: () => true,
        setBounds: async () => {},
        captureActivePage: async () => null,
        setOccluded: async () => {},
        tasksChanged: async () => {},
        async setOpen(requested) {
          state.requested = requested;
          publish();
        },
        async setSession(scope) {
          state.sessionScope = scope;
          state.backend = choices[scope] || "iab";
          publish();
          return scope;
        },
        async setBackend(backend) {
          if (controls.defer)
            await new Promise((resolve) => {
              controls.finish = resolve;
            });
          if (controls.fail) throw new Error("The browser choice could not be saved");
          if (state.backendLocked || (backend === "extension" && !state.extensionBackendAvailable))
            throw new Error("Browser unavailable");
          choices[state.sessionScope] = backend;
          localStorage.setItem("qa.browserChoices", JSON.stringify(choices));
          state.backend = backend;
          publish();
          if (backend === "extension" && controls.connected) setTimeout(() => controls.ready(), 0);
        },
        async reassignSession(id) {
          choices[id] = state.backend;
          controls.promotions.push({ from: state.sessionScope, to: id, backend: state.backend });
          state.sessionScope = id;
          publish();
          return id;
        },
      };
    },
    { desktop, lang },
  );
  const user = `browser${suffix}${RUN}`;
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
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${BASE}/chat/new`);
  await expect(composer(page)).toBeVisible();
  return project;
}
const selector = (page) => page.getByRole("button", { name: "Choose browser", exact: true });
async function chooseChrome(page) {
  await selector(page).click();
  await page.getByRole("menuitemradio", { name: /^Chrome extension/ }).click();
  await expect(selector(page)).toContainText("Chrome extension");
}

test("Chrome can be chosen before the first send, survives reload and travels with a parked draft", async ({
  page,
}) => {
  const project = await setup(page, "first");
  await page.setViewportSize({ width: 1760, height: 1000 });
  await expect(selector(page)).toContainText("In-app browser");
  await expect(page.getByRole("button", { name: "Show browser", exact: true })).toHaveCount(0);
  const budget = await page
    .getByRole("button", { name: "Budget", exact: true })
    .locator("..")
    .boundingBox();
  const browser = await selector(page).boundingBox();
  expect(browser.x).toBeGreaterThan(budget.x);
  expect(browser.y).toBe(budget.y);
  await chooseChrome(page);
  await composer(page).fill("Explore Shanghai transport options.");
  await expect
    .poll(() =>
      page.evaluate((project) => {
        const user = project.replace(/-default_project$/, "");
        return JSON.parse(localStorage.getItem(`penguin.chatDraft.${user}.${project}`) || "{}")
          .text;
      }, project),
    )
    .toBe("Explore Shanghai transport options.");
  await page.reload();
  await expect(selector(page)).toContainText("Chrome extension");
  await expect(composer(page)).toHaveValue("Explore Shanghai transport options.");
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "New trip", exact: true })
    .click();
  await expect(selector(page)).toContainText("In-app browser");
  await page
    .getByRole("button", { name: "Explore Shanghai transport options.", exact: true })
    .click();
  await expect(selector(page)).toContainText("Chrome extension");
  const sessions = await (
    await page.request.get(`${BASE}/api/projects/${project}/agents/default_agent/sessions`)
  ).json();
  expect(sessions.sessions).toHaveLength(0);
  let firstTask;
  await page.route("**/api/sessions/*/tasks", async (route) => {
    if (route.request().method() === "POST")
      firstTask = await page.evaluate(() => ({ ...window.qaBrowser.state }));
    await route.continue();
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/session-/);
  expect(firstTask.backend).toBe("extension");
  expect(firstTask.sessionScope).toBe(page.url().split("/chat/")[1]);
});

test("pending and failed selections never submit the draft on the prior browser", async ({
  page,
}) => {
  await setup(page, "pending");
  await composer(page).fill("Keep this question while choosing a browser.");
  await page.evaluate(() => {
    window.qaBrowser.defer = true;
  });
  await selector(page).click();
  await page.getByRole("menuitemradio", { name: /^Chrome extension/ }).click();
  await expect(selector(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await composer(page).press("Enter");
  await expect(page).toHaveURL(/\/chat\/new$/);
  await page.evaluate(() => {
    window.qaBrowser.fail = true;
    window.qaBrowser.finish();
  });
  await expect(
    page.getByText("The browser choice could not be saved", { exact: true }),
  ).toBeVisible();
  await expect(selector(page)).toContainText("In-app browser");
  await expect(composer(page)).toHaveValue("Keep this question while choosing a browser.");
});

test("unavailable Chrome stays selected, task locking disables the selector, and keyboard selection works", async ({
  page,
}) => {
  await setup(page, "unavailable");
  await chooseChrome(page);
  await composer(page).fill("Do not silently switch browsers.");
  await page.evaluate(() => window.qaBrowser.update({ extensionBackendAvailable: false }));
  await expect(selector(page)).toContainText("Chrome extension");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await selector(page).click();
  await expect(page.getByRole("menuitemradio", { name: /^Chrome extension/ })).toBeDisabled();
  await expect(page.getByText(/Chrome connection helper is not ready/)).toBeVisible();
  await page.keyboard.press("Escape");
  await selector(page).press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: /^In-app browser/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(selector(page)).toContainText("In-app browser");
  await page.evaluate(() => window.qaBrowser.update({ backendLocked: true }));
  await expect(selector(page)).toBeDisabled();
  await page.evaluate(() => window.qaBrowser.update({ backendLocked: false }));
  await page.setViewportSize({ width: 390, height: 844 });
  await selector(page).click();
  const menu = await page.getByRole("menu", { name: "Choose browser" }).boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
});

test("plain web does not offer desktop browser choices", async ({ page }) => {
  await setup(page, "web", false);
  await expect(selector(page)).toHaveCount(0);
});

for (const lang of ["en", "zh"]) {
  test(`Chrome connection confirmation preserves the draft and keyboard focus (${lang})`, async ({
    page,
  }) => {
    const project = await setup(page, `ready${lang}`, true, lang);
    const trigger = page.getByRole("button", {
      name: lang === "zh" ? "选择浏览器" : "Choose browser",
      exact: true,
    });
    await expect(trigger).toBeEnabled();
    await composer(page).fill("Keep this unsent travel question.");
    await page.evaluate(() => {
      window.qaBrowser.connected = true;
    });
    await trigger.click();
    await page.getByRole("menuitemradio", { name: /^Chrome (extension|扩展)/ }).click();

    const dialog = page.getByRole("dialog", {
      name: lang === "zh" ? "Chrome 已连接" : "Chrome is connected",
      exact: true,
    });
    const done = dialog.getByRole("button", {
      name: lang === "zh" ? "继续对话" : "Continue chatting",
      exact: true,
    });
    const close = dialog.getByRole("button", {
      name: lang === "zh" ? "关闭" : "Close",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Travel Browser", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(lang === "zh" ? "想使用已打开的网页？" : "Use a page you already opened?", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(done).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(done).toBeFocused();

    if (lang === "zh") {
      await page.setViewportSize({ width: 390, height: 700 });
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
      await expect(done).toBeInViewport();
    }
    await done.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText(lang === "zh" ? "Chrome 扩展" : "Chrome extension");
    await expect(composer(page)).toHaveValue("Keep this unsent travel question.");

    await page.evaluate(() => window.qaBrowser.ready());
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.evaluate(() => window.qaBrowser.ready());
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const sessions = await (
      await page.request.get(`${BASE}/api/projects/${project}/agents/default_agent/sessions`)
    ).json();
    expect(sessions.sessions).toHaveLength(0);
  });
}
