"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { PromptOptimizationDialog, type PromptOptimizationState } from "@/components/ai/prompt-optimization-dialog";
import type { NoteImage, NoteView } from "@/components/notes/types";

import {
  imageAspectRatios,
  imageResolutionTiers,
  imageSizeFor,
  type ImageAspectRatio,
  type ImageResolutionTier,
} from "./image-presets";
import { activeStatuses, type GenerationAsset, type GenerationJob } from "./types";

const qualityOptions = [
  { id: "auto", label: "智能", detail: "模型决定" },
  { id: "low", label: "草图", detail: "更快" },
  { id: "medium", label: "标准", detail: "均衡" },
  { id: "high", label: "精细", detail: "质量优先" },
] as const;

function statusLabel(job: GenerationJob) {
  if (job.status === "preparing") return "正在保存参考图";
  if (job.status === "queued") return "已进入生成队列";
  if (job.status === "running") return `生成中 ${job.progress}%`;
  if (job.status === "cancel_requested") return "正在取消";
  if (job.status === "cancelled") return "已取消";
  if (job.status === "failed") return "生成失败";
  return "生成完成";
}

function apiMessage(body: unknown, fallback: string) {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "object" && error !== null && "message" in error && typeof (error as { message?: unknown }).message === "string") {
      const { code, message, requestId } = error as { code?: unknown; message: string; requestId?: unknown };
      return code === "INTERNAL_ERROR" && typeof requestId === "string"
        ? `${message}（错误编号：${requestId}）`
        : message;
    }
  }
  return fallback;
}

function noteImage(asset: GenerationAsset): NoteImage {
  return {
    storageProvider: asset.storageProvider,
    objectKey: asset.objectKey,
    displayUrl: asset.displayUrl,
    thumbnailUrl: asset.thumbnailUrl,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    sizeBytes: asset.sizeBytes,
  };
}

