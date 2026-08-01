import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
}

test("uses the desktop shell at wide viewports", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const sidebar = page.getByTestId("desktop-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(page.getByTestId("mobile-navigation")).toBeHidden();
  await expectNoHorizontalOverflow(page);

  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "1800px";
    document.querySelector(".workspace")?.append(spacer);
    window.scrollTo(0, 1000);
  });

  await expect.poll(async () => sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(0);
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox?.height).toBeLessThanOrEqual(900);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("desktop.png") });
});

test("uses task navigation on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByTestId("desktop-sidebar")).toBeHidden();
  await expect(page.getByTestId("mobile-navigation")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("mobile.png") });
});
