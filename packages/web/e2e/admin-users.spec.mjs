import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";

const BASE = process.env.BASE_URL;

test("admin users: account provisioning is absent from the consumer surface", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);

  await page.goto(`${BASE}/admin/users`);

  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add user" })).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: `${ADMIN_ID} initial password`, exact: true }),
  ).toBeVisible();
  const administrator = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: `${ADMIN_ID} initial password`, exact: true }),
  });
  await expect(administrator.getByRole("button", { name: "Reset password" })).toBeVisible();
});
