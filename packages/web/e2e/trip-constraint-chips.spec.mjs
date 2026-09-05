import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;

test("trip constraint chip draws keyboard focus around the pill shell", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, "tripchipfocususer", "password123");
  await page.goto(`${BASE}/chat/new`);
  await page.getByRole("button", { name: "Later", exact: true }).click();

  const trigger = page.getByRole("button", { name: "Who", exact: true });
  // The warning was dismissed with a pointer click. Establish keyboard modality before moving
  // focus programmatically, matching the Tab navigation state that activates :focus-visible.
  await page.keyboard.press("Tab");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect
    .poll(() => trigger.evaluate((button) => button.matches(":focus-visible")))
    .toBe(true);

  const focusStyle = await trigger.evaluate((button) => {
    const pill = button.parentElement;
    if (!pill) throw new Error("Trip constraint trigger has no pill shell");
    return {
      triggerOutline: getComputedStyle(button).outlineStyle,
      pillOutline: getComputedStyle(pill).outlineStyle,
      pillRadius: Number.parseFloat(getComputedStyle(pill).borderRadius),
    };
  });

  expect(focusStyle.triggerOutline).toBe("none");
  expect(focusStyle.pillOutline).toBe("solid");
  expect(focusStyle.pillRadius).toBeGreaterThan(10);
});

