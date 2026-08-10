"use client";

import { useEffect, useRef, useState } from "react";

import {
  PROMPT_MODULE_REGISTRY,
  PROMPT_MODULES,
  type PromptModuleId,
  type PromptOptimizationContext,
  type PromptOptimizationStructure,
} from "@/modules/ai/prompt-structure-contract";

export interface PromptOptimizationRetryOptions {
  context?: PromptOptimizationContext;
  requestedModules?: PromptModuleId[];
}

const moduleOptions = PROMPT_MODULES.filter((moduleId) => moduleId !== "general");

const intentLabels: Record<string, string> = {
  promotional: "宣传推广",
  informational: "信息传达",
  editorial: "编辑出版",
  narrative: "叙事",
  documentary: "纪实",
  decorative: "装饰",
  conceptual: "概念表达",
  instructional: "教学说明",
  photography: "摄影",
  graphic_design: "平面设计",
  illustration: "插画",
  three_dimensional: "3D",
  diagram: "图解",
  mixed_media: "混合媒介",
  unspecified: "媒介未指定",
  people: "人物",
  product: "产品",
  environment: "环境",
  architecture: "建筑",
  object: "物件",
  food: "食物",
  animal: "动物",
  typography: "文字排版",
  data: "数据",
  sequence: "连续画面",
  abstract: "抽象主体",
  other: "其他",
};

function moduleLabel(moduleId: PromptModuleId) {
  return PROMPT_MODULE_REGISTRY[moduleId].label.zh;
}

export type PromptOptimizationState =
  | { status: "loading"; originalPrompt: string }
  | { status: "error"; originalPrompt: string; message: string }
  | {
    status: "ready";
    originalPrompt: string;
    optimizedPrompt: string;
    modelName: string;
    structure?: PromptOptimizationStructure;
  };

interface PromptOptimizationDialogProps {
  state: PromptOptimizationState;
  currentPrompt: string;
  onApply: (optimizedPrompt: string) => void;
  onDiscard: () => void;
  onRetry: (options?: PromptOptimizationRetryOptions) => void;
}

export function PromptOptimizationDialog({
  state,
  ...props
}: PromptOptimizationDialogProps) {
  return <PromptOptimizationDialogContent key={state.status} state={state} {...props} />;
}

