import { expect, test, type Page } from "@playwright/test";
import { reverseResultFixture } from "../../src/test/reverse-fixture";

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

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`keeps 1K 2K and 4K available for the unverified 2.5 shorthand at ${viewport.width}px`, async ({ page }, testInfo) => {
    await signUp(page);
    await page.setViewportSize(viewport);
    const profileId = "44444444-4444-4444-8444-444444444444";
    await page.route("**/api/v1/ai/configurations", route => route.fulfill({ json: { data: [{
      enabled: true, modelEnabled: true, modelProfileId: profileId,
      modelId: "gpt-image-2.5", name: "Synthetic compatible gateway", displayName: "Image 2.5",
      capabilities: ["image_generation"], defaultParameters: {},
    }] } }));
    await page.route("**/api/v1/ai/preferences", route => route.fulfill({ json: { data: [{ purpose: "image_generation", modelProfileId: profileId }] } }));
    await page.route("**/api/v1/generations?**", route => route.fulfill({ json: { data: [] } }));
    await page.route(`**/api/v1/generations/${jobId}*`, route => route.fulfill({ json: { data: queued } }));
    let submitted: Record<string, unknown> | null = null;
    await page.route("**/api/v1/generations", async route => {
      if (route.request().method() !== "POST") { await route.fallback(); return; }
      const form = await new Request("http://localhost/generation", {
        method: "POST", headers: { "content-type": route.request().headers()["content-type"] },
        body: new Uint8Array(route.request().postDataBuffer() ?? []),
      }).formData();
      submitted = JSON.parse(String(form.get("payload")));
      await route.fulfill({ status: 201, json: { data: queued } });
    });
    await page.goto("/imagehub");
    await expect(page.getByLabel("本次生图模型")).toHaveValue(profileId);
    const resolutions = page.getByRole("group", { name: "输出分辨率", exact: true });
    await expect(resolutions.getByRole("button", { name: /^1K/ })).toHaveAttribute("aria-pressed", "true");
    await expect(resolutions.getByRole("button", { name: /^2K/ })).toBeEnabled();
    await expect(resolutions.getByRole("button", { name: /^4K/ })).toBeEnabled();
    await expect(page.getByRole("group", { name: "渲染质量", exact: true }).getByRole("button")).toHaveCount(6);
    await expect(page.getByText(/供应商.*别名|别名.*供应商/).first()).toBeVisible();
    await page.getByLabel("Prompt", { exact: true }).fill("Synthetic notebook illustration, vertical composition");
    await resolutions.getByRole("button", { name: /^2K/ }).click();
    await expect(resolutions.getByRole("button", { name: /^2K/ })).toHaveAttribute("aria-pressed", "true");
    await expect(resolutions).toContainText("2048×2048");
    await expect(resolutions).toContainText("实验");
    await page.getByRole("button", { name: /手机竖屏.*9:16/ }).click();
    await expect(resolutions.getByRole("button", { name: /^2K/ })).toContainText("1152×2048");
    await page.getByRole("button", { name: /标准.*均衡/ }).click();
    await resolutions.getByRole("button", { name: /^4K/ }).click();
    await expect(page.getByRole("button", { name: /标准.*均衡/ })).toHaveAttribute("aria-pressed", "true");
    await expect(resolutions.getByRole("button", { name: /^4K/ })).toContainText("2160×3840");
    await page.getByRole("button", { name: /最高.*最高质量/ }).click();
    await page.locator(".imagehub-console").screenshot({ path: testInfo.outputPath(`imagehub-alias-resolution-${viewport.width}.png`) });
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    await page.getByRole("button", { name: /开始生成/ }).click();
    await expect(page.getByText("已进入生成队列")).toBeVisible();
    expect(submitted).toMatchObject({ modelProfileId: profileId, width: 2160, height: 3840, quality: "max" });
  });

  test(`supports native 2.5 output and a real local edit mask at ${viewport.width}px`, async ({ page }, testInfo) => {
    await signUp(page);
    await page.setViewportSize(viewport);
    const profileId = "33333333-3333-4333-8333-333333333333";
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await page.route("**/api/v1/ai/configurations", (route) => route.fulfill({ json: { data: [{
      id: "connection", enabled: true, modelEnabled: true, modelProfileId: profileId,
      modelId: "gpt-image-2.5-sunburst", name: "Studio", displayName: "Sunburst",
      capabilities: ["image_generation"], defaultParameters: { output_format: "webp", background: "transparent", output_compression: 85 },
    }] } }));
    await page.route("**/api/v1/ai/preferences", (route) => route.fulfill({ json: { data: [{ purpose: "image_generation", modelProfileId: profileId }] } }));
    await page.route("**/api/v1/generations?**", (route) => route.fulfill({ json: { data: [] } }));
    let submitted: Record<string, unknown> | null = null;
    let maskFile: File | null = null;
    await page.route("**/api/v1/generations", async (route) => {
      if (route.request().method() !== "POST") { await route.fallback(); return; }
      const data = await new Request("http://localhost/generation", {
        method: "POST", headers: { "content-type": route.request().headers()["content-type"] }, body: new Uint8Array(route.request().postDataBuffer() ?? []),
      }).formData();
      submitted = JSON.parse(String(data.get("payload")));
      const candidate = data.get("mask");
      maskFile = candidate instanceof File ? candidate : null;
      await route.fulfill({ status: 201, json: { data: queued } });
    });
    await page.goto("/imagehub");
    await expect(page.getByLabel("本次生图模型")).toHaveValue(profileId);
    await page.getByLabel("Prompt", { exact: true }).fill("Change the selected clothing to blue, retain the portrait identity");
    await page.getByRole("button", { name: /宽屏.*16:9/ }).click();
    await page.getByRole("button", { name: /^4K/ }).click();
    await page.getByRole("button", { name: /最高.*最高质量/ }).click();
    await page.getByLabel("图片格式", { exact: true }).selectOption("png");
    await page.locator(".imagehub-console").screenshot({ path: testInfo.outputPath(`imagehub-console-${viewport.width}.png`) });
    await page.getByLabel("上传其他参考图").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "涂抹修改区域" }).click();
    const dialog = page.getByRole("dialog", { name: "涂抹要修改的区域" });
    await expect(dialog).toBeVisible();
    const canvas = dialog.getByLabel("蒙版绘制画布");
    await expect(canvas).toBeVisible();
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Mask canvas is not visible");
    await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect(dialog.getByRole("button", { name: "使用此蒙版" })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`imagehub-mask-${viewport.width}.png`), fullPage: false });
    await dialog.getByRole("button", { name: "使用此蒙版" }).click();
    await expect(page.getByText("已设置局部修改区域 · 透明区域会被重绘")).toBeVisible();
    await page.getByRole("button", { name: /开始生成/ }).click();
    await expect(page.getByText("已进入生成队列")).toBeVisible();
    expect(submitted).toMatchObject({ modelProfileId: profileId, width: 3840, height: 2160, quality: "max", outputFormat: "png", background: "transparent" });
    expect(submitted).not.toHaveProperty("outputCompression");
    expect(maskFile).not.toBeNull();
    expect((maskFile as File | null)?.type).toBe("image/png");
    expect((maskFile as File | null)?.size).toBeGreaterThan(0);
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  });
}

