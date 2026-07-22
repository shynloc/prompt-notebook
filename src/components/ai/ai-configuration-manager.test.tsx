import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiConfigurationManager } from "./ai-configuration-manager";

const configuration = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "主要助手",
  providerType: "openai_compatible",
  baseUrl: "https://api.example.com/v1",
  secretHint: "••••1234",
  enabled: true,
  lastTestStatus: null,
  lastTestMessage: null,
  lastTestedAt: null,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
  modelProfileId: "22222222-2222-4222-8222-222222222222",
  modelId: "writer-model",
  displayName: "Writer Model",
  capabilities: ["prompt_optimization", "reverse_prompt"],
  defaultParameters: {},
  modelEnabled: true,
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function mockFetch() {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/v1/ai/configurations" && !init?.method) return json({ data: [configuration] });
    if (url === "/api/v1/ai/preferences" && !init?.method) {
      return json({ data: [{ purpose: "prompt_optimization", modelProfileId: configuration.modelProfileId }] });
    }
    if (url === "/api/v1/ai/preferences" && init?.method === "PATCH") return json({ data: JSON.parse(String(init.body)) });
    if (url.endsWith("/test")) return json({ data: { ok: true, latencyMs: 12, availableModelIds: ["writer-model"] } });
    if (url.includes(configuration.id) && init?.method === "PATCH") return json({ data: configuration });
    if (url.includes(configuration.id) && init?.method === "DELETE") return json({ data: { id: configuration.id, deleted: true } });
    if (url === "/api/v1/ai/configurations" && init?.method === "POST") return json({ data: configuration }, 201);
    throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("AI configuration manager", () => {
  it("shows masked configurations and purpose assignments", async () => {
    mockFetch();
    render(<AiConfigurationManager />);
    expect(await screen.findByRole("heading", { name: "主要助手" })).toBeInTheDocument();
    expect(screen.getByText(/••••1234/)).toBeInTheDocument();
    expect(screen.queryByText(/sk-private/)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "提示词优化模型" })).toHaveValue(configuration.modelProfileId);
    expect(screen.getByRole("combobox", { name: "图片生成模型" })).toHaveValue("");
  });

  it("updates a purpose through the authenticated API", async () => {
    const fetcher = mockFetch();
    render(<AiConfigurationManager />);
    await screen.findByRole("heading", { name: "主要助手" });
    fireEvent.change(screen.getByRole("combobox", { name: "图片反推模型" }), {
      target: { value: configuration.modelProfileId },
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/ai/preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ purpose: "reverse_prompt", modelProfileId: configuration.modelProfileId }),
      }),
    ));
    expect(await screen.findByText("图片反推模型已更新。")).toBeInTheDocument();
  });

  it("keeps the stored key when editing with an empty key field", async () => {
    const fetcher = mockFetch();
    render(<AiConfigurationManager />);
    await screen.findByRole("heading", { name: "主要助手" });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("heading", { name: "编辑配置" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "Writer Model 2" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存修改" }).closest("form")!);
    await waitFor(() => {
      const call = fetcher.mock.calls.find(([url, init]) => String(url).includes(configuration.id) && init?.method === "PATCH");
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).not.toHaveProperty("apiKey");
    });
  });

  it("requires a key for a new configuration", async () => {
    mockFetch();
    render(<AiConfigurationManager />);
    await screen.findByRole("heading", { name: "主要助手" });
    fireEvent.change(screen.getByLabelText("配置名称"), { target: { value: "备用助手" } });
    fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "backup-model" } });
    fireEvent.submit(screen.getByRole("button", { name: "加密保存配置" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("必须填写 API Key");
  });
});
