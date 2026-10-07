"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { NoteImage } from "@/components/notes/types";
import {
  MAX_REVERSE_REQUIREMENTS,
  MAX_REVERSE_PROMPT,
  REVERSE_CATEGORY_LABELS,
  REVERSE_SECTION_LABELS,
  renderReversePrompt,
  type ReversePromptDocument,
  type ReversePromptResult,
} from "@/modules/ai/reverse-prompt-contract";
import { AppDialog } from "./app-dialog";

export type ReversePromptSource =
  File | { imageUrl: string; noteImage?: NoteImage };
export type ReversePromptValue = { prompt: string; negativePrompt: string };
type Props = {
  initialSource?: ReversePromptSource;
  onUse?: (value: ReversePromptValue) => void;
  onAnalyzeTerms?: (prompt: string) => void;
  onSavingChange?: (saving: boolean) => void;
};

function apiError(body: unknown, fallback: string) {
  if (
    !body ||
    typeof body !== "object" ||
    !("error" in body) ||
    !body.error ||
    typeof body.error !== "object"
  )
    return { message: fallback, code: "" };
  const error = body.error as {
    message?: string;
    code?: string;
    requestId?: string;
  };
  return {
    message:
      typeof error.message === "string"
        ? `${error.message}${error.code === "INTERNAL_ERROR" && error.requestId ? `（编号：${error.requestId}）` : ""}`
        : fallback,
    code: error.code ?? "",
  };
}
const stages = [
  "正在识别图片主体与画面类型…",
  "正在分析构图、光线和细节…",
  "正在应用额外要求并组织提示词…",
];

function SourcePreview({ source }: { source: ReversePromptSource }) {
  const ref = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image || !(source instanceof File)) return;
      const url = URL.createObjectURL(source);
      image.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [source],
  );
  return (
    <img
      ref={ref}
      className="reverse-preview"
      src={source instanceof File ? undefined : source.imageUrl}
      alt="待反推的图片"
      referrerPolicy="no-referrer"
    />
  );
}

