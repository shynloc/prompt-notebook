import { expect, test } from "@playwright/test";

test("creates, manages, renews, and closes a short prompt share", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const email = `sharing-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("Sharing User");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });

  await page.goto("/notes/new");
  await page.getByLabel("标题").fill("可分享的提示词");
  await page.getByLabel("Prompt", { exact: true }).fill("a quiet forest under moonlight");
  await page.getByRole("button", { name: "保存提示词" }).click();
  await expect(page).toHaveURL("/notes");
  await page.getByRole("button", { name: "预览 可分享的提示词" }).click();

  await page.getByRole("button", { name: "创建 7 天分享并复制链接" }).click();
  await expect(page.getByText(/分享链接已复制/)).toBeVisible();
  await expect(page.getByText(/分享始于/)).toContainText("过期于");
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(shareUrl).toMatch(/\/share\/\d{8}[23456789A-HJ-NP-Za-km-z]{5}$/);

  await page.goto("/shares");
  await expect(page.getByRole("heading", { name: "分享管理" })).toBeVisible();
  await expect(page.getByText("可分享的提示词")).toBeVisible();
  await page.getByRole("button", { name: "续期 7 天" }).click();
  await expect(page.getByText(/已续期 7 天/)).toBeVisible();
  await page.getByRole("button", { name: "立即关闭" }).click();
  await expect(page.getByText(/目前没有有效的提示词分享/)).toBeVisible();

  await page.goto(shareUrl);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});
