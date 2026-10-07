import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageHubWorkbench } from "./imagehub-workbench";
import type { GenerationJob } from "./types";
import { reverseResultFixture } from "@/test/reverse-fixture";

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
  it("cancels stale optimization responses, sends visual hints, and supports undo", async () => {
    let releaseFirst: (response: Response) => void = () => undefined;
    const firstOptimization = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    let optimizationAttempt = 0;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/generations?") && !init?.method) return Response.json({ data: [] });
      if (url === "/api/v1/ai/optimize" && init?.method === "POST") {
        optimizationAttempt += 1;
        if (optimizationAttempt === 1) return firstOptimization;
        return Response.json({ data: { optimizedPrompt: "newer optimized prompt", model: { id: "writer", name: "Writer" } } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ImageHubWorkbench />);
    await screen.findByText("还没有生成记录");
    const editor = screen.getByLabelText("Prompt");
    fireEvent.change(editor, { target: { value: "original visual prompt" } });
    fireEvent.click(screen.getByRole("button", { name: /手机竖屏.*9:16/ }));
    fireEvent.click(screen.getByRole("button", { name: "✦ AI 优化提示词" }));
    expect(await screen.findByRole("status")).toHaveTextContent("AI 正在优化提示词");
    fireEvent.click(screen.getByRole("button", { name: "取消优化" }));
    expect(screen.queryByRole("dialog", { name: "提示词优化" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "✦ AI 优化提示词" }));
    expect(await screen.findByText("newer optimized prompt")).toBeVisible();
    releaseFirst(Response.json({ data: { optimizedPrompt: "stale optimized prompt", model: { id: "old", name: "Old" } } }));
    await waitFor(() => expect(screen.queryByText("stale optimized prompt")).not.toBeInTheDocument());

    const optimizationCalls = fetcher.mock.calls.filter(([url]) => String(url) === "/api/v1/ai/optimize");
    const payload = JSON.parse(String(optimizationCalls[1][1]?.body));
    expect(payload).toMatchObject({
      context: "image_generation",
      hints: { hasAiModel: false, referenceImageCount: 0, aspectRatio: "9:16" },
    });

    fireEvent.click(screen.getByRole("button", { name: "使用优化结果" }));
    expect(editor).toHaveValue("newer optimized prompt");
    fireEvent.click(screen.getByRole("button", { name: "撤销 AI 优化" }));
    expect(editor).toHaveValue("original visual prompt");
  });

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
      if (url === "/api/v1/ai/reverse-prompt") return Response.json({ data: reverseResultFixture() });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<ImageHubWorkbench />);
    await screen.findByText("生成完成");
    const editor = screen.getByLabelText("Prompt");
    fireEvent.change(editor, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "反推" }));
    fireEvent.click(screen.getByRole("button", { name: "AI 一键反推" }));
    await waitFor(() => expect(screen.getByLabelText("反推提示词")).toHaveValue(reverseResultFixture().prompt));
    expect(editor).toHaveValue("Keep this draft");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "使用这个 Prompt" }));
    expect(editor).toHaveValue("Keep this draft");
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "使用这个 Prompt" }));
    await waitFor(() => expect(editor).toHaveValue(reverseResultFixture().prompt));
    expect(screen.getByLabelText("负面提示词")).toHaveValue(reverseResultFixture().negativePrompt);
    fireEvent.click(screen.getByRole("button", { name: "撤销图片反推" }));
    expect(editor).toHaveValue("Keep this draft");
  });

  it("downloads a generated image as a file without opening a new tab", async () => {
    let releaseDownload: (response: Response) => void = () => undefined;
    const pendingDownload = new Promise<Response>((resolve) => { releaseDownload = resolve; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/generations?") && !url.includes("/download")) return Response.json({ data: [job("succeeded")] });
      if (url.endsWith(`/assets/${resultAsset.id}/download`)) return pendingDownload;
      throw new Error(`Unexpected request: ${url}`);
    });
    const createObjectUrl = vi.fn(() => "blob:download-test");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<ImageHubWorkbench />);
    await screen.findByText("生成完成");
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    expect(screen.getByRole("button", { name: "准备中…" })).toBeDisabled();
    releaseDownload(new Response(new Blob(["image"]), {
      headers: {
        "content-disposition": 'attachment; filename="prompt-notebook-result.png"',
        "content-type": "image/png",
      },
    }));

    await screen.findByText("图片下载已开始。");
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/assets/${resultAsset.id}/download`));
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[target="_blank"]')).not.toBeInTheDocument();
  });

  it("disables note saving immediately and sends a stable idempotency key", async () => {
    let releaseSave: (response: Response) => void = () => undefined;
    const pendingSave = new Promise<Response>((resolve) => { releaseSave = resolve; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/generations?") && !init?.method) return Response.json({ data: [job("succeeded")] });
      if (url === "/api/v1/notes" && init?.method === "POST") return pendingSave;
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ImageHubWorkbench />);
    await screen.findByText("生成完成");
    const save = screen.getByRole("button", { name: "保存为笔记" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/v1/notes")).toHaveLength(1);
    releaseSave(Response.json({ data: { id: "note-1" }, meta: { replayed: false } }, { status: 201 }));

    await screen.findByText("已保存为新的提示词笔记。");
    expect(screen.getByRole("button", { name: "已保存" })).toBeDisabled();
    const saveCall = fetcher.mock.calls.find(([url]) => String(url) === "/api/v1/notes");
    expect(new Headers(saveCall?.[1]?.headers).get("idempotency-key")).toBe(`imagehub-note:${resultAsset.jobId}`);
  });

  it("offers an explicit retry without a stale AI Model association", async () => {
    const characterJob: GenerationJob = {
      ...job("succeeded"),
      characterProfile: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Luna",
        version: 1,
        imageIds: [],
        available: true,
      },
    };
    let noteAttempt = 0;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/generations?") && !init?.method) return Response.json({ data: [characterJob] });
      if (url === "/api/v1/notes" && init?.method === "POST") {
        noteAttempt += 1;
        if (noteAttempt === 1) {
          return Response.json({ error: { code: "CHARACTER_PROFILE_NOT_FOUND", message: "Character profile unavailable" } }, { status: 422 });
        }
        return Response.json({ data: { id: "note-1" }, meta: { replayed: false } }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ImageHubWorkbench />);
    await screen.findByText("生成完成");
    fireEvent.click(screen.getByRole("button", { name: "保存为笔记" }));

    expect(await screen.findByText("关联的 AI Model 已被移入回收站或删除，笔记尚未创建。你可以移除失效的角色关联后再次保存。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "移除角色关联后保存" }));
    await screen.findByText("已保存为新的提示词笔记。");

    const noteCalls = fetcher.mock.calls.filter(([url]) => String(url) === "/api/v1/notes");
    expect(noteCalls).toHaveLength(2);
    expect(JSON.parse(String(noteCalls[0][1]?.body)).characterProfiles).toEqual([
      { id: characterJob.characterProfile?.id, role: "primary", sortOrder: 0 },
    ]);
    expect(JSON.parse(String(noteCalls[1][1]?.body)).characterProfiles).toEqual([]);
    expect(new Headers(noteCalls[0][1]?.headers).get("idempotency-key")).toBe(new Headers(noteCalls[1][1]?.headers).get("idempotency-key"));
    expect(screen.getByRole("button", { name: "已保存" })).toBeDisabled();
  });

  it("deletes a failed history card after confirmation", async () => {
    const failed = { ...job("failed"), errorMessage: "Provider rejected the request" };
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/generations?") && !init?.method) return Response.json({ data: [failed] });
      if (url.includes(`${resultAsset.jobId}?mode=history`) && init?.method === "DELETE") {
        return Response.json({ data: { id: resultAsset.jobId, deleted: true } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ImageHubWorkbench />);
    await screen.findByText("Provider rejected the request");
    fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
    await screen.findByText("生成历史已删除。");
    expect(screen.queryByText("Provider rejected the request")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("mode=history"), { method: "DELETE" });
  });
});
