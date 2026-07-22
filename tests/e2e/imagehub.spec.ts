import { expect, test, type Page } from "@playwright/test";

async function signUp(page: Page) {
  const email = `imagehub-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("ImageHub User");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

const jobId = "11111111-1111-4111-8111-111111111111";
const sourceNoteId = "22222222-2222-4222-8222-222222222222";
const queued = {
  id: jobId,
  status: "queued",
  prompt: "A paper observatory under a red moon",
  negativePrompt: null,
  modelName: "Image Model",
  width: 1024,
  height: 1024,
  quality: "auto",
  imageCount: 1,
  progress: 0,
  errorMessage: null,
  createdAt: new Date().toISOString(),
  assets: [],
};
const succeeded = {
  ...queued,
  status: "succeeded",
  progress: 100,
  assets: [{
    id: "asset-1",
    jobId,
    role: "result",
    storageProvider: "picbed",
    objectKey: "result.png",
    displayUrl: "https://img.example.com/result.png",
    thumbnailUrl: "https://img.example.com/result.png",
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    sizeBytes: 500,
    ordinal: 0,
  }],
};

test("restores, polls, reverses, and saves an ImageHub generation on mobile", async ({ page }) => {
  await signUp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/generations?**", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/generations", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 201, json: { data: queued } });
    else await route.fallback();
  });
  await page.route(`**/api/v1/generations/${jobId}`, (route) => route.fulfill({ json: { data: succeeded } }));
  await page.route("**/api/v1/ai/reverse-prompt", (route) => route.fulfill({ json: { data: { prompt: "A reconstructed prompt", model: { name: "Vision" } } } }));
  await page.route("**/api/v1/notes", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 201, json: { data: { id: "note-1" } } });
    else await route.fallback();
  });
  await page.route(`**/api/v1/notes/${sourceNoteId}`, async (route) => {
    const note = {
      id: sourceNoteId,
      title: "Source note",
      prompt: queued.prompt,
      negativePrompt: null,
      favorite: false,
      version: 1,
      updatedAt: new Date().toISOString(),
      tags: [],
      images: [],
      coverImage: null,
    };
    if (route.request().method() === "PATCH") await route.fulfill({ json: { data: { ...note, version: 2, images: succeeded.assets } } });
    else await route.fulfill({ json: { data: note } });
  });

  await page.goto(`/imagehub?note=${sourceNoteId}`);
  await expect(page.getByLabel("Prompt")).toHaveValue(queued.prompt);
  await page.getByRole("button", { name: /开始生成/ }).click();
  await expect(page.getByText("已进入生成队列")).toBeVisible();
  await expect(page.getByText("生成完成")).toBeVisible({ timeout: 12_000 });
  await page.getByRole("button", { name: "反推" }).click();
  await expect(page.getByLabel("反推提示词")).toHaveValue("A reconstructed prompt");
  await expect(page.getByLabel("Prompt")).toHaveValue(queued.prompt);
  await page.getByRole("button", { name: "使用这个 Prompt" }).click();
  await expect(page.getByLabel("Prompt")).toHaveValue("A reconstructed prompt");
  await page.getByRole("button", { name: "设为封面" }).click();
  await expect(page.getByText("生成图已设为原笔记封面。")).toBeVisible();
  await page.getByRole("button", { name: "保存为笔记" }).click();
  await expect(page.getByText("已保存为新的提示词笔记。")).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});
