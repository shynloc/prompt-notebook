import { expect, test, type Page } from "@playwright/test";
import { reverseResultFixture } from "../../src/test/reverse-fixture";

async function signUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("Reverse Prompt User");
  await page
    .getByLabel("邮箱")
    .fill(
      `reverse-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    );
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("keeps the native reverse dialog open while a note save is in progress", async ({ page }) => {
  await signUp(page);
  await page.route("**/api/v1/ai/reverse-prompt", (route) => route.fulfill({ json: { data: reverseResultFixture() } }));
  await page.route("**/api/v1/generations?**", (route) => route.fulfill({ json: { data: [] } }));
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/notes", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await hold;
    await route.fulfill({ json: { data: { id: "saved-note" } } });
  });
  await page.goto("/imagehub");
  await page.getByRole("button", { name: "图片反推提示词", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "图片反推", exact: true });
  await dialog.getByLabel("选择反推图片", { exact: true }).setInputFiles({ name: "source.png", mimeType: "image/png", buffer: png });
  await dialog.getByRole("button", { name: "AI 一键反推" }).click();
  await dialog.getByRole("button", { name: "保存为提示词笔记" }).click();
  await expect(dialog.getByRole("button", { name: "保存中…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭图片反推" })).toBeDisabled();
  release();
  await expect(dialog.getByRole("button", { name: "已保存为笔记" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "图片反推提示词", exact: true })).toBeFocused();
});

test("reconstructs an uploaded image, applies overrides, and transfers it to encyclopedia analysis", async ({
  page,
}, testInfo) => {
  await signUp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  // All three encyclopedia tabs remain discoverable without horizontal scrolling.
  let attempts = 0;
  await page.route("**/api/v1/ai/reverse-prompt", async (route) => {
    attempts++;
    expect(route.request().postDataBuffer()?.toString()).toContain(
      "把衬衫改成蓝色",
    );
    await route.fulfill({ json: { data: reverseResultFixture() } });
  });
  await page.goto("/library?tab=reverse");
  await expect(
    page.getByRole("tab", { name: "图片反推", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const reverseTab = await page.getByRole("tab", { name: "图片反推", exact: true }).boundingBox();
  expect(reverseTab!.x + reverseTab!.width).toBeLessThanOrEqual(390);
  await page
    .getByLabel("选择反推图片", { exact: true })
    .setInputFiles({
      name: "portrait.png",
      mimeType: "image/png",
      buffer: png,
    });
  await page.getByLabel("额外要求（可选）").fill("把衬衫改成蓝色");
  await page.getByRole("button", { name: "AI 一键反推" }).click();
  await expect(page.getByLabel("反推提示词", { exact: true })).toHaveValue(
    reverseResultFixture().prompt,
  );
  await expect(page.getByText("服饰与配件：白色衬衫 → 蓝色衬衫")).toBeVisible();
  await page.getByRole("tab", { name: "分模块编辑" }).click();
  await page
    .getByRole("textbox", { name: "服饰与配件", exact: true })
    .fill("蓝色丝绸衬衫");
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  await expect(page.locator(".reverse-result pre")).toContainText(
    "蓝色丝绸衬衫",
  );
  await page.screenshot({
    path: testInfo.outputPath("reverse-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "送到百科分析" }).click();
  await expect(
    page.getByRole("tab", { name: "✦ AI 提示词分析" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("完整提示词")).toHaveValue(/蓝色丝绸衬衫/);
  await page.getByRole("tab", { name: "图片反推", exact: true }).click();
  const title = `Reverse note ${Date.now()}`;
  await page.getByLabel("笔记标题").fill(title);
  await page.getByRole("button", { name: "保存为提示词笔记" }).click();
  await expect(
    page.getByRole("button", { name: "已保存为笔记" }),
  ).toBeDisabled();
  const notes = await page.request.get(
    `/api/v1/notes?q=${encodeURIComponent(title)}`,
  );
  expect(notes.ok()).toBe(true);
  const data = (await notes.json()).data;
  expect(data).toHaveLength(1);
  expect(data[0].prompt).toContain("蓝色丝绸衬衫");
  expect(attempts).toBe(1);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("applies image reconstruction with confirmation and one-click undo", async ({
  page,
}) => {
  await signUp(page);
  await page.route("**/api/v1/ai/reverse-prompt", (route) =>
    route.fulfill({ json: { data: reverseResultFixture() } }),
  );
  await page.route("**/api/v1/generations?**", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.goto("/imagehub");
  await page
    .getByLabel("Prompt", { exact: true })
    .fill("Keep my original input");
  await page
    .getByLabel("负面提示词", { exact: true })
    .fill("original negative");
  await page
    .getByRole("button", { name: "图片反推提示词", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "图片反推", exact: true });
  await dialog
    .getByLabel("选择反推图片", { exact: true })
    .setInputFiles({ name: "source.png", mimeType: "image/png", buffer: png });
  await dialog.getByRole("button", { name: "AI 一键反推" }).click();
  await expect(dialog.getByLabel("反推提示词", { exact: true })).toHaveValue(
    reverseResultFixture().prompt,
  );
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await dialog.getByRole("button", { name: "使用这个 Prompt" }).click();
  await expect(dialog).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "使用这个 Prompt" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue(
    reverseResultFixture().prompt,
  );
  await page.getByRole("button", { name: "撤销图片反推" }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Keep my original input",
  );
  await expect(page.getByLabel("负面提示词", { exact: true })).toHaveValue(
    "original negative",
  );
});

test("keeps AI Model confirmation above the task wall at desktop, tablet and mobile widths", async ({
  page,
}, testInfo) => {
  await signUp(page);
  const image = {
    id: "ref-1",
    thumbnailUrl: `data:image/png;base64,${png.toString("base64")}`,
    displayUrl: "https://example.com/ref.png",
    isPrimary: true,
    viewType: "portrait",
    focusX: 50,
    focusY: 50,
  };
  const profiles = Array.from({ length: 18 }, (_, index) => ({
    id: `model-${index}`,
    name: `Luna ${index}`,
    summary: "A fashion model with a long description",
    roleDefinition: "Fashion",
    useCases: ["时尚"],
    coverImage: image,
    primaryImage: image,
    images: Array.from({ length: 16 }, (_, i) => ({
      ...image,
      id: `ref-${i}`,
      isPrimary: i === 0,
    })),
  }));
  await page.route("**/api/v1/generations?**", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route("**/api/v1/ai-models?**", (route) =>
    route.fulfill({ json: { data: profiles } }),
  );
  await page.goto("/imagehub");
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: /从 AI Model 选择/ }).click();
    const dialog = page.getByRole("dialog", { name: "选择垫图模特" });
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate(
        (node) =>
          node.matches(":modal") && node.parentElement === document.body,
      ),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "选择 Luna 0 主图", exact: true })
      .click();
    const confirm = dialog.getByRole("button", { name: "确认使用" });
    const target = await confirm.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.x + target!.width).toBeLessThanOrEqual(width);
    expect(target!.y + target!.height).toBeLessThanOrEqual(900);
    expect(
      await confirm.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    ).toBe(true);
    await dialog.locator(".character-reference-table-wrap").evaluate((node) => {
      node.scrollTop = 500;
    });
    await expect(confirm).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`model-picker-${width}.png`),
    });
    await confirm.click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /Luna 0.*已选 1 张角色参考图/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "清除 AI Model" }).click();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
      "hidden",
    );
  }
});
