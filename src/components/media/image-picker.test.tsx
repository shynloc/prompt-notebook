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
    expect(screen.getByText("已从链接解析图片并导入图床")).toBeVisible();
  });
});
