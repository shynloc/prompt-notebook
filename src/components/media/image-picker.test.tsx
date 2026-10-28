import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePicker } from "./image-picker";

const importedImage = {
  storageProvider: "picbed" as const,
  objectKey: "prompt-notebook/example.png",
  displayUrl: "https://images.example.com/prompt-notebook/example.png",
  thumbnailUrl: "https://images.example.com/prompt-notebook/example.png",
  mimeType: "image/png" as const,
  width: 512,
  height: 512,
  sizeBytes: 1024,
};

describe("ImagePicker link import", () => {
  afterEach(() => vi.restoreAllMocks());

  it("imports inside the prompt form without submitting or leaving the editor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: importedImage }), { status: 201, headers: { "content-type": "application/json" } }));
    const outerSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onChange = vi.fn();
    render(<form onSubmit={outerSubmit}><ImagePicker images={[]} onChange={onChange} /></form>);

    fireEvent.click(screen.getByRole("tab", { name: "粘贴链接" }));
    fireEvent.change(screen.getByLabelText("图片或网页链接"), { target: { value: "https://x.com/example/status/123/photo/1" } });
    fireEvent.click(screen.getByRole("button", { name: "解析并导入" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([importedImage]));
    expect(outerSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("已从链接解析图片并保存到当前图片存储")).toBeVisible();
  });

  it("accepts a real local-provider image and gives storage-specific upload feedback", async () => {
    const local = { ...importedImage, storageProvider: "local", objectKey: "local/object-id", displayUrl: "http://localhost:3000/api/v1/media/files/object-id", thumbnailUrl: "http://localhost:3000/api/v1/media/files/object-id" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: local }, { status: 201 }));
    const onChange = vi.fn();
    render(<ImagePicker images={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("上传预览图片"), { target: { files: [new File(["png"], "image.png", { type: "image/png" })] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([local]));
    expect(screen.getByRole("status")).toHaveTextContent("已上传到站点本地存储");
  });

  it("shows a quota error without adding an image or allowing duplicate uploads", async () => {
    let finish: (response: Response) => void = () => undefined;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const onChange = vi.fn();
    render(<ImagePicker images={[]} onChange={onChange} />);
    const input = screen.getByLabelText("上传预览图片");
    const event = { target: { files: [new File(["png"], "image.png", { type: "image/png" })] } };
    fireEvent.change(input, event); fireEvent.change(input, event);
    expect(fetcher).toHaveBeenCalledOnce();
    finish(Response.json({ error: { message: "本地图片存储配额不足，请删除不需要的图片或切换外部图床。" } }, { status: 413 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("存储配额不足");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).not.toBeDisabled();
  });

  it("reports an image-library failure instead of silently showing an empty library", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    render(<ImagePicker images={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "图片库" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("图片库暂时无法加载");
  });
});
