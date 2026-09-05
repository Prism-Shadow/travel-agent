import { test, expect } from "@playwright/test";
import { provisionAndLogin, login, ADMIN_ID, ADMIN_PASSWORD, composer } from "./auth.mjs";

const BASE = process.env.BASE_URL;

async function expectAccountMenuAligned(page, trigger) {
  const menu = page.getByRole("menu", { name: "Account menu" });
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => {
      const button = await trigger.boundingBox();
      const panel = await menu.evaluate((element) => {
        const rect = element.parentElement.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      return Math.max(
        Math.abs(panel.left - button.x),
        Math.abs(panel.right - button.x - button.width),
      );
    })
    .toBeLessThan(1);
}

test("account settings keep drafts, persist preferences and fit a phone", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, "settingsuser", "password123");
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`${BASE}/chat/new`);
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await composer(page).fill("Keep this travel idea while I adjust my settings.");
  await page.getByRole("button", { name: "settingsuser", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Account menu" });
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  await expect(menu.getByRole("menuitem", { name: "User management" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dark", exact: true })).toHaveCount(0);
  const account = page.getByRole("button", { name: "settingsuser", exact: true });
  await expectAccountMenuAligned(page, account);
  // A font change resizes the sidebar without firing window.resize.
  const previousFont = await page.evaluate(() => document.documentElement.style.fontSize);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "20px";
  });
  await expectAccountMenuAligned(page, account);
  await page.evaluate((font) => {
    document.documentElement.style.fontSize = font;
  }, previousFont);
  await expectAccountMenuAligned(page, account);
  await page.screenshot({ path: testInfo.outputPath("account-menu.png"), animations: "disabled" });
  await menu.getByRole("menuitem", { name: "Settings", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/new\?settings=appearance$/);
  await expect(composer(page)).toHaveValue("Keep this travel idea while I adjust my settings.");
  await expect(dialog.getByRole("button", { name: "Advanced", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(dialog.getByRole("button", { name: "Dark", exact: true })).toHaveCSS(
    "color",
    await dialog
      .getByRole("heading", { name: "Appearance", exact: true })
      .evaluate((element) => getComputedStyle(element).color),
  );
  await page.screenshot({ path: testInfo.outputPath("settings-dark.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "Light", exact: true }).click();
  await dialog.getByRole("button", { name: "Blue", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "blue");
  await page.screenshot({
    path: testInfo.outputPath("settings-appearance.png"),
    animations: "disabled",
  });

  await dialog.getByRole("button", { name: "Language & region", exact: true }).click();
  await dialog.getByRole("button", { name: "CNY ¥", exact: true }).click();
  await dialog.getByRole("button", { name: "中文", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "语言与地区", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(composer(page)).toHaveValue("Keep this travel idea while I adjust my settings.");
  await expect(dialog.getByRole("button", { name: "人民币 ¥", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dialog.getByRole("button", { name: "English", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();

  await page.setViewportSize({ width: 390, height: 700 });
  await dialog.getByRole("button", { name: "Appearance", exact: true }).click();
  await dialog.getByRole("button", { name: "Large", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Large", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await dialog.getByRole("button", { name: "Amber", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Amber", exact: true })).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("settings-mobile.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Standard", exact: true }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(`${BASE}/chat/new`);
  await expect(composer(page)).toHaveValue("Keep this travel idea while I adjust my settings.");
  await page.reload();
  await expect(composer(page)).toHaveValue("Keep this travel idea while I adjust my settings.");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "blue");

  // Mobile navigation closes behind the settings panel; Escape returns to the same draft.
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: "settingsuser", exact: true }).last().click();
  await expectAccountMenuAligned(
    page,
    page.getByRole("button", { name: "settingsuser", exact: true }).last(),
  );
  await page.screenshot({
    path: testInfo.outputPath("account-menu-mobile.png"),
    animations: "disabled",
  });
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sessions", exact: true })).toBeFocused();
});

test("administrator settings retain nested forms and explicit save boundaries", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await page.goto(`${BASE}/trips?settings=advanced`);
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByRole("button", { name: "Advanced", exact: true })).toBeVisible();
  const writes = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && /\/api\/(admin\/settings|me\/password)/.test(request.url()))
      writes.push(request.url());
  });
  await dialog.getByRole("button", { name: "Proxy options…", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Proxy options", exact: true })).toBeVisible();
  await page.getByLabel("Proxy address", { exact: true }).fill("http://127.0.0.1:9999");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Proxy options", exact: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  expect(writes).toHaveLength(0);

  await dialog.getByRole("button", { name: "Account & security", exact: true }).click();
  await dialog.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Change password", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Change password", exact: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Change password", exact: true })).toBeFocused();
  await expect(dialog.getByText("Profile editing is not available in this build.")).toBeVisible();
  await dialog.getByRole("button", { name: "About", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Check for updates", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: ADMIN_ID, exact: true }).click();
  await page.getByRole("menuitem", { name: "User management", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/admin/users`);
});