test("trip constraint dialogs use content-sized layouts and stable confirmation", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, "tripchipdialoguser", "password123");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/chat/new`);
  // A fresh Project has no model credential, so its setup warning legitimately owns the first
  // modal layer. Dismiss it through the visible action before testing the constraint dialogs.
  await page.getByRole("button", { name: "Later", exact: true }).click();

  const dialog = page.getByRole("dialog");
  const openDialog = async (name) => {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(dialog).toBeVisible();
    // The panel pops in over 120ms (scale 0.96 → 1). A box measured mid-flight is up to 4%
    // narrow, and which dialog gets caught there is paint timing — so the measurement waits
    // for the animation's end state, not for a delay that is usually long enough.
    await dialog.evaluate((panel) =>
      Promise.all(panel.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
    const box = await dialog.boundingBox();
    if (!box) throw new Error(`${name} dialog has no visible bounds`);
    return box;
  };
  const dismiss = async () => {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  };

  const whereBox = await openDialog("Where");
  const closeBox = await dialog.getByRole("button", { name: "Close" }).boundingBox();
  const headingBox = await dialog.getByRole("heading", { name: "Where" }).boundingBox();
  if (!closeBox || !headingBox) throw new Error("Where dialog header controls have no bounds");
  expect(closeBox.x, "close action stays left of the centered title").toBeLessThan(headingBox.x);
  expect(
    Math.abs(headingBox.x + headingBox.width / 2 - (whereBox.x + whereBox.width / 2)),
    "Where title is centered on the dialog, not the remaining header space",
  ).toBeLessThan(3);
  await expect(page.getByPlaceholder("City or region — several is fine")).toBeFocused();
  await dismiss();

  const whenBox = await openDialog("When");
  await expect(dialog.getByRole("button", { name: "Dates", exact: true })).toBeVisible();
  expect(whenBox.width, "two-month calendar gets the widest dialog").toBeGreaterThan(
    whereBox.width + 180,
  );
  expect(whenBox.width, "two-month calendar stays short of a near-full-screen sheet").toBeLessThan(
    800,
  );
  await dismiss();

  const whoBox = await openDialog("Who");
  await expect(dialog.getByText("1 traveler", { exact: true })).toBeVisible();
  expect(whoBox.width, "Who is narrower than the destination form").toBeLessThan(
    whereBox.width - 50,
  );
  expect(whoBox.height, "Who rows and actions stay compact").toBeLessThan(510);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "1 traveler", exact: true })).toBeVisible();

  await openDialog("1 traveler");
  await dialog.getByRole("button", { name: "+", exact: true }).first().click();
  await expect(dialog.getByText("2 travelers", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const budgetBox = await openDialog("Budget");
  expect(
    Math.abs(budgetBox.width - whoBox.width),
    "Who and Budget share the narrow form width",
  ).toBeLessThan(2);
  // Five radios plus the optional exact-total field; the cap moved when the field arrived.
  expect(budgetBox.height, "Budget choices and actions stay compact").toBeLessThan(600);
  // The en interface's home currency is USD until the person says otherwise, so the tier
  // scale and the stated total both read in dollars.
  const budgetChoice = dialog.getByRole("radio", { name: "sensibly priced ($$)", exact: true });
  await budgetChoice.click();
  await expect(budgetChoice).toHaveAttribute("aria-checked", "true");
  await expect(
    dialog,
    "selecting a tier leaves its checked state visible until Done",
  ).toBeVisible();
  // The exact total: digits only in the field, the formatted form on the chip, and the
  // sharper fact wins the pill over the tier.
  const amountInput = dialog.getByRole("textbox", { name: /^Total budget/ });
  await amountInput.fill("20000");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "$20,000", exact: true })).toBeVisible();

  // The unit is the traveller's to change. In English, yuan is qualified — a bare ¥ would read
  // as yen — and the tier scale follows the currency the budget now counts in.
  await page.getByRole("button", { name: "$20,000", exact: true }).click();
  await expect(dialog).toBeVisible();
  const currency = dialog.getByRole("combobox", { name: "Currency", exact: true });
  const currencies = page.getByRole("listbox", { name: "Currency", exact: true });
  await currency.click();
  await expect(currencies.getByRole("option")).toHaveCount(10);
  await expect(currencies.getByRole("option", { selected: true })).toContainText("USD");
  await currencies.getByRole("option", { name: "CNY Chinese Yuan", exact: true }).click();
  await expect(currencies).toHaveCount(0);
  await expect(currency).toBeFocused();
  await expect(amountInput).toHaveValue("20000");

  // Browsing with the keyboard and dismissing the menu must not silently commit a currency.
  await currency.press("ArrowDown");
  await currency.press("End");
  await expect(
    currencies.getByRole("option", { name: "THB Thai Baht", exact: true }),
  ).toBeInViewport();
  await currency.press("Escape");
  await expect(currencies).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(currency).toHaveText("CNY");
  await currency.press("ArrowUp");
  await currency.press("Home");
  await currency.press("ArrowDown");
  await currency.press("Enter");
  await expect(currency).toHaveText("USD");
  await currency.press("c");
  await currency.press("Enter");
  await expect(currency).toHaveText("CNY");

  await currency.click();
  await currency.press("Tab");
  await expect(currencies).toHaveCount(0);
  await expect(amountInput).toBeFocused();

  // The same menu stays inside a narrow viewport, including its last currency.
  await page.setViewportSize({ width: 390, height: 700 });
  await currency.click();
  await expect(currencies).toBeVisible();
  const menuBox = await currencies.boundingBox();
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(700);
  await currency.press("End");
  await expect(
    currencies.getByRole("option", { name: "THB Thai Baht", exact: true }),
  ).toBeInViewport();
  await amountInput.click();
  await expect(currencies).toHaveCount(0);
  await expect(currency).toHaveText("CNY");
  await expect(
    dialog.getByRole("radio", { name: "sensibly priced (¥¥)", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "CN¥20,000", exact: true })).toBeVisible();
});

test("Where offers accessible location suggestions and keeps the selected canonical label", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await page.route("**/api/locations/search**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("q")).toBe("Lon");
    expect(url.searchParams.get("lang")).toBe("en-US");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suggestions: [
          {
            id: "N:10797175",
            name: "London",
            detail: "England, United Kingdom",
            label: "London, England, United Kingdom",
          },
          {
            id: "N:240109189",
            name: "Long Beach",
            detail: "California, United States",
            label: "Long Beach, California, United States",
          },
        ],
      }),
    });
  });
  await provisionAndLogin(page.request, "tripchiplocationuser", "password123");
  await page.goto(`${BASE}/chat/new`);
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await page.getByRole("button", { name: "Where", exact: true }).click();

  const input = page.getByRole("combobox");
  await input.fill("Lon");
  const listbox = page.getByRole("listbox", { name: "Location suggestions" });
  await expect(listbox).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Suggestions by Photon", { exact: true })).toHaveCount(0);
  await expect(page.getByText("© OpenStreetMap", { exact: true })).toHaveCount(0);
  const london = listbox.getByRole("option").filter({ hasText: "London" }).first();
  await expect(london).toContainText("England, United Kingdom");

  await input.press("ArrowDown");
  await expect(london).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");
  await expect(input).toHaveValue("London, England, United Kingdom");
  await expect(listbox).toHaveCount(0);

  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "London, England, United Kingdom", exact: true }),
  ).toBeVisible();
});
