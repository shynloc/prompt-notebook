import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageHubWorkbench } from "./imagehub-workbench";
import type { GenerationJob } from "./types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const resultAsset = {
  id: "asset-1",
  jobId: "11111111-1111-4111-8111-111111111111",
  role: "result" as const,
  storageProvider: "picbed" as const,
  objectKey: "prompt-notebook/result.png",
  displayUrl: "https://img.example.com/result.png",
  thumbnailUrl: "https://img.example.com/result.png",
  mimeType: "image/png" as const,
  width: 1024,
  height: 1024,
  sizeBytes: 512,
  ordinal: 0,
};

function job(status: GenerationJob["status"]): GenerationJob {
  return {
    id: resultAsset.jobId,
    status,
    prompt: "A paper observatory under a red moon",
    negativePrompt: null,
    modelName: "Image Model",
    width: 1024,
    height: 1024,
    quality: "auto",
    imageCount: 1,
    progress: status === "succeeded" ? 100 : 0,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    assets: status === "succeeded" ? [resultAsset] : [],
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("AI ImageHub workbench", () => {
  it("creates a durable job and exposes cancellation without losing the prompt", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/generations?") && !init?.method) return Response.json({ data: [] });
      if (url === "/api/v1/generations" && init?.method === "POST") return Response.json({ data: job("queued") }, { status: 201 });
      if (url.includes(resultAsset.jobId) && init?.method === "DELETE") return Response.json({ data: job("cancelled") });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<ImageHubWorkbench />);
    await screen.findByText("还没有生成记录");
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "A paper observatory under a red moon" } });
    fireEvent.click(screen.getByRole("button", { name: /手机竖屏/ }));
    fireEvent.click(screen.getByRole("button", { name: /^4K/ }));
    fireEvent.click(screen.getByRole("button", { name: /^精细\s*质量优先$/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
    await screen.findByText("已进入生成队列");
    expect(screen.getByLabelText("Prompt")).toHaveValue("A paper observatory under a red moon");
    const createCall = fetcher.mock.calls.find(([url, init]) => String(url) === "/api/v1/generations" && init?.method === "POST");
    const payload = JSON.parse(String((createCall?.[1]?.body as FormData).get("payload")));
    expect(payload).toMatchObject({ width: 2160, height: 3840, quality: "high" });
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));
    await screen.findByText("已取消");
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(resultAsset.jobId), { method: "DELETE" });
  });

  it("requires confirmation before a reverse prompt replaces the editor", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/generations?")) return Response.json({ data: [job("succeeded")] });
      if (url === "/api/v1/ai/reverse-prompt") return Response.json({ data: { prompt: "A reconstructed cinematic prompt", model: { name: "Vision Model" } } });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<ImageHubWorkbench />);
    await screen.findByText("生成完成");
    const editor = screen.getByLabelText("Prompt");
    fireEvent.change(editor, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "反推" }));
    await screen.findByDisplayValue("A reconstructed cinematic prompt");
    expect(editor).toHaveValue("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "使用这个 Prompt" }));
    await waitFor(() => expect(editor).toHaveValue("A reconstructed cinematic prompt"));
  });
});
