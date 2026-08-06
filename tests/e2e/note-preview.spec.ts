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

test("switches every artwork in a multi-image note preview", async ({ page }) => {
  const artwork = (label: string, color: string) => `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
      <rect width="100%" height="100%" fill="${color}" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-size="96" fill="white">${label}</text>
    </svg>
  `)}`;
  const images = [
    ["first", "#b8322c"],
    ["second", "#1d6c54"],
    ["third", "#2f4f8f"],
  ].map(([label, color], index) => ({
    id: `image-${index + 1}`,
    storageProvider: "external",
    objectKey: `multi-image-${index + 1}.svg`,
    displayUrl: artwork(label, color),
    thumbnailUrl: artwork(label, color),
    mimeType: "image/png",
    width: 900,
    height: 1200,
    sizeBytes: 1024,
  }));

  await page.route("**/api/v1/notes?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [{
          id: "multi-image-note",
          title: "Multi-image regression note",
          prompt: "A prompt with three distinct generated artworks.",
          negativePrompt: null,
          favorite: false,
          archivedAt: null,
          deletedAt: null,
          version: 1,
          updatedAt: "2026-08-06T00:00:00.000Z",
          tags: [],
          images,
          coverImage: images[0],
        }],
        meta: { nextCursor: null },
      }),
    });
  });

  await page.goto("/notes");
  await page.getByRole("button", { name: "预览 Multi-image regression note" }).click();

  const dialog = page.getByRole("dialog");
  const currentImage = dialog.getByRole("img", { name: "Multi-image regression note" });
  await expect(currentImage).toHaveAttribute("src", images[0].displayUrl);
  await expect(dialog.getByText("1 / 3", { exact: true })).toBeVisible();

  await currentImage.evaluate((element) => element.setAttribute("data-original-node", "true"));
  await dialog.getByRole("button", { name: "下一张" }).click();
  await expect(currentImage).toHaveAttribute("src", images[1].displayUrl);
  await expect(currentImage).not.toHaveAttribute("data-original-node");
  await expect(dialog.getByText("2 / 3", { exact: true })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(currentImage).toHaveAttribute("src", images[2].displayUrl);
  await expect(dialog.getByText("3 / 3", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "下一张" }).click();
  await expect(currentImage).toHaveAttribute("src", images[0].displayUrl);
  await expect(dialog.getByText("1 / 3", { exact: true })).toBeVisible();
});
