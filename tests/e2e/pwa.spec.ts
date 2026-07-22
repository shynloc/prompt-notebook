import { expect, test } from "@playwright/test";

test("publishes install metadata and a privacy-safe service worker", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect(await manifest.json()).toMatchObject({ name: "Prompt Notebook", display: "standalone", start_url: "/notes" });
  const worker = await request.get("/sw.js");
  const source = await worker.text();
  expect(worker.ok()).toBeTruthy();
  expect(source).toContain('url.pathname.startsWith("/api/")');
  expect(source).toContain('request.mode === "navigate"');
});
