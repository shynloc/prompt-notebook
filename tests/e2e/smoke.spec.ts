import { expect, test } from "@playwright/test";

test("opens the notebook shell", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Prompt Notebook" }),
  ).toBeVisible();
});

