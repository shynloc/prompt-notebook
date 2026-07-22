import { expect, test } from "@playwright/test";

test("signs up, keeps the session after refresh, signs out, and signs in again", async ({
  page,
}) => {
  const email = `browser-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "correct-horse-battery";

  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("Browser User");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "创建账号" }).click();

  await expect(page).toHaveURL("/", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("wrong-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".auth-card .auth-message")).toContainText("邮箱或密码不正确", { timeout: 15_000 });

  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

test("does not disclose whether a reset email exists", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("邮箱").fill(`missing-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "发送重置链接" }).click();

  await expect(page.getByRole("status")).toContainText("如果该邮箱已注册");
});
