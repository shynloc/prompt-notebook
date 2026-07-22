import { expect, test } from "@playwright/test";

test("creates, tags, searches and previews a cloud prompt", async ({ page }) => {
  const email = `notes-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("Visual Notebook User");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });

  await page.goto("/notes/new");
  await page.getByLabel("标题").fill("跨设备电影场景");
  await page.getByLabel("Prompt", { exact: true }).fill("a quiet library at golden hour");
  await page.getByLabel("标签").fill("电影感");
  await page.getByLabel("标签").press("Enter");
  await expect(page.getByRole("button", { name: /黄金时刻/ })).toBeVisible();
  await page.getByRole("button", { name: /黄金时刻/ }).click();
  await page.getByRole("button", { name: "保存提示词" }).click();

  await expect(page).toHaveURL("/notes");
  await expect(page.getByRole("heading", { name: "跨设备电影场景" })).toBeVisible();
  await page.getByLabel("搜索提示词").fill("电影感");
  await expect(page.getByRole("heading", { name: "跨设备电影场景" })).toBeVisible();
  await page.getByRole("button", { name: "预览 跨设备电影场景" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/golden hour lighting/)).toBeVisible();
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "跨设备电影场景" })).toBeVisible();
});

test("imports a web page image without submitting or leaving the editor", async ({ page }) => {
  const email = `web-image-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("Web image user");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.waitForURL("/");
  await page.goto("/notes/new");
  await page.getByLabel("标题").fill("尚未保存的提示词");
  await page.getByLabel("Prompt", { exact: true }).fill("keep this editor open");

  let noteCreates = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/api/v1/notes")) noteCreates += 1; });
  await page.route("**/api/v1/uploads", async (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: {
    storageProvider: "picbed", objectKey: "prompt-notebook/web-preview.png",
    displayUrl: "https://images.example.com/prompt-notebook/web-preview.png",
    thumbnailUrl: "https://images.example.com/prompt-notebook/web-preview.png",
    mimeType: "image/png", width: 512, height: 512, sizeBytes: 1024,
  } }) }));

  await page.getByRole("tab", { name: "粘贴链接" }).click();
  await page.getByLabel("图片或网页链接").fill("https://x.com/CyberTotal2026/status/2078771325108117885/photo/1");
  await page.getByRole("button", { name: "解析并导入" }).click();
  await expect(page.getByText("已从链接解析图片并导入图床")).toBeVisible();
  await expect(page).toHaveURL("/notes/new");
  expect(noteCreates).toBe(0);
});
