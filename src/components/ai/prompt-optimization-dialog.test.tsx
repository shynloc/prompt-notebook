import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PromptOptimizationDialog } from "./prompt-optimization-dialog";

const readyState = {
  status: "ready" as const,
  originalPrompt: "original prompt",
  optimizedPrompt: "professional optimized prompt",
  modelName: "Writer Model",
};

const structuredState = {
  ...readyState,
  structure: {
    version: 1 as const,
    format: "structured" as const,
    context: "image_generation" as const,
    artifactLabel: "产品宣传海报",
    intents: {
      purposes: ["promotional" as const],
      media: ["graphic_design" as const, "photography" as const],
      subjects: ["product" as const],
    },
    requestedModules: [],
    selectedModules: ["contract" as const, "content" as const, "organization" as const],
    capabilities: ["product_integrity" as const, "brand_layout" as const],
    sections: [
      { module: "contract" as const, heading: "生成目标", content: "制作一张用于新品发布的宣传海报。" },
      { module: "organization" as const, heading: "构图与组织", content: "产品居中，标题位于上方。" },
    ],
    lockedFacts: [{ kind: "quoted_text" as const, value: "NEW FORMULA", preserved: true }],
    warnings: [],
  },
};

describe("Prompt optimization dialog", () => {
  it("discards a result without applying it", () => {
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    render(
      <PromptOptimizationDialog
        state={readyState}
        currentPrompt="original prompt"
        onApply={onApply}
        onDiscard={onDiscard}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "放弃优化结果" }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("cannot overwrite edits made after the optimization started", () => {
    const onApply = vi.fn();
    render(
      <PromptOptimizationDialog
        state={readyState}
        currentPrompt="newer user edit"
        onApply={onApply}
        onDiscard={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("原提示词已经发生变化");
    const apply = screen.getByRole("button", { name: "使用优化结果" });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("copies or explicitly applies the optimized result", async () => {
    const onApply = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <PromptOptimizationDialog
        state={readyState}
        currentPrompt="original prompt"
        onApply={onApply}
        onDiscard={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制优化结果" }));
    expect(writeText).toHaveBeenCalledWith("professional optimized prompt");
    fireEvent.click(screen.getByRole("button", { name: "使用优化结果" }));
    expect(onApply).toHaveBeenCalledWith("professional optimized prompt");
  });

  it("announces loading and lets the user cancel", () => {
    const onDiscard = vi.fn();
    render(
      <PromptOptimizationDialog
        state={{ status: "loading", originalPrompt: "original prompt" }}
        currentPrompt="original prompt"
        onApply={vi.fn()}
        onDiscard={onDiscard}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("AI 正在优化");
    fireEvent.click(screen.getByRole("button", { name: "取消优化" }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("keeps keyboard focus inside the dialog and closes with Escape", () => {
    const onDiscard = vi.fn();
    render(
      <PromptOptimizationDialog
        state={readyState}
        currentPrompt="original prompt"
        onApply={vi.fn()}
        onDiscard={onDiscard}
        onRetry={vi.fn()}
      />,
    );
    const apply = screen.getByRole("button", { name: "使用优化结果" });
    const close = screen.getByRole("button", { name: "关闭优化对话框" });
    apply.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("shows recognized intent, modules, locked facts, and a collapsed structure view", () => {
    render(
      <PromptOptimizationDialog
        state={structuredState}
        currentPrompt="original prompt"
        onApply={vi.fn()}
        onDiscard={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "识别为：产品宣传海报" })).toBeVisible();
    expect(screen.getByLabelText("识别标签")).toHaveTextContent("宣传推广");
    expect(screen.getByLabelText("识别标签")).toHaveTextContent("产品");
    expect(screen.getByLabelText("本次优化模块")).toHaveTextContent("生成目标");
    const structure = screen.getByText("查看结构视图（2 个模块）").closest("details");
    expect(structure).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("查看结构视图（2 个模块）"));
    expect(screen.getByText("制作一张用于新品发布的宣传海报。")).toBeVisible();
    fireEvent.click(screen.getByText("查看事实锁定（1 项）"));
    expect(screen.getByText("NEW FORMULA")).toBeVisible();
    expect(screen.getByText("已保留")).toBeVisible();
  });

  it("renders untrusted model labels and warnings only as text", () => {
    const untrusted = {
      ...structuredState,
      structure: {
        ...structuredState.structure,
        artifactLabel: '<img src=x onerror="alert(1)">',
        warnings: [{
          code: "low_confidence",
          severity: "warning" as const,
          blocking: false,
          message: "<script>window.pwned=true</script>",
        }],
      },
    };
    const { container } = render(
      <PromptOptimizationDialog
        state={untrusted}
        currentPrompt="original prompt"
        onApply={vi.fn()}
        onDiscard={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/<img src=x onerror=/)).toBeVisible();
    expect(screen.getByText("<script>window.pwned=true</script>")).toBeVisible();
    expect(container.querySelector("img, script")).toBeNull();
  });

  it("lets the user select modules and retry without changing the editor", () => {
    const onRetry = vi.fn();
    render(
      <PromptOptimizationDialog
        state={structuredState}
        currentPrompt="original prompt"
        onApply={vi.fn()}
        onDiscard={vi.fn()}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "调整并重试" }));
    fireEvent.click(screen.getByLabelText("文字与信息"));
    fireEvent.click(screen.getByRole("button", { name: "按所选模块重新优化" }));
    expect(onRetry).toHaveBeenCalledWith({
      context: "image_generation",
      requestedModules: ["contract", "content", "organization", "information"],
    });

    fireEvent.click(screen.getByRole("button", { name: "调整并重试" }));
    fireEvent.click(screen.getByRole("button", { name: "作为通用提示词重新优化" }));
    expect(onRetry).toHaveBeenLastCalledWith({ context: "general" });
  });

  it("seeds module adjustments when loading transitions to a structured result", () => {
    const props = {
      currentPrompt: "original prompt",
      onApply: vi.fn(),
      onDiscard: vi.fn(),
      onRetry: vi.fn(),
    };
    const { rerender } = render(
      <PromptOptimizationDialog state={{ status: "loading", originalPrompt: "original prompt" }} {...props} />,
    );
    rerender(<PromptOptimizationDialog state={structuredState} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "调整并重试" }));
    expect(screen.getByLabelText("生成目标")).toBeChecked();
    expect(screen.getByLabelText("主体与内容")).toBeChecked();
    expect(screen.getByLabelText("构图与组织")).toBeChecked();
  });

  it("can correct an automatic general fallback into an image-generation request", () => {
    const onRetry = vi.fn();
    const generalFallback = {
      ...structuredState,
      structure: {
        ...structuredState.structure,
        format: "plain_fallback" as const,
        context: "general" as const,
        artifactLabel: null,
        intents: { purposes: [], media: [], subjects: [] },
        selectedModules: ["general" as const],
        sections: [{ module: "general" as const, heading: "优化结果", content: "通用优化文本" }],
      },
    };
    render(
      <PromptOptimizationDialog
        state={generalFallback}
        currentPrompt="original prompt"
        onApply={vi.fn()}
        onDiscard={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("heading", { name: "兼容模式（结构识别不可用）" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "调整并重试" }));
    expect(screen.getByRole("button", { name: "按所选模块重新优化" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("主体与内容"));
    fireEvent.click(screen.getByLabelText("构图与组织"));
    fireEvent.click(screen.getByRole("button", { name: "按所选模块重新优化" }));
    expect(onRetry).toHaveBeenCalledWith({
      context: "image_generation",
      requestedModules: ["content", "organization"],
    });
  });

  it("requires explicit review before applying a result with blocking warnings", async () => {
    const onApply = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const state = {
      ...structuredState,
      structure: {
        ...structuredState.structure,
        lockedFacts: [{ kind: "quoted_text" as const, value: "NEW FORMULA", preserved: false }],
        warnings: [{
          code: "missing_locked_literal",
          severity: "error" as const,
          blocking: true,
          message: "优化结果遗漏了必须逐字保留的内容：NEW FORMULA",
        }],
      },
    };
    render(
      <PromptOptimizationDialog
        state={state}
        currentPrompt="original prompt"
        onApply={onApply}
        onDiscard={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const apply = screen.getByRole("button", { name: "使用优化结果" });
    expect(apply).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("NEW FORMULA");
    fireEvent.click(screen.getByRole("button", { name: "复制优化结果" }));
    expect(writeText).toHaveBeenCalledWith("professional optimized prompt");
    fireEvent.click(screen.getByLabelText("我已核对以上风险，仍要使用此优化结果"));
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith("professional optimized prompt");
  });

  it("clears a blocking-warning confirmation before every retry and for the next result", () => {
    const onRetry = vi.fn();
    const blockingState = {
      ...structuredState,
      structure: {
        ...structuredState.structure,
        warnings: [{
          code: "missing_locked_literal",
          severity: "error" as const,
          blocking: true,
          message: "A protected literal is missing.",
        }],
      },
    };
    const props = {
      currentPrompt: "original prompt",
      onApply: vi.fn(),
      onDiscard: vi.fn(),
      onRetry,
    };
    const { rerender } = render(<PromptOptimizationDialog state={blockingState} {...props} />);
    const confirmation = screen.getByLabelText("我已核对以上风险，仍要使用此优化结果");
    fireEvent.click(confirmation);
    expect(screen.getByRole("button", { name: "使用优化结果" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "调整并重试" }));
    fireEvent.click(screen.getByRole("button", { name: "按所选模块重新优化" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "使用优化结果" })).toBeDisabled();

    rerender(<PromptOptimizationDialog state={{ status: "loading", originalPrompt: "original prompt" }} {...props} />);
    rerender(<PromptOptimizationDialog state={{ ...blockingState, optimizedPrompt: "second result" }} {...props} />);
    expect(screen.getByLabelText("我已核对以上风险，仍要使用此优化结果")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "使用优化结果" })).toBeDisabled();
  });
});
