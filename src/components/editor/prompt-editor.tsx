"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import {
  PromptOptimizationDialog,
  type PromptOptimizationState,
} from "@/components/ai/prompt-optimization-dialog";
import { ImagePicker } from "@/components/media/image-picker";
import type { NoteImage, NoteView } from "@/components/notes/types";
import { TemplatePicker } from "@/components/productivity/template-picker";
import { TermLibrary } from "@/components/terms/term-library";
import { useSession } from "@/lib/auth/client";
import {
  isRecoverableDraft,
  readPromptDraft,
  removePromptDraft,
  writePromptDraft,
  type PromptDraftPayload,
  type StoredPromptDraft,
} from "@/modules/sync/local-drafts";

interface TagOption { id: string; name: string; count: number }

function apiMessage(body: unknown, fallback: string) {
  if (typeof body !== "object" || body === null || !("error" in body)) return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || !("message" in error)) return fallback;
  const { code, message, requestId } = error as { code?: unknown; message?: unknown; requestId?: unknown };
  if (typeof message !== "string") return fallback;
  return code === "INTERNAL_ERROR" && typeof requestId === "string"
    ? `${message}（错误编号：${requestId}）`
    : message;
}

export function PromptEditor({ initial, seed }: { initial?: NoteView; seed?: NoteView }) {
  const router = useRouter();
  const { data: session } = useSession();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const draftWriteRef = useRef<Promise<void> | null>(null);
  const optimizationControllerRef = useRef<AbortController | null>(null);
  const optimizationSequenceRef = useRef(0);
  const [title, setTitle] = useState(initial?.title ?? seed?.title ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? seed?.prompt ?? "");
  const [negativePrompt, setNegativePrompt] = useState(initial?.negativePrompt ?? seed?.negativePrompt ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? seed?.sourceUrl ?? "");
  const [sourceTitle, setSourceTitle] = useState(initial?.sourceTitle ?? seed?.sourceTitle ?? "");
  const [tags, setTags] = useState(initial?.tags.map((tag) => tag.name) ?? seed?.tags.map((tag) => tag.name) ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [images, setImages] = useState<NoteImage[]>(initial?.images ?? seed?.images ?? []);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [draftChecked, setDraftChecked] = useState(false);
  const [recoveredDraft, setRecoveredDraft] = useState<StoredPromptDraft | null>(null);
  const [localState, setLocalState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [optimization, setOptimization] = useState<PromptOptimizationState | null>(null);
  const [optimizationUndo, setOptimizationUndo] = useState<{ before: string; after: string } | null>(null);
  const draftKey = session?.user.id ? `${session.user.id}:${initial?.id ?? "new"}` : null;
  const draftPayload = useMemo<PromptDraftPayload>(
    () => ({ title, prompt, negativePrompt, sourceUrl, sourceTitle, tags, images }),
    [images, negativePrompt, prompt, sourceTitle, sourceUrl, tags, title],
  );

  useEffect(() => { void fetch("/api/v1/tags").then((response) => response.ok ? response.json() : null).then((body) => body && setTagOptions(body.data)); }, []);
  useEffect(() => {
    if (!draftKey) return;
    let active = true;
    void readPromptDraft(draftKey).then((draft) => {
      if (!active) return;
      if (draft && isRecoverableDraft(draft, initial?.updatedAt)) setRecoveredDraft(draft);
      else if (draft) void removePromptDraft(draftKey);
      setDraftChecked(true);
    }).catch(() => { if (active) { setDraftChecked(true); setLocalState("error"); } });
    return () => { active = false; };
  }, [draftKey, initial?.updatedAt]);
  useEffect(() => {
    if (!draftKey || !draftChecked || !dirty || recoveredDraft || pending) return;
    const timer = window.setTimeout(() => {
      setLocalState("saving");
      const write = writePromptDraft(draftKey, draftPayload, initial?.updatedAt)
        .then(() => setLocalState("saved"))
        .catch(() => setLocalState("error"))
        .then(() => undefined)
        .finally(() => {
          if (draftWriteRef.current === write) draftWriteRef.current = null;
        });
      draftWriteRef.current = write;
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draftChecked, dirty, draftKey, draftPayload, initial?.updatedAt, pending, recoveredDraft]);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) { if (dirty) event.preventDefault(); }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => () => optimizationControllerRef.current?.abort(), []);

  function addTag(value = tagDraft) {
    const normalized = value.trim().normalize("NFKC");
    if (normalized && !tags.some((tag) => tag.toLocaleLowerCase() === normalized.toLocaleLowerCase()) && tags.length < 20) setTags([...tags, normalized]);
    setTagDraft(""); setDirty(true);
  }

  function tagKey(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ","].includes(event.key)) { event.preventDefault(); addTag(); }
    if (event.key === "Backspace" && !tagDraft && tags.length) setTags(tags.slice(0, -1));
  }

  function insertTerm(value: string) {
    const field = promptRef.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const prefix = prompt.slice(0, start);
    const separator = prefix.trim() && !/[，,\s]$/.test(prefix) ? ", " : "";
    const next = `${prefix}${separator}${value}${prompt.slice(end)}`;
    setPrompt(next); setDirty(true);
    requestAnimationFrame(() => { const caret = start + separator.length + value.length; field.focus(); field.setSelectionRange(caret, caret); });
  }

  async function requestOptimization(sourcePrompt = prompt) {
    const originalPrompt = sourcePrompt;
    if (!originalPrompt.trim()) {
      setMessage("请先输入需要优化的 Prompt。");
      promptRef.current?.focus();
      return;
    }
    if (originalPrompt.length > 50_000) {
      setMessage("AI 优化单次最多处理 50,000 个字符，请缩短 Prompt 后再试。");
      promptRef.current?.focus();
      return;
    }
    optimizationControllerRef.current?.abort();
    const controller = new AbortController();
    const sequence = optimizationSequenceRef.current + 1;
    optimizationSequenceRef.current = sequence;
    optimizationControllerRef.current = controller;
    setMessage("");
    setOptimization({ status: "loading", originalPrompt });
    try {
      const response = await fetch("/api/v1/ai/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: originalPrompt }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (sequence !== optimizationSequenceRef.current) return;
      if (response.status === 401) {
        setOptimization(null);
        router.push(`/sign-in?returnTo=${encodeURIComponent(initial ? `/notes/${initial.id}/edit` : "/notes/new")}`);
        return;
      }
      if (!response.ok) {
        setOptimization({ status: "error", originalPrompt, message: apiMessage(body, `AI 优化失败（HTTP ${response.status}），请稍后重试。`) });
        return;
      }
      setOptimization({
        status: "ready",
        originalPrompt,
        optimizedPrompt: body.data.optimizedPrompt,
        modelName: body.data.model.name,
      });
    } catch (error) {
      if (controller.signal.aborted || sequence !== optimizationSequenceRef.current) return;
      setOptimization({
        status: "error",
        originalPrompt,
        message: error instanceof Error ? "当前无法连接 AI 服务，请检查网络后重试。" : "AI 优化失败，请稍后重试。",
      });
    } finally {
      if (optimizationControllerRef.current === controller) optimizationControllerRef.current = null;
    }
  }

  function discardOptimization() {
    optimizationSequenceRef.current += 1;
    optimizationControllerRef.current?.abort();
    optimizationControllerRef.current = null;
    setOptimization(null);
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  function applyOptimization(optimizedPrompt: string) {
    if (!optimization || optimization.status !== "ready" || prompt !== optimization.originalPrompt) return;
    setOptimizationUndo({ before: prompt, after: optimizedPrompt });
    setPrompt(optimizedPrompt);
    setDirty(true);
    setOptimization(null);
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  function undoOptimization() {
    if (!optimizationUndo || prompt !== optimizationUndo.after) return;
    setPrompt(optimizationUndo.before);
    setOptimizationUndo(null);
    setDirty(true);
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  function restoreDraft() {
    if (!recoveredDraft) return;
    setTitle(recoveredDraft.title);
    setPrompt(recoveredDraft.prompt);
    setNegativePrompt(recoveredDraft.negativePrompt);
    setSourceUrl(recoveredDraft.sourceUrl);
    setSourceTitle(recoveredDraft.sourceTitle);
    setTags(recoveredDraft.tags);
    setImages(recoveredDraft.images);
    setRecoveredDraft(null);
    setDirty(true);
    setLocalState("saved");
  }

  function discardDraft() {
    if (draftKey) void removePromptDraft(draftKey);
    setRecoveredDraft(null);
    setLocalState("idle");
  }

  function saveStateLabel() {
    if (pending) return "正在保存到云端";
    if (recoveredDraft) return "发现可恢复草稿";
    if (localState === "saving") return "正在保存到本机";
    if (localState === "saved") return typeof navigator !== "undefined" && !navigator.onLine ? "离线草稿已保存在本机" : "已保存到本机，尚未同步";
    if (localState === "error") return "本地草稿保存失败";
    if (dirty) return "有未保存修改";
    return initial ? "云端内容已同步" : "尚未保存";
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!title.trim() || !prompt.trim()) { setMessage("请填写标题和 Prompt。"); return; }
    setPending(true); setMessage("");
    const body = { title, prompt, negativePrompt: negativePrompt || null, sourceUrl: sourceUrl || null, sourceTitle: sourceTitle || null, tags, images, ...(initial ? { version: initial.version } : {}) };
    try {
      const response = await fetch(initial ? `/api/v1/notes/${initial.id}` : "/api/v1/notes", { method: initial ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (response.status === 401) { router.push("/sign-in"); return; }
      if (!response.ok) { setMessage(response.status === 409 ? "云端内容已经变化，请刷新页面比较后再保存。你的本地草稿仍然保留。" : result.error?.message ?? "保存失败，请稍后重试。"); return; }
      if (draftKey) {
        await draftWriteRef.current?.catch(() => undefined);
        await removePromptDraft(draftKey).catch(() => undefined);
      }
      setDirty(false); setLocalState("idle"); router.push("/notes"); router.refresh();
    } catch {
      setMessage("当前无法连接云端。草稿已保存在本机，恢复网络后可以继续保存。");
    } finally {
      setPending(false);
    }
  }

  function openImageHub() {
    sessionStorage.setItem("prompt-notebook:imagehub-draft", JSON.stringify({ title, prompt, negativePrompt }));
    router.push("/imagehub");
  }

  return (
    <div className="editor-layout" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "s") { event.preventDefault(); void submit(); } }}>
      <form className="prompt-editor" onSubmit={submit} onChange={() => setDirty(true)}>
        {!initial ? <TemplatePicker onApply={(content) => { setPrompt(content); setDirty(true); }} /> : null}
        <header className="editor-heading"><div><span className="section-kicker">{initial ? "EDIT PROMPT" : "NEW PROMPT"}</span><h2>{initial ? "编辑提示词" : "新建 Prompt"}</h2><p>输入会先保存在本机，点击保存后同步到你的云端账户。</p></div><span className={dirty || recoveredDraft ? "save-state save-state--dirty" : "save-state"}>{saveStateLabel()}</span></header>
        {recoveredDraft ? <div className="draft-recovery" role="status"><div><strong>发现上次未保存的本地草稿</strong><p>保存于 {new Date(recoveredDraft.updatedAt).toLocaleString("zh-CN")}，不会自动覆盖当前内容。</p></div><div><button type="button" onClick={restoreDraft}>恢复草稿</button><button type="button" onClick={discardDraft}>舍弃草稿</button></div></div> : null}
        <label className="field"><span>标题</span><input autoFocus name="title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required placeholder="给这条提示词起一个容易找到的名字" /></label>
        <div className="field">
          <div className="prompt-field-heading">
            <label htmlFor="prompt-content">Prompt</label>
            <div>
              {optimizationUndo && prompt === optimizationUndo.after ? <button type="button" onClick={undoOptimization}>撤销 AI 优化</button> : null}
              <button className="ai-optimize-button" disabled={optimization?.status === "loading"} type="button" onClick={() => void requestOptimization()}>
                {optimization?.status === "loading" ? "AI 优化中…" : "✦ AI 一键优化"}
              </button>
            </div>
          </div>
          <textarea id="prompt-content" ref={promptRef} name="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const text = event.dataTransfer.getData("text/plain"); if (text) { event.preventDefault(); setPrompt(text.slice(0, 100000)); setDirty(true); } }} maxLength={100000} required placeholder="描述主体、环境、光线、镜头与风格…可直接粘贴或拖入文字" />
          <small>AI 会润色、补充和结构化当前内容；确认前不会覆盖原文。</small>
        </div>
        <label className="field"><span>负面提示词（可选）</span><textarea className="negative-field" name="negativePrompt" value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} maxLength={100000} placeholder="blurry, low quality, watermark…" /></label>
        <details className="source-fields" open={Boolean(sourceUrl)}><summary>来源信息（可选）</summary><div className="source-fields__grid"><label className="field"><span>来源名称</span><input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={500} placeholder="网页、帖子或作者名称" /></label><label className="field"><span>来源链接</span><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} maxLength={4000} type="url" placeholder="https://example.com/prompt" /></label></div></details>
        <div className="field"><span>标签</span><div className="tag-input">{tags.map((tag) => <button type="button" key={tag} onClick={() => { setTags(tags.filter((item) => item !== tag)); setDirty(true); }}>{tag}<span>×</span></button>)}<input aria-label="标签" list="tag-suggestions" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={tagKey} onBlur={() => tagDraft && addTag()} placeholder={tags.length ? "继续添加…" : "输入标签，按回车添加"} maxLength={40} /><datalist id="tag-suggestions">{tagOptions.map((tag) => <option key={tag.id} value={tag.name} />)}</datalist></div><small>最多 20 个标签；点击已添加标签可移除。</small></div>
        <ImagePicker images={images} onChange={(next) => { setImages(next); setDirty(true); }} />
        {message ? <p className="form-message" role="alert">{message}</p> : null}
        <div className="editor-actions"><button className="primary-action" disabled={pending} type="submit">{pending ? "正在保存…" : "保存提示词"}</button><button type="button" onClick={openImageHub}>在 AI ImageHub 测试</button><button type="button" onClick={() => navigator.clipboard.writeText(prompt)}>复制 Prompt</button><Link href="/notes">取消</Link><span>⌘/Ctrl + S 保存</span></div>
      </form>
      <TermLibrary onInsert={insertTerm} />
      {optimization ? (
        <PromptOptimizationDialog
          state={optimization}
          currentPrompt={prompt}
          onApply={applyOptimization}
          onDiscard={discardOptimization}
          onRetry={() => void requestOptimization(prompt)}
        />
      ) : null}
    </div>
  );
}