export function ImageHubWorkbench() {
  const searchParams = useSearchParams();
  const sourceNoteId = searchParams.get("note");
  const initialized = useRef(false);
  const pollAttempt = useRef(0);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [resolution, setResolution] = useState<ImageResolutionTier>("1k");
  const [quality, setQuality] = useState<GenerationJob["quality"]>("auto");
  const [imageCount, setImageCount] = useState(1);
  const [references, setReferences] = useState<File[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [pollCycle, setPollCycle] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [reverse, setReverse] = useState<{ status: "loading" | "ready" | "error"; prompt?: string; model?: string; message?: string } | null>(null);
  const [optimization, setOptimization] = useState<PromptOptimizationState | null>(null);
  const { width, height } = imageSizeFor(aspectRatio, resolution);
  const referencePreviews = useMemo(() => references.map((file) => ({ file, url: URL.createObjectURL(file) })), [references]);
  const activeJobs = useMemo(() => jobs.filter((job) => activeStatuses.includes(job.status)), [jobs]);

  useEffect(() => () => referencePreviews.forEach((preview) => URL.revokeObjectURL(preview.url)), [referencePreviews]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    async function initialize() {
      try {
        const historyResponse = await fetch("/api/v1/generations?limit=30&status=all", { cache: "no-store" });
        if (historyResponse.status === 401) {
          window.location.assign(`/sign-in?returnTo=${encodeURIComponent("/imagehub")}`);
          return;
        }
        const historyBody = await historyResponse.json();
        if (historyResponse.ok) setJobs(historyBody.data);
        if (sourceNoteId) {
          const noteResponse = await fetch(`/api/v1/notes/${sourceNoteId}`, { cache: "no-store" });
          const noteBody = await noteResponse.json();
          if (noteResponse.ok) {
            const note = noteBody.data as NoteView;
            setTitle(note.title);
            setPrompt(note.prompt);
            setNegativePrompt(note.negativePrompt ?? "");
          }
        } else {
          const draft = sessionStorage.getItem("prompt-notebook:imagehub-draft");
          if (draft) {
            sessionStorage.removeItem("prompt-notebook:imagehub-draft");
            const parsed = JSON.parse(draft) as { title?: string; prompt?: string; negativePrompt?: string };
            setTitle(parsed.title ?? "");
            setPrompt(parsed.prompt ?? "");
            setNegativePrompt(parsed.negativePrompt ?? "");
          }
        }
      } catch {
        setMessage("暂时无法载入 ImageHub，请检查网络后重试。");
      } finally {
        setLoadingHistory(false);
      }
    }
    void initialize();
  }, [sourceNoteId]);

  useEffect(() => {
    if (!activeJobs.length) {
      pollAttempt.current = 0;
      return;
    }
    const delay = Math.min(10_000, Math.round(1_500 * (1.55 ** pollAttempt.current)));
    const timer = window.setTimeout(async () => {
      try {
        const refreshed = await Promise.all(activeJobs.map(async (job) => {
          const response = await fetch(`/api/v1/generations/${job.id}`, { cache: "no-store" });
          if (!response.ok) return job;
          return (await response.json()).data as GenerationJob;
        }));
        setJobs((current) => current.map((job) => refreshed.find((candidate) => candidate.id === job.id) ?? job));
        pollAttempt.current = Math.min(pollAttempt.current + 1, 6);
      } catch {
        pollAttempt.current = Math.min(pollAttempt.current + 1, 6);
      } finally {
        setPollCycle((cycle) => cycle + 1);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeJobs, pollCycle]);

  useEffect(() => {
    if (!reverse) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReverse(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [reverse]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) {
      setMessage("请先输入用于测试的提示词。");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("payload", JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        prompt,
        negativePrompt: negativePrompt || null,
        width,
        height,
        quality,
        imageCount,
      }));
      references.forEach((file) => form.append("references", file));
      const response = await fetch("/api/v1/generations", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) {
        setMessage(apiMessage(body, "生成任务创建失败，请稍后再试。"));
        return;
      }
      setJobs((current) => [body.data as GenerationJob, ...current.filter((job) => job.id !== body.data.id)]);
      setMessage("任务已安全保存并进入生成队列。离开页面后仍会继续执行。");
    } catch {
      setMessage("无法连接生成服务，请检查网络后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(jobId: string) {
    const response = await fetch(`/api/v1/generations/${jobId}?mode=cancel`, { method: "DELETE" });
    const body = await response.json();
    if (response.ok) setJobs((current) => current.map((job) => job.id === jobId ? body.data : job));
    else setMessage(apiMessage(body, "取消任务失败。"));
  }

  async function removeHistory(job: GenerationJob) {
    if (!window.confirm("确认删除这条生成历史？此操作不会删除已经保存到提示词笔记中的图片。")) return;
    const response = await fetch(`/api/v1/generations/${job.id}?mode=history`, { method: "DELETE" });
    const body = await response.json().catch(() => null);
    if (response.ok) {
      setJobs((current) => current.filter((candidate) => candidate.id !== job.id));
      setMessage("生成历史已删除。");
    } else {
      setMessage(apiMessage(body, "删除生成历史失败。"));
    }
  }

  async function reverseFrom(source: File | GenerationAsset) {
    setReverse({ status: "loading" });
    try {
      const response = source instanceof File
        ? await (() => {
          const form = new FormData();
          form.set("image", source);
          return fetch("/api/v1/ai/reverse-prompt", { method: "POST", body: form });
        })()
        : await fetch("/api/v1/ai/reverse-prompt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageUrl: source.displayUrl }),
        });
      const body = await response.json();
      if (!response.ok) {
        setReverse({ status: "error", message: apiMessage(body, "图片反推失败，请稍后再试。") });
        return;
      }
      setReverse({ status: "ready", prompt: body.data.prompt, model: body.data.model.name });
    } catch {
      setReverse({ status: "error", message: "无法连接图片反推服务。" });
    }
  }

  async function optimizePrompt() {
    if (!prompt.trim()) {
      setMessage("请先输入提示词再进行优化。");
      return;
    }
    const originalPrompt = prompt;
    setOptimization({ status: "loading", originalPrompt });
    try {
      const response = await fetch("/api/v1/ai/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: originalPrompt, context: "image_generation" }),
      });
      const body = await response.json();
      if (!response.ok) {
        setOptimization({ status: "error", originalPrompt, message: apiMessage(body, "提示词优化失败。") });
        return;
      }
      setOptimization({ status: "ready", originalPrompt, optimizedPrompt: body.data.optimizedPrompt, modelName: body.data.model.name });
    } catch {
      setOptimization({ status: "error", originalPrompt, message: "无法连接 AI 优化服务。" });
    }
  }

  async function saveAsNote(job: GenerationJob) {
    const images = job.assets.filter((asset) => asset.role === "result").map(noteImage);
    const response = await fetch("/api/v1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim() || job.prompt.slice(0, 60),
        prompt: job.prompt,
        negativePrompt: job.negativePrompt,
        model: job.modelName,
        tags: ["AI 生成"],
        images,
        parameters: { generationJobId: job.id, width: job.width, height: job.height, quality: job.quality },
      }),
    });
    const body = await response.json();
    setMessage(response.ok ? "已保存为新的提示词笔记。" : apiMessage(body, "保存笔记失败。"));
  }

  async function attachAsCover(job: GenerationJob, asset: GenerationAsset) {
    if (!sourceNoteId) return;
    const noteResponse = await fetch(`/api/v1/notes/${sourceNoteId}`, { cache: "no-store" });
    const noteBody = await noteResponse.json();
    if (!noteResponse.ok) {
      setMessage(apiMessage(noteBody, "无法读取原笔记。"));
      return;
    }
    const note = noteBody.data as NoteView;
    const image = noteImage(asset);
    const images = [image, ...note.images.filter((current) => current.objectKey !== image.objectKey)].slice(0, 8);
    const response = await fetch(`/api/v1/notes/${sourceNoteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: note.version, images }),
    });
    const body = await response.json();
    setMessage(response.ok ? "生成图已设为原笔记封面。" : apiMessage(body, "设置封面失败。"));
  }

  return (
    <div className="imagehub-workbench">
      <header className="imagehub-hero">
        <div>
          <span className="section-kicker">AI IMAGE LAB / DURABLE QUEUE</span>
          <h2>AI ImageHub</h2>
          <p>在笔记本里验证提示词、比较构图并保存作品。任务离开页面后继续执行，生成图只存入图床。</p>
        </div>
        <div className="imagehub-queue-badge" data-active={activeJobs.length > 0}>
          <span aria-hidden="true" />
          {activeJobs.length ? `${activeJobs.length} 个任务处理中` : "队列空闲"}
        </div>
      </header>

      <div className="imagehub-grid">
        <form className="imagehub-console" onSubmit={generate}>
          <div className="imagehub-console__label"><span>01</span> 提示词控制台</div>
          {sourceNoteId ? <p className="imagehub-origin">已从笔记载入 · <Link href={`/notes/${sourceNoteId}/edit`}>返回编辑</Link></p> : null}
          <label className="field"><span>作品标题（保存笔记时使用）</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="例如：冬夜灯塔实验" /></label>
          <label className="field"><span>Prompt</span><textarea className="imagehub-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={50_000} required placeholder="描述主体、构图、环境、光线、镜头与材质……" /></label>
          <div className="imagehub-inline-actions">
            <button type="button" onClick={() => void optimizePrompt()}>✦ AI 优化提示词</button>
            <span>{prompt.length.toLocaleString()} / 50,000</span>
          </div>
          <label className="field"><span>负面提示词</span><textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} maxLength={20_000} placeholder="watermark, blurry, malformed hands…" /></label>

          <fieldset className="imagehub-options"><legend>画布比例</legend><div className="imagehub-segments imagehub-segments--ratios">{imageAspectRatios.map((ratio) => <button aria-pressed={aspectRatio === ratio.id} key={ratio.id} type="button" onClick={() => setAspectRatio(ratio.id)}><strong>{ratio.label}</strong><small>{ratio.id}</small></button>)}</div></fieldset>
          <fieldset className="imagehub-options"><legend>输出尺寸</legend><div className="imagehub-segments imagehub-segments--resolutions">{imageResolutionTiers.map((tier) => {
            const size = imageSizeFor(aspectRatio, tier.id);
            return <button aria-pressed={resolution === tier.id} key={tier.id} type="button" onClick={() => setResolution(tier.id)}><strong>{tier.label}</strong><small>{size.width}×{size.height} · {tier.detail}</small></button>;
          })}</div>{resolution === "4k" ? <p className="imagehub-option-note">4K/最大画布属于 GPT Image 2 实验性高分辨率输出，生成时间和费用会明显增加。</p> : null}</fieldset>
          <div className="imagehub-settings-row">
            <fieldset><legend>渲染质量</legend><div className="imagehub-choice">{qualityOptions.map((option) => <button aria-pressed={quality === option.id} key={option.id} type="button" onClick={() => setQuality(option.id)}><strong>{option.label}</strong><small>{option.detail}</small></button>)}</div></fieldset>
            <label><span>张数</span><select value={imageCount} onChange={(event) => setImageCount(Number(event.target.value))}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 张</option>)}</select></label>
          </div>

          <div className="imagehub-references">
            <div><strong>参考图片</strong><span>最多 4 张，每张不超过 10MB</span></div>
            <label className="imagehub-upload"><input accept="image/jpeg,image/png,image/webp" multiple type="file" onChange={(event) => setReferences(Array.from(event.target.files ?? []).slice(0, 4))} /><span>＋ 选择参考图</span></label>
            {referencePreviews.length ? <div className="imagehub-reference-grid">{referencePreviews.map(({ file, url }, index) => <figure key={`${file.name}-${file.lastModified}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`参考图 ${index + 1}`} />
              <figcaption><button type="button" onClick={() => void reverseFrom(file)}>反推 Prompt</button><button aria-label={`移除参考图 ${index + 1}`} type="button" onClick={() => setReferences((current) => current.filter((candidate) => candidate !== file))}>移除</button></figcaption>
            </figure>)}</div> : null}
          </div>
          {message ? <p className="imagehub-message" role="status">{message}</p> : null}
          <button className="imagehub-generate" disabled={submitting} type="submit"><span>{submitting ? "正在建立任务…" : "开始生成"}</span><small>{width} × {height} · {imageCount} 张</small></button>
        </form>

        <section className="imagehub-results" aria-busy={loadingHistory}>
          <div className="imagehub-results__heading"><div><span className="imagehub-console__label"><span>02</span> 任务胶片墙</span><h3>最近生成</h3></div><button type="button" onClick={() => window.location.reload()}>刷新</button></div>
          {loadingHistory ? <div className="imagehub-empty" role="status">正在显影历史任务…</div> : jobs.length ? <div className="imagehub-jobs">{jobs.map((job) => {
            const results = job.assets.filter((asset) => asset.role === "result");
            return <article className="imagehub-job" data-status={job.status} key={job.id}>
              <header><div><span>{new Date(job.createdAt).toLocaleString("zh-CN")}</span><strong>{statusLabel(job)}</strong></div><small>{job.modelName} · {job.width}×{job.height}</small></header>
              {activeStatuses.includes(job.status) ? <div className="imagehub-progress"><span style={{ width: `${Math.max(job.progress, 6)}%` }} /></div> : null}
              {results.length ? <div className="imagehub-filmstrip">{results.map((asset, index) => <figure key={asset.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.thumbnailUrl || asset.displayUrl} alt={`生成作品 ${index + 1}`} />
                <figcaption><button type="button" onClick={() => void reverseFrom(asset)}>反推</button><a download href={asset.displayUrl} target="_blank" rel="noopener noreferrer">下载</a>{sourceNoteId ? <button type="button" onClick={() => void attachAsCover(job, asset)}>设为封面</button> : null}</figcaption>
              </figure>)}</div> : <div className="imagehub-placeholder"><span>{job.status === "failed" ? "!" : "◌"}</span><p>{job.errorMessage || "任务正在等待图像结果"}</p></div>}
              <p className="imagehub-job__prompt">{job.prompt}</p>
              <footer>{activeStatuses.includes(job.status) ? <button type="button" onClick={() => void cancel(job.id)}>取消任务</button> : null}{job.status === "succeeded" ? <button type="button" onClick={() => void saveAsNote(job)}>保存为笔记</button> : null}<button type="button" onClick={() => navigator.clipboard.writeText(job.prompt)}>复制 Prompt</button>{!activeStatuses.includes(job.status) ? <button type="button" onClick={() => void removeHistory(job)}>删除记录</button> : null}</footer>
            </article>;
          })}</div> : <div className="imagehub-empty"><span>NO EXPOSURES YET</span><h3>还没有生成记录</h3><p>从左侧输入第一条提示词，任务会在这里持续更新。</p></div>}
        </section>
      </div>

      {reverse ? <div className="imagehub-review" role="dialog" aria-modal="true" aria-labelledby="reverse-title"><div>
        <span className="section-kicker">IMAGE → PROMPT</span><h3 id="reverse-title">图片反推结果</h3>
        {reverse.status === "loading" ? <p role="status">AI 正在观察构图、光线与材质…</p> : reverse.status === "error" ? <p role="alert">{reverse.message}</p> : <><small>由 {reverse.model} 分析</small><textarea aria-label="反推提示词" readOnly value={reverse.prompt} /><div><button type="button" onClick={() => { setPrompt(reverse.prompt ?? ""); setReverse(null); }}>使用这个 Prompt</button><button type="button" onClick={() => navigator.clipboard.writeText(reverse.prompt ?? "")}>复制</button></div></>}
        <button autoFocus className="imagehub-review__close" type="button" onClick={() => setReverse(null)}>放弃并关闭</button>
      </div></div> : null}

      {optimization ? <PromptOptimizationDialog state={optimization} currentPrompt={prompt} onApply={(value) => { if (optimization.status === "ready" && prompt === optimization.originalPrompt) setPrompt(value); setOptimization(null); }} onDiscard={() => setOptimization(null)} onRetry={() => void optimizePrompt()} /> : null}
    </div>
  );
}
