import { beforeEach, describe, expect, it, vi } from "vitest";

import { collectPageContext } from "./page-collector";

describe("page collector", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.title = "Prompt collection";
    history.replaceState({}, "", "/post/1");
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
  });

  it("uses the nearest article heading and ranks its large image first", () => {
    document.body.innerHTML = `<article><h2>Neon city recipe</h2><p id="selected">a cinematic neon city</p><img src="/hero.jpg" alt="generated artwork" width="1200" height="800"></article><img src="/avatar.jpg" alt="user avatar" width="400" height="400">`;
    const text = document.getElementById("selected")!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);

    const result = collectPageContext();
    expect(result).toMatchObject({ title: "Neon city recipe", prompt: "a cinematic neon city" });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe("http://localhost:3000/hero.jpg");
    expect(result.selectedImageUrls).toEqual([result.images[0].url]);
  });

  it("falls back to social metadata and removes duplicate image URLs", () => {
    document.head.innerHTML = `<meta property="og:title" content="Social prompt"><meta property="og:image" content="https://images.example/cover.jpg"><meta name="twitter:image" content="https://images.example/cover.jpg">`;
    const result = collectPageContext("selected from context menu");
    expect(result.title).toBe("Social prompt");
    expect(result.prompt).toBe("selected from context menu");
    expect(result.images).toEqual([expect.objectContaining({ url: "https://images.example/cover.jpg" })]);
  });

  it("limits candidates to eight and excludes non-public and tiny images", () => {
    document.body.innerHTML = `${Array.from({ length: 10 }, (_, index) => `<img src="https://images.example/${index}.jpg" width="600" height="400">`).join("")}<img src="data:image/png;base64,abc" width="600" height="400"><img src="/tiny.jpg" width="40" height="40">`;
    expect(collectPageContext("prompt").images).toHaveLength(8);
  });
});

