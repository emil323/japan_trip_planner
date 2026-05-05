import { test, expect } from "@playwright/test";

// Tests for the plan-page (/plan/:id) basics: it opens, renders the
// suggestion form, can add a new suggestion, can navigate back home.

test.describe("plan page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem("tripView:v1");
      } catch {
        /* ignored */
      }
    });
    // defaultState() seeds a Fukuoka location with a stable id, so we can
    // navigate directly to it.
    await page.goto("/plan/loc-fukuoka");
    await expect(page.getByRole("heading", { name: "Forslag" })).toBeVisible();
  });

  test("opens with the location title and an empty suggestion list", async ({ page }) => {
    // The location name appears in the page header.
    await expect(page.getByRole("heading", { name: /Fukuoka/ }).first()).toBeVisible();
    await expect(page.getByText("Ingen forslag enda.")).toBeVisible();
  });

  test("can add a new suggestion and have it appear in the list", async ({ page }) => {
    const input = page.getByPlaceholder("F.eks. Besøk Fushimi Inari");
    await input.fill("Besøk Ohori-parken");
    await page.getByRole("button", { name: "Legg til", exact: true }).click();

    // The "Ingen forslag" empty-state disappears, and the new item shows up.
    await expect(page.getByText("Ingen forslag enda.")).toHaveCount(0);
    await expect(page.locator(".plan-list").getByText("Besøk Ohori-parken")).toBeVisible();
    // Input clears after add.
    await expect(input).toHaveValue("");
  });

  test("Tilbake link navigates back to the home page", async ({ page }) => {
    await page.getByRole("link", { name: "Tilbake" }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".trip-loc-card")).toHaveCount(5);
  });

  test("toggling utsjekkingsdato adds a Reisedag column", async ({ page }) => {
    // Aksel <Switch> renders as role=checkbox.
    const toggle = page.getByRole("checkbox", { name: /Bruk utsjekkingsdato/ });
    await expect(toggle).toBeVisible();
    await toggle.check();
    // The day grid now contains a "Reisedag" header.
    await expect(page.getByText("Reisedag").first()).toBeVisible();
  });
});
