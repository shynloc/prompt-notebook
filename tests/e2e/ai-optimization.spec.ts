import { expect, test, type Page } from "@playwright/test";

async function signUp(page: Page) {
  const email = `ai-optimizer-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("Prompt Optimizer User");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

function optimizationPayload(prompt: string) {
  return {
    data: {
      optimizedPrompt: prompt,
      model: { id: "writer-model", name: "Writer Model" },
    },
  };
}

test("compares, applies, undoes, and discards an AI optimization", async ({ page }) => {
  await signUp(page);
  let result = "A cinematic portrait with precise rim lighting and a restrained color palette.";
  await page.route("**/api/v1/ai/optimize", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ json: optimizationPayload(result) });
  });
  await page.goto("/notes/new");
  const editor = page.getByLabel("Prompt", { exact: true });
  await editor.fill("make a portrait");

  await page.getByRole("button", { name: /AI 一键优化/ }).click();
  const dialog = page.getByRole("dialog", { name: "提示词优化" });
  await expect(dialog.getByRole("status")).toContainText("AI 正在优化");
  await expect(dialog).toContainText(result);
  await expect(editor).toHaveValue("make a portrait");
  await dialog.getByRole("button", { name: "使用优化结果" }).click();
  await expect(editor).toHaveValue(result);

  await page.getByRole("button", { name: "撤销 AI 优化" }).click();
  await expect(editor).toHaveValue("make a portrait");

  result = "This result should be discarded.";
  await page.getByRole("button", { name: /AI 一键优化/ }).click();
  await expect(dialog).toContainText(result);
  await dialog.getByRole("button", { name: "放弃优化结果" }).click();
  await expect(editor).toHaveValue("make a portrait");

  await page.getByLabel("标题").fill("AI editable note");
  await page.getByRole("button", { name: "保存提示词" }).click();
  await expect(page).toHaveURL("/notes", { timeout: 15_000 });
  const card = page.locator(".prompt-card").filter({ hasText: "AI editable note" });
  await card.getByRole("link", { name: "编辑" }).click();
  await expect(page).toHaveURL(/\/notes\/[^/]+\/edit/);
  result = "An edit-page optimization result.";
  await page.getByRole("button", { name: /AI 一键优化/ }).click();
  await expect(dialog).toContainText(result);
  await dialog.getByRole("button", { name: "使用优化结果" }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue(result);
});

test("never lets a stale AI response overwrite newer edits", async ({ page }) => {
  await signUp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/ai/optimize", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ json: optimizationPayload("stale optimized result") });
  });
  await page.goto("/notes/new");
  const editor = page.getByLabel("Prompt", { exact: true });
  await editor.fill("request snapshot");
  await page.getByRole("button", { name: /AI 一键优化/ }).click();
  const dialog = page.getByRole("dialog", { name: "提示词优化" });
  await expect(dialog.getByRole("status")).toContainText("AI 正在优化");

  await editor.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "newer user edit");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(dialog.getByRole("alert")).toContainText("原提示词已经发生变化");
  await expect(dialog.getByRole("button", { name: "使用优化结果" })).toBeDisabled();
  await expect(editor).toHaveValue("newer user edit");
  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
});