test("restores, polls, reverses, and saves an ImageHub generation on mobile", async ({ page }) => {
  await signUp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/ai/configurations", (route) => route.fulfill({ json: { data: [{ enabled: true, modelEnabled: true, modelProfileId: "33333333-3333-4333-8333-333333333333", modelId: "gpt-image-2", name: "Image Model", capabilities: ["image_generation"], defaultParameters: {} }] } }));
  await page.route("**/api/v1/ai/preferences", (route) => route.fulfill({ json: { data: [{ purpose: "image_generation", modelProfileId: "33333333-3333-4333-8333-333333333333" }] } }));
  await page.route("**/api/v1/generations?**", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/generations", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 201, json: { data: queued } });
    else await route.fallback();
  });
  await page.route(`**/api/v1/generations/${jobId}*`, (route) => {
    if (route.request().method() === "DELETE" && route.request().url().includes("mode=history")) {
      return route.fulfill({ json: { data: { id: jobId, deleted: true } } });
    }
    return route.fulfill({ json: { data: succeeded } });
  });
  await page.route(`**/api/v1/generations/${jobId}/assets/asset-1/download`, (route) => route.fulfill({
    body: "generated-image",
    contentType: "image/png",
    headers: { "content-disposition": 'attachment; filename="prompt-notebook-result.png"' },
  }));
  await page.route("**/api/v1/ai/reverse-prompt", (route) => route.fulfill({ json: { data: reverseResultFixture() } }));
  await page.route("**/api/v1/notes", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 201, json: { data: { id: "note-1" }, meta: { replayed: false } } });
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
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载" }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("prompt-notebook-result.png");
  await expect(page.getByText("图片下载已开始。")).toBeVisible();
  await page.getByRole("button", { name: "反推", exact: true }).click();
  await page.getByRole("button", { name: "AI 一键反推" }).click();
  await expect(page.getByLabel("反推提示词", { exact: true })).toHaveValue(reverseResultFixture().prompt);
  await expect(page.getByLabel("Prompt")).toHaveValue(queued.prompt);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "使用这个 Prompt" }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue(reverseResultFixture().prompt);
  await page.getByRole("button", { name: "设为封面" }).click();
  await expect(page.getByText("生成图已设为原笔记封面。")).toBeVisible();
  await page.getByRole("button", { name: "保存为笔记" }).click();
  await expect(page.getByText("已保存为新的提示词笔记。")).toBeVisible();
  await expect(page.getByRole("button", { name: "已保存" })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除记录" }).click();
  await expect(page.getByText("生成历史已删除。")).toBeVisible();
  await expect(page.getByText("生成完成")).not.toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});
