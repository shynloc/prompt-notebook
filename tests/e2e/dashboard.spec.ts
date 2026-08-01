import { expect, test } from "@playwright/test";

const snapshot = {
  summary: {
    totalNotes: 128,
    activeSharedNotes: 6,
    totalTags: 24,
    totalTerms: 386,
    totalFavorites: 32,
    totalProjects: 8,
    trashNotes: 4,
    totalPromptCharacters: 126580,
  },
  tags: [{ id: "f11e5c3c-db2a-4c57-87e-5b2d620c65bc2", name: "电影感", noteCount: 17 }],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/dashboard", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: snapshot }),
  }));
});

test("lays out four cards per row on desktop and opens a tag collection", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/v1/tags", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: [{ id: snapshot.tags[0].id, name: "电影感", count: 17 }] }),
  }));
  await page.route("**/api/v1/notes?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: [], meta: { nextCursor: null } }),
  }));

  await page.goto("/dashboard");
  const grid = page.getByLabel("笔记本统计数据");
  await expect(grid.getByTestId("dashboard-stat-card")).toHaveCount(8);
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(4);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("dashboard-desktop.png") });
  await page.getByRole("link", { name: "电影感" }).click();
  await expect(page).toHaveURL(`/tags/${snapshot.tags[0].id}`);
  await expect(page.getByRole("heading", { name: "# 电影感" })).toBeVisible();
});

test("keeps the dashboard readable without horizontal overflow on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  const grid = page.getByLabel("笔记本统计数据");
  await expect(grid.getByTestId("dashboard-stat-card")).toHaveCount(8);
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(2);
  await expect(page.getByRole("cell", { name: "17" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("dashboard-mobile.png") });
});
