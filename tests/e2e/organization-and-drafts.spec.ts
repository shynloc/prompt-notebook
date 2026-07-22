import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function signUp(page: Page, label: string) {
  const emailLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const email = `${emailLabel}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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

test("keeps a card cover and tags after toggling favorite", async ({ page }) => {
  const title = `Favorite cover ${Date.now()}`;
  const imageUrl = "https://images.example.com/favorite-cover.png";
  await page.route(imageUrl, (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  }));
  await signUp(page, "Favorite Cover User");
  const created = await page.evaluate(async ({ noteTitle, coverUrl }) => {
    const response = await fetch("/api/v1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: noteTitle,
        prompt: "preserve this cover while favoriting",
        tags: ["封面回归"],
        images: [{
          storageProvider: "picbed",
          objectKey: "tests/favorite-cover.png",
          displayUrl: coverUrl,
          thumbnailUrl: coverUrl,
          mimeType: "image/png",
          width: 1,
          height: 1,
          sizeBytes: 68,
        }],
      }),
    });
    return (await response.json()).data;
  }, { noteTitle: title, coverUrl: imageUrl });

  await page.goto("/notes");
  const card = page.locator(".prompt-card").filter({ hasText: title });
  await expect(card.locator(".prompt-card__visual img")).toHaveAttribute("src", imageUrl);
  await expect(card.getByRole("link", { name: "封面回归" })).toBeVisible();
  await card.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await expect(card.locator(".prompt-card__visual img")).toHaveAttribute("src", imageUrl);
  await expect(card.getByRole("link", { name: "封面回归" })).toBeVisible();

  const persisted = await page.evaluate(async (noteId) => (await (await fetch(`/api/v1/notes/${noteId}`)).json()).data, created.id);
  expect(persisted.images).toHaveLength(1);
  expect(persisted.coverImage.objectKey).toBe("tests/favorite-cover.png");
  expect(persisted.tags).toHaveLength(1);
});