export function ReversePromptWorkbench({
  initialSource,
  onUse,
  onAnalyzeTerms,
  onSavingChange,
}: Props) {
  const id = useId();
  const [source, setSource] = useState<ReversePromptSource | null>(
    initialSource ?? null,
  );
  const [mode, setMode] = useState<"file" | "url">(
    initialSource && !(initialSource instanceof File) ? "url" : "file",
  );
  const [url, setUrl] = useState(
    initialSource && !(initialSource instanceof File)
      ? initialSource.imageUrl
      : "",
  );
  const [requirements, setRequirements] = useState("");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [result, setResult] = useState<ReversePromptResult | null>(null);
  const [document, setDocument] = useState<ReversePromptDocument | null>(null);
  const [view, setView] = useState<"prompt" | "sections" | "json">("prompt");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [title, setTitle] = useState("");
  const [includeImage, setIncludeImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [savedId, setSavedId] = useState("");
  const [snapshot, setSnapshot] = useState<{
    source: ReversePromptSource;
    requirements: string;
    language: string;
  } | null>(null);
  const [manualPrompt, setManualPrompt] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const action = useRef(false);
  const saveRequest = useRef<{ fingerprint: string; key: string } | null>(null);
  const storedSource = useRef<NoteImage | null>(null);
  const current = Boolean(
    result &&
    snapshot?.source === source &&
    snapshot.requirements === requirements &&
    snapshot.language === language,
  );

  useEffect(
    () => () => {
      sequence.current += 1;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(
      () => setStage((value) => (value + 1) % stages.length),
      1_800,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  function chooseFile(file: File) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size === 0 ||
      file.size > 10 * 1024 * 1024
    ) {
      setError("请选择不超过 10MB 的 JPEG、PNG 或 WebP 图片。");
      return;
    }
    cancel(false);
    storedSource.current = null;
    setMode("file");
    setSource(file);
    setError("");
    setSavedId("");
  }
  function cancel(notify = true) {
    sequence.current += 1;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    if (notify) setMessage("已取消反推，图片与额外要求仍然保留。");
  }
  async function analyze() {
    if (!source || busy || controller.current) return;
    const activeSource = source;
    if (!(activeSource instanceof File)) {
      try {
        if (new URL(activeSource.imageUrl).protocol !== "https:")
          throw new Error();
      } catch {
        setError("请粘贴有效的 HTTPS 图片直链。");
        return;
      }
    }
    const attempt = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setStage(0);
    setError("");
    setErrorCode("");
    setMessage("");
    try {
      let body: BodyInit;
      let headers: HeadersInit | undefined;
      if (activeSource instanceof File) {
        const form = new FormData();
        form.set("image", activeSource);
        form.set("additionalRequirements", requirements);
        form.set("language", language);
        body = form;
      } else {
        body = JSON.stringify({
          imageUrl: activeSource.imageUrl,
          additionalRequirements: requirements,
          language,
        });
        headers = { "content-type": "application/json" };
      }
      const response = await fetch("/api/v1/ai/reverse-prompt", {
        method: "POST",
        headers,
        body,
        signal: abort.signal,
      });
      const payload = await response.json().catch(() => null);
      if (attempt !== sequence.current || abort.signal.aborted) return;
      if (!response.ok) {
        const failure = apiError(payload, "图片反推失败，请重试。");
        setError(failure.message);
        setErrorCode(response.status === 401 ? "AUTH_REQUIRED" : failure.code);
        return;
      }
      const next = payload?.data as ReversePromptResult;
      if (
        !next?.structure?.sections?.length ||
        typeof next.prompt !== "string" ||
        typeof next.negativePrompt !== "string"
      ) {
        setError("图片反推结果不完整，请重试。");
        return;
      }
      setResult(next);
      setDocument(next.structure);
      setPrompt(next.prompt);
      setNegativePrompt(next.negativePrompt);
      setSnapshot({ source: activeSource, requirements, language });
      setManualPrompt(false);
      setSavedId("");
      saveRequest.current = null;
      setTitle(
        `${next.structure.categories.map((category) => REVERSE_CATEGORY_LABELS[category]).join(" · ")}反推提示词`,
      );
      setMessage("反推完成。请核对图片观察、修改摘要和推测内容，再使用结果。");
    } catch {
      if (!abort.signal.aborted && attempt === sequence.current)
        setError("无法连接图片反推服务，请重试。");
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function editSection(index: number, content: string) {
    if (!document) return;
    const next = {
      ...document,
      sections: document.sections.map((section, i) =>
        i === index ? { ...section, content } : section,
      ),
    };
    const rendered = renderReversePrompt(next);
    if (rendered.length > MAX_REVERSE_PROMPT) {
      setError("最终提示词不能超过 50,000 字。");
      return;
    }
    setDocument(next);
    setPrompt(rendered);
    setManualPrompt(false);
    setSavedId("");
  }
  async function copy(json = false) {
    try {
      await navigator.clipboard.writeText(
        json
          ? JSON.stringify(
              {
                ...document,
                negativePrompt,
                prompt,
                manuallyEdited: manualPrompt,
              },
              null,
              2,
            )
          : `${prompt}${negativePrompt ? `\n\n【负面提示词】\n${negativePrompt}` : ""}`,
      );
      setMessage(json ? "JSON 已复制。" : "提示词与负面提示词已复制。");
    } catch {
      setError("复制失败，可以在文本框中选择并复制内容。");
    }
  }
  async function saveNote() {
    if (action.current || savedId || !current || !prompt.trim()) return;
    action.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setError("");
    setMessage("正在保存提示词笔记…");
    try {
      let image = includeImage ? storedSource.current : null;
      if (includeImage && !image && source) {
        if (!(source instanceof File) && source.noteImage)
          image = source.noteImage;
        else {
          const form = new FormData();
          if (source instanceof File) form.set("file", source);
          const body =
            source instanceof File
              ? form
              : JSON.stringify({ url: source.imageUrl });
          const response = await fetch("/api/v1/uploads", {
            method: "POST",
            body,
            signal: AbortSignal.timeout(120_000),
            ...(source instanceof File
              ? {}
              : { headers: { "content-type": "application/json" } }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok)
            throw new Error(
              apiError(
                payload,
                "原图保存失败；请配置图床，或取消保存封面后重试。",
              ).message,
            );
          image = payload.data as NoteImage;
        }
        storedSource.current = image;
      }
      const body = JSON.stringify({
        title: title.trim() || "图片反推提示词",
        prompt,
        negativePrompt,
        tags: [],
        images: image ? [image] : [],
        parameters: {
          reversePrompt: {
            ...document,
            negativePrompt,
            prompt,
            manuallyEdited: manualPrompt,
          },
        },
      });
      if (saveRequest.current?.fingerprint !== body)
        saveRequest.current = {
          fingerprint: body,
          key: `reverse-note:${crypto.randomUUID()}`,
        };
      const response = await fetch("/api/v1/notes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": saveRequest.current.key,
        },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(apiError(payload, "保存笔记失败，请重试。").message);
      setSavedId(payload.data.id);
      setMessage("提示词笔记已保存。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请重试。");
    } finally {
      action.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  }
  function transfer(destination: "use" | "analyze") {
    try {
      if (destination === "use") onUse?.({ prompt, negativePrompt });
      else onAnalyzeTerms?.(prompt);
    } catch {
      setError("暂时无法转交结果，请复制提示词后手动粘贴到目标页面。");
    }
  }
  const usable =
    current &&
    !busy &&
    !saving &&
    Boolean(prompt.trim()) &&
    prompt.length <= MAX_REVERSE_PROMPT;
  return (
    <section className="reverse-workbench" aria-labelledby={`${id}-heading`}>
      <header>
        <span className="section-kicker">IMAGE → PROMPT</span>
        <h3 id={`${id}-heading`}>图片反推提示词</h3>
        <p>
          观察图片、重建生成提示词；填写额外要求即可改写颜色、服饰、场景等细节。结果需要你核对。
        </p>
      </header>
      <div className="reverse-input-grid">
        <div
          className="reverse-source"
          onPaste={(event) => {
            const file = Array.from(event.clipboardData.files).find((item) =>
              item.type.startsWith("image/"),
            );
            if (file && !busy && !saving) {
              event.preventDefault();
              chooseFile(file);
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!busy && !saving && event.dataTransfer.files[0])
              chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <div className="reverse-source-modes">
            <button
              aria-pressed={mode === "file"}
              disabled={busy || saving}
              type="button"
              onClick={() => {
                if (mode !== "file") {
                  storedSource.current = null;
                  setSource(null);
                  setMode("file");
                }
              }}
            >
              上传／粘贴图片
            </button>
            <button
              aria-pressed={mode === "url"}
              disabled={busy || saving}
              type="button"
              onClick={() => {
                if (mode !== "url") {
                  storedSource.current = null;
                  setSource(url.trim() ? { imageUrl: url.trim() } : null);
                  setMode("url");
                }
              }}
            >
              图片链接
            </button>
          </div>
          {mode === "file" ? (
            <label className="reverse-upload" tabIndex={0}>
              选择反推图片
              <input
                aria-label="选择反推图片"
                disabled={busy || saving}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  if (event.target.files?.[0])
                    chooseFile(event.target.files[0]);
                  event.target.value = "";
                }}
              />
              <small>也可拖入图片或在此按 Ctrl / ⌘ + V · 最大 10MB</small>
            </label>
          ) : (
            <label>
              图片直链
              <input
                disabled={busy || saving}
                aria-label="反推图片链接"
                type="url"
                value={url}
                maxLength={4_000}
                placeholder="https://…/image.png"
                onChange={(event) => {
                  setUrl(event.target.value);
                  setSource(
                    event.target.value.trim()
                      ? { imageUrl: event.target.value.trim() }
                      : null,
                  );
                  storedSource.current = null;
                }}
              />
              <small>
                使用 HTTPS 图片直链；网页链接请先通过图片解析器导入。
              </small>
            </label>
          )}
          {source ? (
            <SourcePreview source={source} />
          ) : (
            <div className="reverse-placeholder">选择图片后在这里预览</div>
          )}
        </div>
        <div className="reverse-requirements">
          <label>
            额外要求（可选）
            <textarea
              disabled={busy || saving}
              value={requirements}
              maxLength={MAX_REVERSE_REQUIREMENTS}
              onChange={(event) => setRequirements(event.target.value)}
              placeholder="例如：把白色衬衫改成蓝色，保留原图人物、姿势和构图。"
            />
          </label>
          <small>
            {requirements.length} / {MAX_REVERSE_REQUIREMENTS} ·
            用户要求优先于对应的原图细节
          </small>
          <label>
            输出语言
            <select
              disabled={busy || saving}
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as "zh" | "en")
              }
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <div className="reverse-actions">
            <button
              className="primary-action"
              type="button"
              disabled={!source || busy || saving}
              aria-busy={busy}
              onClick={() => void analyze()}
            >
              {busy ? "正在反推…" : result ? "重新反推" : "AI 一键反推"}
            </button>
            {busy ? (
              <button type="button" onClick={() => cancel()}>
                取消反推
              </button>
            ) : null}
          </div>
          {busy ? (
            <p className="reverse-progress" role="status">
              <span className="button-spinner" aria-hidden="true" />
              {stages[stage]}
            </p>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="reverse-notice reverse-notice--error" role="alert">
          {error}
          {errorCode === "AUTH_REQUIRED" ? (
            <Link
              href={`/sign-in?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}
            >
              登录后使用
            </Link>
          ) : [
              "AI_REVERSE_PROMPT_NOT_CONFIGURED",
              "AI_MODEL_CAPABILITY_MISMATCH",
              "AI_PROVIDER_AUTH_FAILED",
            ].includes(errorCode) ? (
            <Link href="/settings/ai">配置图片反推模型</Link>
          ) : null}
        </p>
      ) : null}
      {message ? (
        <p className="reverse-notice" role="status">
          {message}
        </p>
      ) : null}
      {result && document ? (
        <div className="reverse-result">
          <header>
            <div>
              <h4>反推结果</h4>
              <small>
                由 {result.model.name} 分析 ·{" "}
                {document.categories
                  .map((category) => REVERSE_CATEGORY_LABELS[category])
                  .join(" / ")}
              </small>
            </div>
            <span>建议结果，请人工核对</span>
          </header>
          {!current ? (
            <p className="reverse-notice reverse-notice--error" role="alert">
              图片或要求已改变。请重新反推，当前结果暂不能使用或保存。
            </p>
          ) : null}
          {document.changes.length ? (
            <div className="reverse-change-summary">
              <strong>按你的要求修改</strong>
              <p>以下为 AI 的修改摘要；手动编辑后，以当前提示词为准。</p>
              <ul>
                {document.changes.map((change, index) => (
                  <li key={index}>
                    {REVERSE_SECTION_LABELS[change.section].zh}：
                    {change.from || "新增"} → {change.to}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {document.uncertainties.length ? (
            <div className="reverse-change-summary">
              <strong>需要核对的推测与不确定内容</strong>
              <ul>
                {document.uncertainties.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div
            className="reverse-view-tabs"
            role="tablist"
            aria-label="反推结果视图"
          >
            {(
              [
                { id: "prompt", label: "可用提示词" },
                { id: "sections", label: "分模块编辑" },
                { id: "json", label: "JSON" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${id}-${tab.id}-tab`}
                aria-controls={`${id}-${tab.id}-panel`}
                aria-selected={view === tab.id}
                onClick={() => setView(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${id}-prompt-panel`}
            aria-labelledby={`${id}-prompt-tab`}
            hidden={view !== "prompt"}
          >
            <label>
              反推提示词
              <textarea
                aria-label="反推提示词"
                disabled={saving || Boolean(savedId)}
                maxLength={MAX_REVERSE_PROMPT}
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setManualPrompt(true);
                }}
              />
            </label>
          </div>
          <div
            role="tabpanel"
            id={`${id}-sections-panel`}
            aria-labelledby={`${id}-sections-tab`}
            hidden={view !== "sections"}
          >
            {manualPrompt ? (
              <p className="reverse-notice">
                你已直接编辑完整提示词。修改模块会重新编排全文；原文需先复制保留。
              </p>
            ) : null}
            {document.sections.map((section, index) => (
              <div className="reverse-section" key={section.id}>
                <label>
                  {REVERSE_SECTION_LABELS[section.id].zh}
                  <small>
                    {section.basis === "requested"
                      ? "按额外要求改写"
                      : section.basis === "inferred"
                        ? "推测／生成建议"
                        : "基于图片观察"}
                  </small>
                  <textarea
                    aria-label={REVERSE_SECTION_LABELS[section.id].zh}
                    disabled={saving || Boolean(savedId) || manualPrompt}
                    maxLength={6_000}
                    value={section.content}
                    onChange={(event) => editSection(index, event.target.value)}
                  />
                </label>
                <details>
                  <summary>原图观察</summary>
                  <p>{section.observed || "图片没有可直接确认的对应信息。"}</p>
                </details>
              </div>
            ))}
            {manualPrompt ? (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "重新从模块编排将覆盖你对完整提示词的手动编辑，是否继续？",
                    )
                  ) {
                    setPrompt(renderReversePrompt(document));
                    setManualPrompt(false);
                  }
                }}
              >
                确认后重新从模块编排
              </button>
            ) : null}
          </div>
          <div
            role="tabpanel"
            id={`${id}-json-panel`}
            aria-labelledby={`${id}-json-tab`}
            hidden={view !== "json"}
          >
            <pre>
              {JSON.stringify(
                {
                  ...document,
                  negativePrompt,
                  prompt,
                  manuallyEdited: manualPrompt,
                },
                null,
                2,
              )}
            </pre>
            <button
              disabled={!usable}
              type="button"
              onClick={() => void copy(true)}
            >
              复制 JSON
            </button>
          </div>
          <label>
            反推负面提示词
            <textarea
              aria-label="反推负面提示词"
              disabled={saving || Boolean(savedId)}
              maxLength={8_000}
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
            />
            <small>这是建议的生成约束，不是原图事实。</small>
          </label>
          <div className="reverse-actions">
            {onUse ? (
              <button
                className="primary-action"
                disabled={!usable}
                type="button"
                onClick={() => transfer("use")}
              >
                使用这个 Prompt
              </button>
            ) : null}
            <button
              disabled={!usable}
              type="button"
              onClick={() => void copy()}
            >
              复制提示词
            </button>
            {onAnalyzeTerms ? (
              <button
                disabled={!usable || prompt.trim().length < 10}
                type="button"
                onClick={() => transfer("analyze")}
              >
                送到百科分析
              </button>
            ) : null}
          </div>
          <div className="reverse-save">
            <label>
              笔记标题
              <input
                disabled={saving || Boolean(savedId)}
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="reverse-checkbox">
              <input
                type="checkbox"
                checked={includeImage}
                disabled={saving || Boolean(savedId)}
                onChange={(event) => setIncludeImage(event.target.checked)}
              />
              同时保存原图作为封面（使用已配置图床）
            </label>
            <button
              disabled={!usable || Boolean(savedId)}
              aria-busy={saving}
              type="button"
              onClick={() => void saveNote()}
            >
              {saving
                ? "保存中…"
                : savedId
                  ? "已保存为笔记"
                  : "保存为提示词笔记"}
            </button>
            {savedId ? (
              <Link href={`/notes/${savedId}/edit`}>查看并编辑笔记 →</Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ReversePromptDialog({
  onClose,
  ...props
}: Props & { onClose: () => void }) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  return (
    <AppDialog
      labelledBy={`${id}-title`}
      className="reverse-dialog"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="reverse-dialog__panel">
        <header>
          <h2 id={`${id}-title`}>图片反推</h2>
          <button
            disabled={saving}
            type="button"
            aria-label="关闭图片反推"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="reverse-dialog__body">
          <ReversePromptWorkbench {...props} onSavingChange={setSaving} />
        </div>
      </div>
    </AppDialog>
  );
}
