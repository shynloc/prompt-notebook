import { expect, test } from "@playwright/test";

async function signUp(page: import("@playwright/test").Page) {
  const email = `term-analysis-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("Term Analysis User");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

test("reviews AI-extracted terms before saving them to the vocabulary", async ({ page }) => {
  await signUp(page);
  await page.route("**/api/v1/terms/analyze", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: {
        model: { id: "e2e-curator", name: "E2E Curator", inherited: true },
        candidates: [
          { id: "e2e-new", category: "光线", label: "测试虹彩侧光", value: "iridescent side light e2e", sourceExcerpt: "iridescent side light e2e", confidence: "high", duplicate: null },
        ],
      } }),
    });
  });

  await page.goto("/library");
  await page.getByRole("tab", { name: "✦ AI 提示词分析" }).click();
  await page.getByLabel("完整提示词").fill("portrait with iridescent side light e2e and a neutral background");
  await page.getByRole("button", { name: "✦ AI 一键分析" }).click();
  await expect(page.getByText(/找到 1 个候选词条/)).toBeVisible();
  await page.getByRole("button", { name: /测试虹彩侧光/ }).click();
  await page.getByRole("button", { name: "批量收录 1 项" }).click();
  await expect(page.getByText(/已收录 1 个词条/)).toBeVisible();

  await page.getByRole("tab", { name: "提示词百科", exact: true }).click();
  await page.getByLabel("搜索词库").fill("测试虹彩侧光");
  await expect(page.locator(".term-library").getByText("iridescent side light e2e", { exact: true })).toBeVisible();
});

test("consolidates service settings behind one sidebar destination", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: /设置/ }).click();
  await expect(page).toHaveURL(/\/settings\/ai$/);
  await expect(page.getByRole("navigation", { name: "设置分类" })).toBeVisible();
  await page.getByRole("link", { name: "图床", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/storage$/);
  await expect(page.getByRole("heading", { name: "图床", exact: true })).toBeVisible();
});
