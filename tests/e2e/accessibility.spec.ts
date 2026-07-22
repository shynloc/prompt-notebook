import { expect, test } from "@playwright/test";

test("keeps primary navigation and signed-out action keyboard reachable", async ({ page }) => {
  await page.goto("/notes");
  await expect(page.getByRole("navigation", { name: "桌面主导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: "登录或创建账户" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

for (const width of [360, 390, 768, 1280, 1440]) {
  test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/notes");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("honors reduced motion and exposes status regions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/notes");
  const duration = await page.locator("body").evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);
  await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);
});

test("keeps focus visible while traversing mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notes");
  await page.getByRole("navigation", { name: "移动主导航" }).getByRole("link").first().focus();
  await expect(page.locator(":focus")).toBeVisible();
  const outline = await page.locator(":focus").evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
});
