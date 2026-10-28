import { expect, test } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

for (const width of [1440, 390]) {
  test(`uploads private local images and switches storage without moving existing files at ${width}px`, async ({ page, browser }, testInfo) => {
    test.setTimeout(75_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/sign-up");
    await page.getByLabel("昵称").fill("Local storage test user");
    await page.getByLabel("邮箱").fill(`storage-${width}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`);
    await page.getByLabel("密码").fill("correct-horse-battery");
    await page.getByRole("button", { name: "创建账号" }).click();
    await expect(page).toHaveURL("/", { timeout: 15_000 });

    await page.goto("/settings/storage");
    await expect(page.getByRole("heading", { name: "图片存储", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "站点本地存储", exact: true })).toBeChecked();
    await expect(page.getByLabel("本地存储用量")).toContainText("0 B");
    await expect(page.getByLabel("访问令牌")).toHaveCount(0);
    await page.getByRole("button", { name: "测试当前存储" }).click();
    await expect(page.getByText("本地存储测试成功：已完成写入、读取和清理测试，不占用永久配额。")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`storage-local-${width}.png`), fullPage: true });

    await page.goto("/notes/new");
    const noteTitle = `Local artwork ${width}`;
    await page.getByLabel("标题").fill(noteTitle);
    await page.getByLabel("Prompt", { exact: true }).fill("a synthetic geometric study, warm light");
    const uploadDone = page.waitForResponse(response => response.url().endsWith("/api/v1/uploads") && response.request().method() === "POST");
    await page.getByLabel("上传预览图片").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: png });
    const uploaded = await uploadDone;
    expect(uploaded.status()).toBe(201);
    const asset = (await uploaded.json()).data as { storageProvider: string; displayUrl: string; sizeBytes: number };
    expect(asset.storageProvider).toBe("local");
    expect(asset.displayUrl).toContain("/api/v1/media/files/");
    await expect(page.getByText("图片已上传到站点本地存储并设为预览图")).toBeVisible();
    const savedNote = page.waitForResponse(response => response.url().endsWith("/api/v1/notes") && response.request().method() === "POST");
    await page.getByRole("button", { name: "保存提示词" }).click();
    const noteResponse = await savedNote;
    expect(noteResponse.status()).toBe(201);
    const noteId = (await noteResponse.json()).data.id as string;
    await expect(page).toHaveURL("/notes");
    const ownerImage = await page.request.get(asset.displayUrl);
    expect(ownerImage.status()).toBe(200);
    expect(ownerImage.headers()["content-type"]).toContain("image/png");
    expect(await ownerImage.body()).toEqual(png);

    const guest = await browser.newContext();
    try {
      const privateImage = await guest.request.get(asset.displayUrl);
      expect([401, 404]).toContain(privateImage.status());
      const shareResponse = await page.request.post("/api/v1/shares", { data: { noteId, expiresInDays: 7, allowCopy: true, includeImage: true, includeSource: false } });
      expect(shareResponse.status()).toBe(201);
      const share = (await shareResponse.json()).data as { id: string; token: string };
      const publicImagePath = `/api/v1/shares/public/${share.token}/image`;
      const sharedImage = await guest.request.get(new URL(publicImagePath, asset.displayUrl).href);
      expect(sharedImage.status()).toBe(200);
      expect(await sharedImage.body()).toEqual(png);
      expect((await page.request.delete(`/api/v1/shares/${share.id}`)).ok()).toBe(true);
      const revokedImage = await guest.request.get(new URL(publicImagePath, asset.displayUrl).href);
      expect(revokedImage.status()).toBe(404);
    } finally { await guest.close(); }

    await page.goto("/settings/storage");
    const quota = (await (await page.request.get("/api/v1/settings/storage")).json()).data.local;
    expect(quota.usedBytes).toBe(asset.sizeBytes);
    await page.getByRole("radio", { name: "外部图床", exact: true }).check();
    await expect(page.getByText("当前：站点本地存储")).toBeVisible();
    await page.getByLabel("图床上传端点").fill("https://example.com/upload");
    await page.getByLabel("访问令牌").fill("storage-browser-test-token-1234");
    await page.getByRole("button", { name: "保存存储设置" }).click();
    await expect(page.getByText("当前：外部图床")).toBeVisible();
    await expect(page.getByText("外部图床配置已加密保存。后续上传使用此配置，已有图片不会迁移。")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("radio", { name: "外部图床", exact: true })).toBeChecked();
    await expect(page.getByLabel("访问令牌")).toHaveValue("");
    await expect(page.getByLabel("访问令牌")).toHaveAttribute("placeholder", /••••1234/);
    expect((await page.request.get(asset.displayUrl)).status()).toBe(200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`storage-external-${width}.png`), fullPage: true });

    await page.getByRole("radio", { name: "站点本地存储", exact: true }).check();
    await page.getByRole("button", { name: "保存存储设置" }).click();
    await expect(page.getByText("当前：站点本地存储")).toBeVisible();
    await expect(page.getByText(/之前的外部图床连接已保留/)).toBeVisible();
    expect((await page.request.get(asset.displayUrl)).status()).toBe(200);
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    await page.getByRole("radio", { name: "外部图床", exact: true }).check();
    await expect(page.getByLabel("图床上传端点")).toHaveValue("https://example.com/upload");
    expect(await page.getByLabel("访问令牌").getAttribute("required")).toBeNull();
  });
}
