import { test, expect } from "@playwright/test";

// Smoke tests for the home page (TripPlanner).
//
// Firestore reads/writes fail in local dev (expired creds), but the SSR
// loader catches the error and falls back to defaultState() — so the UI
// always boots with the same 5 locations: Fukuoka, Hiroshima, Osaka,
// Kyoto, Tokyo. That gives us a stable starting point for these tests.

test.describe("home page smoke", () => {
  test.beforeEach(async ({ page }) => {
    // Wipe any view-mode preference so the test starts in cards view.
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem("tripView:v1");
      } catch {
        /* ignored */
      }
    });
    await page.goto("/");
    // Wait for hydration: the action-menu trigger only renders client-side.
    await expect(page.getByRole("button", { name: "Handlinger for sted" }).first()).toBeVisible();
  });

  test("loads with the 5 default locations", async ({ page }) => {
    const cards = page.locator(".trip-loc-card");
    await expect(cards).toHaveCount(5);
    // Location name lives in the title-input's value, not as text content.
    await expect(cards.nth(0).locator(".trip-loc-card-title input")).toHaveValue("Fukuoka");
    await expect(cards.nth(4).locator(".trip-loc-card-title input")).toHaveValue("Tokyo");
  });

  test("can add a new location", async ({ page }) => {
    await expect(page.locator(".trip-loc-card")).toHaveCount(5);
    await page.getByRole("button", { name: "Legg til sted" }).click();
    await expect(page.locator(".trip-loc-card")).toHaveCount(6);
    await expect(
      page.locator(".trip-loc-card").last().locator(".trip-loc-card-title input"),
    ).toHaveValue("Nytt sted");
  });

  test("can remove an unlocked location via the action menu", async ({ page }) => {
    // Default locations have no plans, so removeLoc skips the confirm() prompt.
    await page.getByRole("button", { name: "Handlinger for sted" }).first().click();
    await page.getByRole("menuitem", { name: "Fjern" }).click();
    await expect(page.locator(".trip-loc-card")).toHaveCount(4);
    // Fukuoka was first; should now be gone.
    await expect(
      page.locator(".trip-loc-card").first().locator(".trip-loc-card-title input"),
    ).not.toHaveValue("Fukuoka");
  });

  test("dragging the slider boundary moves nights between adjacent locations", async ({
    page,
  }) => {
    const slider = page.locator(".trip-slider");
    const firstHandle = page.locator(".trip-handle").first();

    const sliderBox = await slider.boundingBox();
    const handleBox = await firstHandle.boundingBox();
    expect(sliderBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    if (!sliderBox || !handleBox) return;

    const startX = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    // 21 total days, 5 locations: each day is sliderBox.width / 21 px wide.
    // Drag the first boundary one full day to the right.
    const dayWidth = sliderBox.width / 21;
    const targetX = startX + dayWidth;

    const initialPill = await page.locator(".trip-days-pill").first().textContent();

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(targetX, y, { steps: 8 });
    await page.mouse.up();

    const updatedPill = await page.locator(".trip-days-pill").first().textContent();
    expect(updatedPill).not.toEqual(initialPill);
    // First location starts at 4 nights; one click right should bump it to 5.
    expect(updatedPill).toContain("5");
  });

  test("locking a location swaps inputs for read-only labels", async ({ page }) => {
    const firstCard = page.locator(".trip-loc-card").first();
    // Pre-condition: name and hotel render as inputs.
    await expect(firstCard.locator("input").first()).toBeVisible();

    await firstCard.getByRole("button", { name: "Handlinger for sted" }).click();
    await page.getByRole("menuitem", { name: /^Lås$/ }).click();

    // After locking: card has the locked modifier.
    await expect(firstCard).toHaveClass(/trip-loc-card--locked/);
    // Name is now a read-only label, not an input.
    await expect(firstCard.locator(".trip-loc-readonly-title")).toContainText("Fukuoka");
    // Hotel and URL also rendered as labels (no <input> in the body fields).
    await expect(firstCard.locator(".trip-loc-card-fields input")).toHaveCount(0);
    // The drag handle is replaced with the lock icon.
    await expect(firstCard.locator(".trip-drag-handle--locked")).toBeVisible();

    // Unlock: opens action menu now shows "Lås opp".
    await firstCard.getByRole("button", { name: "Handlinger for sted" }).click();
    await page.getByRole("menuitem", { name: "Lås opp" }).click();
    await expect(firstCard).not.toHaveClass(/trip-loc-card--locked/);
    await expect(firstCard.locator("input").first()).toBeVisible();
  });
});
