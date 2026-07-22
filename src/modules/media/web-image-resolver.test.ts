// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPageImageCandidates, MAX_HTML_BYTES, resolveWebImage } from "./web-image-resolver";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function response(body: BodyInit, contentType: string, headers: Record<string, string> = {}) {
  return new Response(body, { status: 200, headers: { "content-type": contentType, ...headers } });
}

describe("web image resolver", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps direct raster imports working", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response(PNG, "image/png"));
    await expect(resolveWebImage("https://93.184.216.34/direct.png")).resolves.toEqual(PNG);
  });

  it("extracts Open Graph and Twitter Card images regardless of attribute order", () => {
    const html = `
      <meta content="/cover.jpg?size=large&amp;format=webp" property="og:image">
      <meta name='twitter:image:src' content='https://93.184.216.35/fallback.png'>
      <link href="/legacy.jpg" rel="image_src">
    `;
    expect(extractPageImageCandidates(html, "https://93.184.216.34/post/1")).toEqual([
      "https://93.184.216.34/cover.jpg?size=large&format=webp",
      "https://93.184.216.35/fallback.png",
      "https://93.184.216.34/legacy.jpg",
    ]);
  });

  it("downloads and validates a declared page preview", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response('<html><head><meta property="og:image" content="https://93.184.216.35/media.png"></head></html>', "text/html; charset=utf-8"))
      .mockResolvedValueOnce(response(PNG, "image/png"));
    await expect(resolveWebImage("https://93.184.216.34/post/1")).resolves.toEqual(PNG);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("finds public X media candidates without a third-party resolver", () => {
    const html = '<script>window.media="https://pbs.twimg.com/media/HNjbVB-bYAAxeEm.jpg:large"</script>';
    expect(extractPageImageCandidates(html, "https://x.com/example/status/123/photo/1")).toEqual([
      "https://pbs.twimg.com/media/HNjbVB-bYAAxeEm.jpg:large",
    ]);
  });

  it("rejects pages with no preview, private candidates, and oversized HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response("<html><head><title>No image</title></head></html>", "text/html"));
    await expect(resolveWebImage("https://93.184.216.34/no-image")).rejects.toThrow(/没有提供/);
    vi.restoreAllMocks();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response('<meta property="og:image" content="http://127.0.0.1/private.png">', "text/html"));
    await expect(resolveWebImage("https://93.184.216.34/private-candidate")).rejects.toThrow(/无法下载有效/);
    vi.restoreAllMocks();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response("<html></html>", "text/html", { "content-length": String(MAX_HTML_BYTES + 1) }));
    await expect(resolveWebImage("https://93.184.216.34/huge-page")).rejects.toThrow(/网页内容过大/);
  });
});
