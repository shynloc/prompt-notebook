import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareEditingImage } from "./editing-image";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("generated image editing preparation", () => {
  it("keeps an already-small source file unchanged", async () => {
    const source = new Blob(["native file"], { type: "image/png" });
    const output = await prepareEditingImage(source, "source.png", "image/png");
    expect(output.name).toBe("source.png");
    expect(output.type).toBe("image/png");
    const contents = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
      reader.readAsText(output);
    });
    expect(contents).toBe("native file");
  });

  it("compresses a large result without shrinking its native canvas or flattening alpha", async () => {
    const bitmap = { width: 3840, height: 2160, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const drawImage = vi.fn();
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback, type, quality) {
      expect(this.width).toBe(3840); expect(this.height).toBe(2160);
      expect(type).toBe("image/webp"); expect(quality).toBe(0.92);
      callback(new Blob(["compressed"], { type: "image/webp" }));
    });
    const source = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/png" });
    const file = await prepareEditingImage(source, "source.png", "image/png");
    expect(file.type).toBe("image/webp");
    expect(file.name).toBe("source-edit.webp");
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(context).toHaveBeenCalledWith("2d");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("rejects an oversized decoded canvas and releases the bitmap", async () => {
    const bitmap = { width: 10_000, height: 10_000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const source = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]);
    await expect(prepareEditingImage(source, "large.png", "image/png")).rejects.toThrow("像素过大");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
