// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { PicbedProvider } from "./picbed";

describe("PicbedProvider", () => {
  it("normalizes a nested response and keeps the token server-side", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { path: "prompt-notebook/test/image.png" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const provider = new PicbedProvider("https://img.example.com", "super-secret-token", fetchMock);
    const result = await provider.upload({ data: Buffer.from([1, 2, 3]), filename: "image.png", mimeType: "image/png", path: "prompt-notebook/test/image.png" });
    expect(result.displayUrl).toBe("https://img.example.com/prompt-notebook/test/image.png");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "x-auth-token": "super-secret-token" });
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
  });

  it("returns a generic configuration error without the token", async () => {
    const provider = new PicbedProvider("https://img.example.com", undefined);
    await expect(provider.upload({ data: Buffer.from([1]), filename: "x.png", mimeType: "image/png", path: "x.png" })).rejects.toThrow("not configured");
  });
});
