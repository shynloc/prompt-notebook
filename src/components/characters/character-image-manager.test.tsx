import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterImageManager } from "./character-image-manager";
import type { CharacterImageDraft } from "./types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const image = (key: string, overrides: Partial<CharacterImageDraft> = {}): CharacterImageDraft => ({
  storageProvider: "picbed",
  objectKey: `${key}.png`,
  displayUrl: `https://img.example.com/${key}.png`,
  thumbnailUrl: `https://img.example.com/${key}.png`,
  mimeType: "image/png",
  width: 800,
  height: 1200,
  sizeBytes: 1200,
  viewType: "other",
  caption: "",
  isCover: false,
  isPrimary: false,
  focusX: 50,
  focusY: 50,
  metadata: {},
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe("CharacterImageManager", () => {
  it("makes the first uploaded image both cover and primary", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: image("luna") }, { status: 201 }));
    const onChange = vi.fn();
    render(<CharacterImageManager images={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/点击选择一张或多张图片/), {
      target: { files: [new File(["image"], "luna.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ objectKey: "luna.png", isCover: true, isPrimary: true });
    expect(screen.getByText("已添加 1 张角色图片。")).toBeVisible();
  });

  it("keeps cover and primary unique and preserves them when another image is removed", () => {
    const onChange = vi.fn();
    const images = [image("one", { isCover: true, isPrimary: true }), image("two")];
    render(<CharacterImageManager images={images} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "设为主图" }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ objectKey: "one.png", isPrimary: false }),
      expect.objectContaining({ objectKey: "two.png", isPrimary: true }),
    ]);

    fireEvent.click(screen.getAllByRole("button", { name: "移除" })[1]);
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ objectKey: "one.png", isCover: true, isPrimary: true })]);
  });

  it("accepts a local image and exposes the backend quota error for unsuccessful uploads", async () => {
    const onChange = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ data: image("local", { storageProvider: "local" }) }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ error: { message: "本地图片存储配额不足" } }, { status: 413 }));
    render(<CharacterImageManager images={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/点击选择一张或多张图片/), { target: { files: [new File(["image"], "one.png", { type: "image/png" }), new File(["image"], "two.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("已添加 1 张，1 张未能导入。本地图片存储配额不足");
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ storageProvider: "local", isCover: true, isPrimary: true });
  });
});
