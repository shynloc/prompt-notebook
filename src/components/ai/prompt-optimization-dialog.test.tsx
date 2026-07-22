import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PromptOptimizationDialog } from "./prompt-optimization-dialog";

const readyState = {
  status: "ready" as const,
  originalPrompt: "original prompt",
  optimizedPrompt: "professional optimized prompt",
  modelName: "Writer Model",
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
});
