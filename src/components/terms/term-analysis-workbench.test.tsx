import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TermAnalysisWorkbench } from "./term-analysis-workbench";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("term analysis workbench", () => {
  it("lets the user review candidates before batch-saving selected terms", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/terms/analyze") return Response.json({ data: {
        model: { id: "writer-model", name: "Writer Model", inherited: true },
        candidates: [
          { id: "existing", category: "光线", label: "体积光", value: "volumetric lighting", sourceExcerpt: "volumetric lighting", confidence: "high", duplicate: { kind: "exact", id: "builtin", label: "体积光", value: "volumetric lighting", builtIn: true } },
          { id: "new", category: "光线", label: "柔和轮廓光", value: "gentle rim light", sourceExcerpt: "gentle rim light", confidence: "medium", duplicate: null },
        ],
      } });
      if (String(input) === "/api/v1/terms/bulk") {
        expect(JSON.parse(String(init?.body))).toEqual({ terms: [
          { category: "光线", label: "柔和轮廓光", value: "gentle rim light" },
        ] });
        return Response.json({ data: {
          created: [{ id: "saved", category: "光线", label: "柔和轮廓光", value: "gentle rim light" }],
          skipped: [],
        } }, { status: 201 });
      }
      throw new Error(`Unexpected fetch ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const onSaved = vi.fn();
    render(<TermAnalysisWorkbench onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("完整提示词"), {
      target: { value: "portrait with volumetric lighting and gentle rim light" },
    });
    fireEvent.click(screen.getByRole("button", { name: "✦ AI 一键分析" }));

    expect(await screen.findByText(/找到 2 个候选词条/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /体积光/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /柔和轮廓光/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量收录 1 项" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(await screen.findByText(/已收录 1 个词条/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("points the user to settings when no analyzer model is configured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: {
      code: "AI_TERM_ANALYZER_NOT_CONFIGURED",
      message: "请先在设置中指定模型",
    } }, { status: 422 })));
    render(<TermAnalysisWorkbench onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("完整提示词"), { target: { value: "cinematic portrait lighting" } });
    fireEvent.click(screen.getByRole("button", { name: "✦ AI 一键分析" }));
    expect(await screen.findByRole("link", { name: "前往设置模型" })).toHaveAttribute("href", "/settings/ai");
  });
});
