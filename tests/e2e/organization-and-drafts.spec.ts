import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function signUp(page: Page, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill(label);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

async function createPrompt(page: Page, title: string) {
  await page.goto("/notes/new");
  await page.getByLabel("标题").fill(title);
  await page.getByLabel("Prompt", { exact: true }).fill("cinematic notebook organization test");
  await page.getByRole("button", { name: "保存提示词" }).click();
  await expect(page).toHaveURL("/notes", { timeout: 15_000 });
}

test("organizes prompts and recovers an unsaved local draft", async ({ page }) => {
  const title = `Organized ${Date.now()}`;
  await signUp(page, "Organizer");
  await createPrompt(page, title);
  let card = page.locator(".prompt-card").filter({ hasText: title });
  await card.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await page.goto("/favorites");
  card = page.locator(".prompt-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "归档", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.goto("/archive");
  card = page.locator(".prompt-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "删除", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.goto("/trash");
  card = page.locator(".prompt-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(card).toHaveCount(0);

  await page.goto("/notes/new");
  await page.getByLabel("标题").fill("Unsaved local draft");
  await page.getByLabel("Prompt", { exact: true }).fill("work that must survive a reload");
  await expect(page.locator(".save-state")).toContainText("已保存到本机", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByText("发现上次未保存的本地草稿")).toBeVisible();
  await page.getByRole("button", { name: "恢复草稿" }).click();
  await expect(page.getByLabel("标题")).toHaveValue("Unsaved local draft");
  await expect(page.locator('textarea[name="prompt"]')).toHaveValue("work that must survive a reload");
});
