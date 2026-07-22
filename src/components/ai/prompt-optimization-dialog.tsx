"use client";

import { useEffect, useRef, useState } from "react";

export type PromptOptimizationState =
  | { status: "loading"; originalPrompt: string }
  | { status: "error"; originalPrompt: string; message: string }
  | {
    status: "ready";
    originalPrompt: string;
    optimizedPrompt: string;
    modelName: string;
  };

interface PromptOptimizationDialogProps {
  state: PromptOptimizationState;
  currentPrompt: string;
  onApply: (optimizedPrompt: string) => void;
  onDiscard: () => void;
  onRetry: () => void;
}

export function PromptOptimizationDialog({
  state,
  currentPrompt,
  onApply,
  onDiscard,
  onRetry,
}: PromptOptimizationDialogProps) {
  const panelRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef(onDiscard);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const stale = state.status === "ready" && currentPrompt !== state.originalPrompt;

  useEffect(() => {
    discardRef.current = onDiscard;
  }, [onDiscard]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") discardRef.current();
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keyDown);
      previouslyFocused?.focus();
    };
  }, []);

  async function copyResult() {
    if (state.status !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.optimizedPrompt);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="optimization-dialog" role="presentation">
      <section
        aria-describedby="optimization-description"
        aria-labelledby="optimization-title"
        aria-modal="true"
        className="optimization-dialog__panel"
        ref={panelRef}
        role="dialog"
      >
        <header className="optimization-dialog__header">
          <div>
            <span className="section-kicker">AI PROMPT EDITOR</span>
            <h2 id="optimization-title">提示词优化</h2>
            <p id="optimization-description">AI 只提供建议；确认前不会修改编辑器中的原文。</p>
          </div>
          <button ref={cancelRef} type="button" onClick={onDiscard} aria-label="关闭优化对话框">×</button>
        </header>

        {state.status === "loading" ? (
          <div className="optimization-dialog__loading" role="status" aria-live="polite">
            <span aria-hidden="true" className="optimization-dialog__spinner" />
            <div><strong>AI 正在优化提示词…</strong><p>正在补充结构、约束与专业表达，请稍候。</p></div>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="optimization-dialog__error" role="alert">
            <strong>这次没有优化成功</strong>
            <p>{state.message}</p>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <>
            <div className="optimization-dialog__meta">使用模型：<strong>{state.modelName}</strong></div>
            {stale ? <p className="optimization-dialog__stale" role="alert">原提示词已经发生变化。为避免覆盖你的新编辑，请放弃本结果后重新优化。</p> : null}
            <div className="optimization-dialog__comparison">
              <section aria-labelledby="optimization-original-title">
                <h3 id="optimization-original-title">原提示词</h3>
                <pre>{state.originalPrompt}</pre>
              </section>
              <section aria-labelledby="optimization-result-title">
                <h3 id="optimization-result-title">AI 优化结果</h3>
                <pre>{state.optimizedPrompt}</pre>
              </section>
            </div>
          </>
        ) : null}

        <footer className="optimization-dialog__actions">
          {copyState === "error" ? <span role="alert">复制失败，请重试</span> : null}
          {state.status === "error" ? <button type="button" onClick={onRetry}>重新尝试</button> : null}
          {state.status === "ready" ? <button type="button" onClick={() => void copyResult()}>{copyState === "copied" ? "已复制" : "复制优化结果"}</button> : null}
          <button type="button" onClick={onDiscard}>{state.status === "loading" ? "取消优化" : state.status === "ready" ? "放弃优化结果" : "关闭"}</button>
          {state.status === "ready" ? (
            <button className="primary-action" disabled={stale} type="button" onClick={() => !stale && onApply(state.optimizedPrompt)}>使用优化结果</button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
