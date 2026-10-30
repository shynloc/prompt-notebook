import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageHubWorkbench } from "./imagehub-workbench";
import type { GenerationJob } from "./types";
import { reverseResultFixture } from "@/test/reverse-fixture";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
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

function mockConfiguredImageModel(modelId: string, defaultParameters: Record<string, string | number | boolean> = {}) {
  const profileId = "33333333-3333-4333-8333-333333333333";
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/v1/ai/configurations") return Response.json({ data: [{
      enabled: true, modelEnabled: true, modelProfileId: profileId, modelId,
      name: "Studio", displayName: "Image model", capabilities: ["image_generation"], defaultParameters,
    }] });
    if (url === "/api/v1/ai/preferences") return Response.json({ data: [{ purpose: "image_generation", modelProfileId: profileId }] });
    if (url.includes("/api/v1/generations?")) return Response.json({ data: [] });
    if (url === "/api/v1/generations" && init?.method === "POST") return Response.json({ data: job("queued") }, { status: 201 });
    throw new Error(`Unexpected request ${url}`);
  });
  return { profileId, fetcher };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("AI ImageHub workbench", () => {
  it("loads the exact 2.5 alias with automatic family detection and offers three resolution tiers independent of six quality choices", async () => {
    const { profileId, fetcher } = mockConfiguredImageModel("gpt-image-2.5", { imageModelFamily: "auto" });
    render(<ImageHubWorkbench />);
    await waitFor(() => expect(screen.getByLabelText("本次生图模型")).toHaveValue(profileId));
    expect(screen.getByLabelText("当前模型能力")).toHaveTextContent("Model ID：gpt-image-2.5");
    expect(screen.getByLabelText("当前模型能力")).toHaveTextContent("能力来源：供应商兼容别名（未验证）");
    expect(screen.getByText(/这不代表供应商已通过能力验证/)).toBeVisible();
    const resolutions = screen.getByRole("group", { name: "输出分辨率" });
    expect(within(resolutions).getAllByRole("button")).toHaveLength(3);
    expect(within(resolutions).getByRole("button", { name: /^1K.*1024×1024/ })).toHaveAttribute("aria-pressed", "true");
    const qualities = screen.getByRole("group", { name: "渲染质量" });
    expect(within(qualities).getAllByRole("button")).toHaveLength(6);
    fireEvent.click(within(qualities).getByRole("button", { name: /^精细\s*质量优先$/ }));
    fireEvent.click(within(resolutions).getByRole("button", { name: /^2K.*2048×2048/ }));
    expect(within(qualities).getByRole("button", { name: /^精细\s*质量优先$/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(resolutions).getByRole("button", { name: /^4K.*2880×2880/ }));
    expect(within(qualities).getByRole("button", { name: /^精细\s*质量优先$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/方图最大为 2880×2880，并非 4096×4096/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /宽屏.*16:9/ }));
    expect(within(resolutions).getByRole("button", { name: /^4K.*3840×2160/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "An architectural poster at native wide resolution" } });
    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
    await screen.findByText("已进入生成队列");
    const call = fetcher.mock.calls.find(([url, init]) => String(url) === "/api/v1/generations" && init?.method === "POST");
    const payload = JSON.parse(String((call?.[1]?.body as FormData).get("payload")));
    expect(payload).toMatchObject({ modelProfileId: profileId, width: 3840, height: 2160, quality: "high" });
    expect(fetcher.mock.calls.some(([url, init]) => String(url) === "/api/v1/ai/preferences" && init?.method === "PATCH")).toBe(false);
  });

  it("warns about experimental pixel count for a 2K square but not a smaller 2K widescreen canvas", async () => {
    const { profileId } = mockConfiguredImageModel("gpt-image-2");
    render(<ImageHubWorkbench />);
    await waitFor(() => expect(screen.getByLabelText("本次生图模型")).toHaveValue(profileId));
    expect(screen.getByLabelText("当前模型能力")).toHaveTextContent("能力来源：官方 Model ID 自动识别");
    expect(screen.queryByText(/超过 3,686,400 像素/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^2K/ }));
    expect(screen.getByText(/当前画布 2048×2048.*超过 3,686,400 像素/)).toHaveTextContent("实验性尺寸");
    fireEvent.click(screen.getByRole("button", { name: /宽屏.*16:9/ }));
    expect(screen.queryByText(/超过 3,686,400 像素/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^4K/ }));
    expect(screen.getByText(/当前画布 3840×2160.*超过 3,686,400 像素/)).toBeVisible();
  });

  it("explains conservative sizes for an unknown alias without claiming the supplier only supports those sizes", async () => {
    const { profileId } = mockConfiguredImageModel("vendor/gpt-image-2.5");
    render(<ImageHubWorkbench />);
    await waitFor(() => expect(screen.getByLabelText("本次生图模型")).toHaveValue(profileId));
    expect(screen.getByLabelText("当前模型能力")).toHaveTextContent("能力来源：未识别（保守兼容）");
    const resolutions = screen.getByRole("group", { name: "输出分辨率" });
    expect(within(resolutions).getByText(/尺寸能力尚未识别/)).toHaveTextContent("不代表供应商仅支持这些尺寸");
    expect(within(resolutions).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /^4K/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前型号使用固定尺寸/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "调整兼容设置" })).toHaveAttribute("href", "/settings/ai");
  });

  it("respects an explicitly declared legacy family even when the model ID is the 2.5 alias", async () => {
    const { profileId } = mockConfiguredImageModel("gpt-image-2.5", { imageModelFamily: "gpt-image-1" });
    render(<ImageHubWorkbench />);
    await waitFor(() => expect(screen.getByLabelText("本次生图模型")).toHaveValue(profileId));
    expect(screen.getByLabelText("当前模型能力")).toHaveTextContent("GPT Image 1 / 1.5");
    expect(screen.getByLabelText("当前模型能力")).toHaveTextContent("能力来源：用户在设置中声明");
    expect(screen.getByText(/手动声明优先于 Model ID 自动识别/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /^4K/ })).not.toBeInTheDocument();
    const resolutions = screen.getByRole("group", { name: "输出分辨率" });
    expect(within(resolutions).getByRole("button", { name: /横版.*1536×1024/ })).toBeVisible();
    expect(within(screen.getByRole("group", { name: "渲染质量" })).getAllByRole("button")).toHaveLength(4);
  });

  it("shows a fixable invalid capability configuration instead of presenting a normal fixed-size model", async () => {
    const { profileId } = mockConfiguredImageModel("gpt-image-2.5", { imageModelFamily: "gpt_image_2_5" });
    render(<ImageHubWorkbench />);
    await waitFor(() => expect(screen.getByLabelText("本次生图模型")).toHaveValue(profileId));
    expect(screen.getByRole("alert")).toHaveTextContent("生图模型能力配置无效");
    expect(screen.getByRole("link", { name: "修正能力配置" })).toHaveAttribute("href", "/settings/ai");
    expect(screen.getByLabelText("当前模型能力")).toHaveTextContent("能力来源：配置无效");
    expect(within(screen.getByRole("group", { name: "输出分辨率" })).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /开始生成/ })).toBeDisabled();
  });

  it("loads the preferred model and submits 2.5 native size and quality without changing preferences", async () => {
    const profileId = "33333333-3333-4333-8333-333333333333";
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/v1/ai/configurations") return Response.json({ data: [{ enabled: true, modelEnabled: true, modelProfileId: profileId, modelId: "gpt-image-2.5-sunburst", name: "Studio", displayName: "Sunburst", capabilities: ["image_generation"], defaultParameters: { output_format: "webp", background: "transparent", output_compression: 85 } }] });
      if (url === "/api/v1/ai/preferences") return Response.json({ data: [{ purpose: "image_generation", modelProfileId: profileId }] });
      if (url.includes("/api/v1/generations?")) return Response.json({ data: [] });
      if (url === "/api/v1/generations" && init?.method === "POST") return Response.json({ data: job("queued") }, { status: 201 });
      throw new Error(`Unexpected request ${url}`);
    });
    render(<ImageHubWorkbench />);
    await waitFor(() => expect(screen.getByLabelText("本次生图模型")).toHaveValue(profileId));
    expect(screen.getByLabelText("图片格式")).toHaveValue("webp");
    expect(screen.getByLabelText("图片背景")).toHaveValue("transparent");
    expect(screen.getByLabelText("压缩质量")).toHaveValue(85);
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "An architectural poster" } });
    fireEvent.click(screen.getByRole("button", { name: /宽屏.*16:9/ }));
    fireEvent.click(screen.getByRole("button", { name: /^4K/ }));
    fireEvent.click(screen.getByRole("button", { name: /最高\s*最高质量/ }));
    fireEvent.change(screen.getByLabelText("图片格式"), { target: { value: "png" } });
    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
    await screen.findByText("已进入生成队列");
    const call = fetcher.mock.calls.find(([url, init]) => String(url) === "/api/v1/generations" && init?.method === "POST");
    const payload = JSON.parse(String((call?.[1]?.body as FormData).get("payload")));
    expect(payload).toMatchObject({ modelProfileId: profileId, width: 3840, height: 2160, quality: "max", outputFormat: "png", background: "transparent" });
    expect(payload).not.toHaveProperty("outputCompression");
    expect(fetcher.mock.calls.filter(([url, init]) => String(url) === "/api/v1/ai/preferences" && init?.method === "PATCH")).toHaveLength(0);
  });

  it("keeps the chosen canvas when switching to a limited model and requires an explicit valid size", async () => {
    const nativeId = "33333333-3333-4333-8333-333333333333";
    const legacyId = "44444444-4444-4444-8444-444444444444";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/ai/configurations") return Response.json({ data: [
        { enabled: true, modelProfileId: nativeId, modelId: "gpt-image-2.5-flare", name: "Fast", capabilities: ["image_generation"], defaultParameters: {} },
        { enabled: true, modelProfileId: legacyId, modelId: "gpt-image-1", name: "Legacy", capabilities: ["image_generation"], defaultParameters: {} },
      ] });
      if (url === "/api/v1/ai/preferences") return Response.json({ data: [{ purpose: "image_generation", modelProfileId: nativeId }] });
      if (url.includes("/api/v1/generations?")) return Response.json({ data: [] });
      throw new Error("Unexpected request");
    });
    render(<ImageHubWorkbench />);
    await waitFor(() => expect(screen.getByLabelText("本次生图模型")).toHaveValue(nativeId));
    fireEvent.click(screen.getByRole("button", { name: /宽屏.*16:9/ }));
    fireEvent.click(screen.getByRole("button", { name: /^4K/ }));
    fireEvent.change(screen.getByLabelText("本次生图模型"), { target: { value: legacyId } });
    expect(screen.getByRole("alert")).toHaveTextContent("不支持 3840x2160");
    expect(screen.getByRole("button", { name: /开始生成/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /最高\s*最高质量/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /横版\s*1536×1024/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始生成.*1536.*1024/ })).toBeEnabled();
  });

  it("loads a result as an editing reference with feedback and preserves the user's draft", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/generations?")) return Response.json({ data: [job("succeeded")] });
      if (url.endsWith("/download")) return pending;
      throw new Error("Unexpected request");
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:reference") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    render(<ImageHubWorkbench />);
    await screen.findByText("生成完成");
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Change the sky to blue" } });
    const button = screen.getByRole("button", { name: "继续编辑" });
    fireEvent.click(button); fireEvent.click(button);
    expect(screen.getByRole("button", { name: "载入中…" })).toBeDisabled();
    release(new Response(new Blob(["source-image"], { type: "image/png" })));
    await screen.findByText("已加入参考图，当前提示词保持原样。请填写修改要求后开始生成。");
    expect(screen.getByLabelText("Prompt")).toHaveValue("Change the sky to blue");
    expect(screen.getByRole("img", { name: "参考图 1" })).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/download"))).toHaveLength(1);
  });

  it("does not apply an asynchronously loaded reference after switching to a model without image inputs", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/ai/configurations") return Response.json({ data: [
        { enabled: true, modelProfileId: "native", modelId: "gpt-image-2.5-flare", name: "Native", capabilities: ["image_generation"] },
        { enabled: true, modelProfileId: "legacy", modelId: "dall-e-3", name: "Legacy", capabilities: ["image_generation"] },
      ] });
      if (url === "/api/v1/ai/preferences") return Response.json({ data: [{ purpose: "image_generation", modelProfileId: "native" }] });
      if (url.includes("/api/v1/generations?")) return Response.json({ data: [job("succeeded")] });
      if (url.endsWith("/download")) return pending;
      throw new Error("Unexpected request");
    });
    render(<ImageHubWorkbench />);
    await waitFor(() => expect(screen.getByLabelText("本次生图模型")).toHaveValue("native"));
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    fireEvent.change(screen.getByLabelText("本次生图模型"), { target: { value: "legacy" } });
    release(new Response(new Blob(["source-image"], { type: "image/png" })));
    await screen.findByText("当前模型已切换且不支持参考图，请选择支持图片编辑的模型后重试。");
    expect(screen.queryByRole("img", { name: "参考图 1" })).not.toBeInTheDocument();
  });

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
      if (url.includes("/api/v1/generations?") && !init?.method) return Response.json({ data: [{
        ...job("succeeded"), modelId: "gpt-image-2.5-flare", providerType: "openai_compatible",
        parameters: { outputFormat: "png", background: "transparent" }, resultMetadata: { usage: { total_tokens: 1200 } },
      }] });
      if (url === `/api/v1/generations/${resultAsset.jobId}/note` && init?.method === "POST") return pendingSave;
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ImageHubWorkbench />);
    await screen.findByText("生成完成");
    const save = screen.getByRole("button", { name: "保存为笔记" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([url]) => String(url) === `/api/v1/generations/${resultAsset.jobId}/note`)).toHaveLength(1);
    releaseSave(Response.json({ data: { id: "note-1" }, meta: { replayed: false } }, { status: 201 }));

    await screen.findByText("已保存为新的提示词笔记。");
    expect(screen.getByRole("button", { name: "已保存" })).toBeDisabled();
    const saveCall = fetcher.mock.calls.find(([url]) => String(url) === `/api/v1/generations/${resultAsset.jobId}/note`);
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({ title: "", includeCharacter: true });
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
      if (url === `/api/v1/generations/${resultAsset.jobId}/note` && init?.method === "POST") {
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

    const noteCalls = fetcher.mock.calls.filter(([url]) => String(url) === `/api/v1/generations/${resultAsset.jobId}/note`);
    expect(noteCalls).toHaveLength(2);
    expect(JSON.parse(String(noteCalls[0][1]?.body)).includeCharacter).toBe(true);
    expect(JSON.parse(String(noteCalls[1][1]?.body)).includeCharacter).toBe(false);
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
