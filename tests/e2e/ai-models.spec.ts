import { expect, test, type Page } from "@playwright/test";

const profileId = "11111111-1111-4111-8111-111111111111";
const imageId = "22222222-2222-4222-8222-222222222222";
const artwork = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="#252320"/><circle cx="450" cy="430" r="230" fill="#d6cbbd"/><text x="450" y="950" text-anchor="middle" fill="#fffdf8" font-size="86">LUNA</text></svg>')}`;

const characterImage = {
  id: imageId,
  profileId,
  storageProvider: "picbed",
  objectKey: "prompt-notebook/luna.svg",
  displayUrl: artwork,
  thumbnailUrl: artwork,
  mimeType: "image/png",
  width: 900,
  height: 1200,
  sizeBytes: 1024,
  viewType: "portrait",
  caption: "自然光正脸",
  sortOrder: 0,
  isCover: true,
  isPrimary: true,
  focusX: 50,
  focusY: 42,
  status: "ready",
  metadata: {},
  deletedAt: null,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

const profile = {
  id: profileId,
  name: "Luna",
  summary: "冷静、自信的都市时装角色",
  roleDefinition: "Luna 是一位专注高端时装与商业摄影的虚拟模特。",
  useCases: ["时尚", "广告"],
  appearance: "银色长发，清晰面部轮廓，冷静自然的神态。",
  promptAnchor: "Luna, silver long hair, calm expression",
  negativePrompt: "different hair color, older appearance",
  rightsNote: "内部测试资产",
  attributes: {},
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
  images: [characterImage],
  coverImage: characterImage,
  primaryImage: characterImage,
  noteCount: 3,
  generationCount: 2,
};

async function mockCharacterApis(page: Page) {
  await page.route("**/api/v1/notes?**", (route) => route.fulfill({ json: { data: [], meta: { nextCursor: null } } }));
  await page.route(`**/api/v1/ai-models/${profileId}*`, (route) => route.fulfill({ json: { data: profile } }));
  await page.route("**/api/v1/ai-models?**", (route) => route.fulfill({ json: { data: [profile], meta: { nextCursor: null } } }));
}

test("browses an AI Model casting file and linked-note collection", async ({ page }, testInfo) => {
  await mockCharacterApis(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ai-models");

  await expect(page.getByRole("heading", { name: "AI 模特资产库" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Luna" })).toBeVisible();
  await page.getByRole("link", { name: "查看 AI Model Luna" }).click();
  await expect(page).toHaveURL(`/ai-models/${profileId}`);
  await expect(page.getByRole("heading", { name: "Luna", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "角色参考图档案" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "与 Luna 绑定的提示词" })).toBeVisible();
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("ai-model-profile-desktop.png") });
});

test("creates an AI Model with a primary cover on mobile", async ({ page }, testInfo) => {
  let submitted: Record<string, unknown> | null = null;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/uploads", (route) => route.fulfill({ status: 201, json: { data: {
    storageProvider: "picbed",
    objectKey: "prompt-notebook/luna.png",
    displayUrl: artwork,
    thumbnailUrl: artwork,
    mimeType: "image/png",
    width: 900,
    height: 1200,
    sizeBytes: 1024,
  } } }));
  await page.route("**/api/v1/notes?**", (route) => route.fulfill({ json: { data: [], meta: { nextCursor: null } } }));
  await page.route(`**/api/v1/ai-models/${profileId}*`, (route) => route.fulfill({ json: { data: profile } }));
  await page.route("**/api/v1/ai-models", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { data: profile } });
  });

  await page.goto("/ai-models/new");
  await page.getByLabel("名称").fill("Luna");
  await page.getByLabel("角色设定").fill("Luna 是一位专注高端时装与商业摄影的虚拟模特。");
  await page.getByLabel("用途方向").fill("时尚");
  await page.getByLabel("用途方向").press("Enter");
  await page.locator('.character-upload-drop input[type="file"]').setInputFiles({ name: "luna.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await expect(page.getByText("已添加 1 张角色图片。")).toBeVisible();
  await expect(page.getByText("当前封面")).toBeVisible();
  await expect(page.getByText("当前主图")).toBeVisible();
  await page.getByRole("button", { name: "创建 AI Model" }).click();

  await expect(page).toHaveURL(`/ai-models/${profileId}`);
  expect(submitted).toMatchObject({ name: "Luna", useCases: ["时尚"], images: [{ isCover: true, isPrimary: true }] });
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("ai-model-create-mobile.png") });
});
