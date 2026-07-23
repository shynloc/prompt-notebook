import { expect, test } from "@playwright/test";

async function signUp(page: import("@playwright/test").Page) {
  const email = `ai-settings-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("AI Settings User");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

test("persists multiple-purpose AI configuration without revealing the key", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings/ai");
  await expect(page.getByRole("heading", { name: "AI 模型", exact: true })).toBeVisible();

  await page.getByLabel("配置名称").fill("主要助手");
  await page.getByLabel("Base URL").fill("https://api.example.com/v1");
  await page.getByLabel("API Key").fill("sk-browser-secret-1234");
  await page.getByLabel("Model ID").fill("writer-model");
  await page.getByLabel("显示名称").fill("Writer Model");
  await page.getByRole("checkbox", { name: "图片反推" }).check();
  await page.getByRole("button", { name: "加密保存配置" }).click();

  const card = page.locator(".ai-configuration-card").filter({ hasText: "主要助手" });
  await expect(card).toContainText("••••1234");
  await expect(card).not.toContainText("sk-browser-secret-1234");
  await page.getByRole("combobox", { name: "提示词优化模型" }).selectOption({ label: "主要助手 · Writer Model" });
  await expect(page.locator(".ai-message--success")).toContainText("提示词优化模型已更新");
  await page.getByRole("combobox", { name: "词库分析模型" }).selectOption({ label: "主要助手 · Writer Model" });
  await expect(page.locator(".ai-message--success")).toContainText("词库分析模型已更新");
  await page.getByRole("combobox", { name: "图片反推模型" }).selectOption({ label: "主要助手 · Writer Model" });
  await expect(page.locator(".ai-message--success")).toContainText("图片反推模型已更新");

  await page.reload();
  await expect(card).toContainText("••••1234");
  await expect(page.getByRole("combobox", { name: "提示词优化模型" })).not.toHaveValue("");
  await expect(page.getByRole("combobox", { name: "词库分析模型" })).not.toHaveValue("");
  await expect(page.getByRole("combobox", { name: "图片反推模型" })).not.toHaveValue("");
});

test("keeps AI settings usable without horizontal overflow on mobile", async ({ page }) => {
  await signUp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/ai");
  await expect(page.getByRole("heading", { name: "AI 模型", exact: true })).toBeVisible();
  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
  await expect(page.getByRole("button", { name: "加密保存配置" })).toBeVisible();
});