function PromptOptimizationDialogContent({
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
  const [adjusting, setAdjusting] = useState(false);
  const structureModules = () => {
    if (state.status !== "ready" || !state.structure) return [];
    const modules = state.structure.requestedModules.length
      ? state.structure.requestedModules
      : state.structure.selectedModules;
    return modules.filter((moduleId) => moduleId !== "general");
  };
  const [requestedModules, setRequestedModules] = useState<PromptModuleId[]>(structureModules);
  const [blockingWarningsReviewed, setBlockingWarningsReviewed] = useState(false);
  const stale = state.status === "ready" && currentPrompt !== state.originalPrompt;
  const structure = state.status === "ready" ? state.structure : undefined;
  const hasBlockingWarnings = structure?.warnings.some((warning) => warning.blocking) ?? false;
  const applyBlocked = stale || (hasBlockingWarnings && !blockingWarningsReviewed);
  const intentTags = structure ? [
    ...structure.intents.purposes.map((value) => ({ key: `purpose:${value}`, value })),
    ...structure.intents.subjects.map((value) => ({ key: `subject:${value}`, value })),
    ...structure.intents.media.map((value) => ({ key: `media:${value}`, value })),
  ] : [];

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

  function toggleModule(moduleId: PromptModuleId) {
    setRequestedModules((current) => current.includes(moduleId)
      ? current.filter((candidate) => candidate !== moduleId)
      : [...current, moduleId]);
  }

  function retryWithModules() {
    if (!requestedModules.length) return;
    triggerRetry({
      context: "image_generation",
      requestedModules,
    });
  }

  function toggleAdjustment() {
    if (!adjusting && !requestedModules.length) setRequestedModules(structureModules());
    setAdjusting((value) => !value);
  }

  function triggerRetry(options?: PromptOptimizationRetryOptions) {
    setBlockingWarningsReviewed(false);
    setCopyState("idle");
    setAdjusting(false);
    setRequestedModules([]);
    onRetry(options);
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
            {structure ? (
              <section className="optimization-dialog__structure" aria-labelledby="optimization-structure-title">
                <header>
                  <div>
                    <span className="section-kicker">AI RECOGNITION</span>
                    <h3 id="optimization-structure-title">{structure.format === "plain_fallback"
                      ? "兼容模式（结构识别不可用）"
                      : `识别为：${structure.artifactLabel ?? "图像生成提示词"}`}</h3>
                  </div>
                  <button type="button" onClick={toggleAdjustment} aria-expanded={adjusting}>{adjusting ? "收起调整" : "调整并重试"}</button>
                </header>

                {intentTags.length ? <div className="optimization-dialog__labels" aria-label="识别标签">{intentTags.map((tag) => <span key={tag.key}>{intentLabels[tag.value] ?? tag.value}</span>)}</div> : null}

                <div className="optimization-dialog__modules" aria-label="本次优化模块">
                  <strong>本次重点</strong>
                  <div>{structure.selectedModules.map((moduleId) => <span key={moduleId}>{moduleLabel(moduleId)}</span>)}</div>
                </div>

                {structure.warnings.length ? <div className="optimization-dialog__warnings" aria-label="优化检查结果">{structure.warnings.map((warning, index) => (
                  <p className={`optimization-dialog__warning optimization-dialog__warning--${warning.blocking ? "blocking" : warning.severity}`} key={`${warning.code}-${index}`} role={warning.blocking ? "alert" : "status"}>
                    <strong>{warning.blocking ? "应用前必须核对" : warning.severity === "warning" || warning.severity === "error" ? "请注意" : "提示"}</strong>
                    <span>{warning.message}</span>
                  </p>
                ))}</div> : null}

                {hasBlockingWarnings ? <label className="optimization-dialog__review-confirmation"><input type="checkbox" checked={blockingWarningsReviewed} onChange={(event) => setBlockingWarningsReviewed(event.target.checked)} /><span>我已核对以上风险，仍要使用此优化结果</span></label> : null}

                {adjusting ? <div className="optimization-dialog__adjustment">
                  <fieldset>
                    <legend>选择重新优化时必须包含的模块</legend>
                    <p>只在自动识别不准确时调整；未选择的模块仍可能在必要时被 AI 使用。</p>
                    <div>{moduleOptions.map((moduleId) => <label key={moduleId}><input type="checkbox" checked={requestedModules.includes(moduleId)} onChange={() => toggleModule(moduleId)} /><span><strong>{moduleLabel(moduleId)}</strong></span></label>)}</div>
                  </fieldset>
                  <div className="optimization-dialog__adjustment-actions">
                    <button type="button" disabled={!requestedModules.length} onClick={retryWithModules}>按所选模块重新优化</button>
                    <button type="button" onClick={() => triggerRetry({ context: "general" })}>作为通用提示词重新优化</button>
                  </div>
                </div> : null}

                {structure.lockedFacts.length ? <details className="optimization-dialog__facts"><summary>查看事实锁定（{structure.lockedFacts.length} 项）</summary><ul>{structure.lockedFacts.map((fact, index) => <li key={`${fact.kind}-${fact.value}-${index}`} data-preserved={fact.preserved}><span>{fact.value}</span><strong>{fact.preserved ? "已保留" : "缺失"}</strong></li>)}</ul></details> : null}

                {structure.sections.length ? <details className="optimization-dialog__sections"><summary>查看结构视图（{structure.sections.length} 个模块）</summary><div>{structure.sections.map((section, index) => <section key={`${section.module}-${index}`}><h4>{section.heading || moduleLabel(section.module)}</h4><pre>{section.content}</pre></section>)}</div></details> : null}
              </section>
            ) : null}
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
          {state.status === "error" ? <button type="button" onClick={() => triggerRetry()}>重新尝试</button> : null}
          {state.status === "ready" ? <button type="button" onClick={() => void copyResult()}>{copyState === "copied" ? "已复制" : "复制优化结果"}</button> : null}
          <button type="button" onClick={onDiscard}>{state.status === "loading" ? "取消优化" : state.status === "ready" ? "放弃优化结果" : "关闭"}</button>
          {state.status === "ready" ? (
            <button aria-describedby={hasBlockingWarnings && !blockingWarningsReviewed ? "optimization-apply-blocked" : undefined} className="primary-action" disabled={applyBlocked} type="button" onClick={() => !applyBlocked && onApply(state.optimizedPrompt)}>使用优化结果</button>
          ) : null}
        </footer>
        {state.status === "ready" && hasBlockingWarnings && !blockingWarningsReviewed ? <p className="sr-only" id="optimization-apply-blocked">请先勾选确认已核对阻断风险。</p> : null}
      </section>
    </div>
  );
}
