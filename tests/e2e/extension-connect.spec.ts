import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

test("approves and revokes a Chrome extension device", async ({ page }) => {
  const email = `extension-e2e-${Date.now()}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("昵称").fill("Extension E2E");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("correct-horse-battery");
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.waitForURL("/");

  const callbackOrigin = `https://${"a".repeat(32)}.chromiumapp.org`;
  const codeVerifier = "b".repeat(43);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  await page.route(`${callbackOrigin}/**`, async (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<h1>Extension callback received</h1>",
  }));
  const query = new URLSearchParams({
    code_challenge: codeChallenge,
    redirect_uri: `${callbackOrigin}/prompt-notebook`,
    state: "state-e2e",
    device_name: "Chrome E2E",
  });
  await page.goto(`/extension/connect?${query}`);
  await expect(page.getByRole("heading", { name: "连接提示词笔记本" })).toBeVisible();
  await page.getByRole("button", { name: "允许并连接" }).click();
  await page.waitForURL((url) => url.origin === callbackOrigin);
  const code = new URL(page.url()).searchParams.get("code");
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(new URL(page.url()).searchParams.get("state")).toBe("state-e2e");

  const tokenResponse = await page.request.post("/api/v1/extension/token", {
    data: {
      code,
      codeVerifier,
      redirectUri: `${callbackOrigin}/prompt-notebook`,
    },
  });
  expect(tokenResponse.ok()).toBeTruthy();

  await page.goto("/profile");
  await expect(page.getByText("Chrome E2E")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "撤销访问" }).click();
  await expect(page.getByText("设备授权已撤销。该插件需要重新连接才能继续保存。")).toBeVisible();
  await expect(page.getByText("已撤销", { exact: true })).toBeVisible();
});
