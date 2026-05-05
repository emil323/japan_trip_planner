import { test, expect, type Page } from "@playwright/test";

// Tests for the locked-anchor enforcement: drag-and-drop reorders that
// would shift a locked location must be rejected, slider boundaries
// adjacent to a locked segment must not move, and the action-menu
// "Fjern" entry must be disabled.

async function gotoHome(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("tripView:v1");
    } catch {
      /* ignored */
    }
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Handlinger for sted" }).first()).toBeVisible();
}

async function lockNth(page: Page, n: number) {
  const card = page.locator(".trip-loc-card").nth(n);
  await card.getByRole("button", { name: "Handlinger for sted" }).click();
  await page.getByRole("menuitem", { name: /^Lås$/ }).click();
  await expect(card).toHaveClass(/trip-loc-card--locked/);
}

test.describe("locked-anchor enforcement", () => {
  test.beforeEach(({ page }) => gotoHome(page));

  test("Fjern is disabled for a locked location", async ({ page }) => {
    await lockNth(page, 1); // Hiroshima
    const card = page.locator(".trip-loc-card").nth(1);
    await card.getByRole("button", { name: "Handlinger for sted" }).click();
    const fjern = page.getByRole("menuitem", { name: "Fjern" });
    await expect(fjern).toBeVisible();
    await expect(fjern).toHaveAttribute("aria-disabled", "true");
  });

  test("slider boundary adjacent to a locked segment refuses to move", async ({ page }) => {
    // Lock the 2nd location (index 1, Hiroshima). Boundaries 0 (Fukuoka↔Hiroshima)
    // and 1 (Hiroshima↔Osaka) are then both adjacent to a lock and must be
    // visually marked as locked (.trip-handle--locked) and refuse to drag.
    await lockNth(page, 1);

    const handle0 = page.locator(".trip-handle").nth(0);
    const handle1 = page.locator(".trip-handle").nth(1);
    await expect(handle0).toHaveClass(/trip-handle--locked/);
    await expect(handle1).toHaveClass(/trip-handle--locked/);

    const initialPills = await page.locator(".trip-days-pill").allTextContents();

    const slider = page.locator(".trip-slider");
    const sliderBox = await slider.boundingBox();
    const handleBox = await handle0.boundingBox();
    expect(sliderBox && handleBox).toBeTruthy();
    if (!sliderBox || !handleBox) return;

    const startX = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    const targetX = startX + sliderBox.width / 21; // try to push by 1 day

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(targetX, y, { steps: 8 });
    await page.mouse.up();

    const afterPills = await page.locator(".trip-days-pill").allTextContents();
    expect(afterPills).toEqual(initialPills);
  });

  test("dragging a card past a locked location is rejected", async ({ page }) => {
    // Lock Hiroshima (index 1). Try to drag Fukuoka (index 0) onto Osaka
    // (index 2) — that would move Hiroshima from index 1 to index 0,
    // shifting its dates. moveBlockedByLock must reject.
    await lockNth(page, 1);

    // Capture order. Locked locations render their name as a static span
    // (.trip-loc-readonly-title), unlocked ones as an <input>, so we read
    // both and merge by card index.
    const readNames = () =>
      page.locator(".trip-loc-card").evaluateAll((els) =>
        els.map((card) => {
          const input = card.querySelector(".trip-loc-card-title input") as HTMLInputElement | null;
          if (input) return input.value;
          const ro = card.querySelector(".trip-loc-readonly-title") as HTMLElement | null;
          return ro?.textContent?.trim() ?? "";
        }),
      );

    const namesBefore = await readNames();
    expect(namesBefore).toEqual(["Fukuoka", "Hiroshima", "Osaka", "Kyoto", "Tokyo"]);

    const source = page.locator(".trip-loc-card").nth(0);
    const target = page.locator(".trip-loc-card").nth(2);
    // Playwright's high-level dragTo uses real HTML5 DnD events.
    await source.dragTo(target);

    const namesAfter = await readNames();
    // Order must be unchanged because the move would cross the locked Hiroshima.
    expect(namesAfter).toEqual(namesBefore);
  });
});
