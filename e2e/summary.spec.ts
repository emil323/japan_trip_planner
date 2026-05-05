import { test, expect } from "@playwright/test";

// Tests for the summary page (/oppsummering): correct totals, all
// default locations rendered, Reisedag card appears for locations
// with includeCheckoutDay enabled.

test.describe("summary page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/oppsummering");
    await expect(page.getByRole("heading", { name: /Japan-reiseplan/ })).toBeVisible();
  });

  test("shows hero stats with the correct defaults", async ({ page }) => {
    // 21 nights, 5 locations, 0 plans, 0 travels with the seeded default state.
    const hero = page.locator(".summary-hero-stats");
    await expect(hero).toContainText("21");
    await expect(hero).toContainText("5");
    await expect(hero.getByText("Netter")).toBeVisible();
    await expect(hero.getByText("Steder")).toBeVisible();
  });

  test("renders all 5 default locations", async ({ page }) => {
    const cards = page.locator(".summary-loc");
    await expect(cards).toHaveCount(5);
    for (const name of ["Fukuoka", "Hiroshima", "Osaka", "Kyoto", "Tokyo"]) {
      await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
    }
  });

  // Note: a Reisedag-card rendering test would require navigating from the
  // plan page (where the toggle lives) to /oppsummering. Both routes are
  // SSR-loaded from Firestore, and Firestore is unreachable in local dev,
  // so the toggle change cannot survive the navigation. The same toggle
  // adding a Reisedag column on the plan page is covered by plan.spec.ts.

  test("Tilbake navigates to the home page", async ({ page }) => {
    await page.getByRole("link", { name: "Tilbake" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
