"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  PromptOptimizationDialog,
  type PromptOptimizationRetryOptions,
  type PromptOptimizationState,
} from "@/components/ai/prompt-optimization-dialog";
import { GenerationCharacterPicker } from "@/components/characters/generation-character-picker";
import { ReversePromptDialog, type ReversePromptSource, type ReversePromptValue } from "@/components/ai/reverse-prompt-workbench";
import { storePromptHandoff, takePromptHandoff } from "@/modules/sync/prompt-handoff";
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

function apiErrorCode(body: unknown) {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : null;
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

function filenameFromDisposition(value: string | null, fallback: string) {
  const encoded = value?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = value?.match(/filename="?([^";]+)"?/i)?.[1];
  let candidate = plain;
  try {
    if (encoded) candidate = decodeURIComponent(encoded);
  } catch {
    candidate = plain;
  }
  return candidate?.replace(/[\\/:*?"<>|]/g, "-") || fallback;
}

export function ImageHubWorkbench() {
  const searchParams = useSearchParams();
  const sourceNoteId = searchParams.get("note");
  const sourceCharacterId = searchParams.get("character");
  const initialized = useRef(false);
  const pollAttempt = useRef(0);
  const pendingActionKeys = useRef(new Set<string>());
  const optimizationControllerRef = useRef<AbortController | null>(null);
  const optimizationSequenceRef = useRef(0);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [resolution, setResolution] = useState<ImageResolutionTier>("1k");
  const [quality, setQuality] = useState<GenerationJob["quality"]>("auto");
  const [imageCount, setImageCount] = useState(1);
  const [references, setReferences] = useState<File[]>([]);
  const [characterProfileId, setCharacterProfileId] = useState<string>();
  const [characterImageIds, setCharacterImageIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [pollCycle, setPollCycle] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const [jobFeedback, setJobFeedback] = useState<Record<string, string>>({});
  const [savedJobs, setSavedJobs] = useState<Set<string>>(() => new Set());
  const [characterSaveFallbacks, setCharacterSaveFallbacks] = useState<Set<string>>(() => new Set());
  const [reverse, setReverse] = useState<{ source?: ReversePromptSource } | null>(null);
  const [reverseUndo, setReverseUndo] = useState<{ before: ReversePromptValue; after: ReversePromptValue } | null>(null);
  const [optimization, setOptimization] = useState<PromptOptimizationState | null>(null);
  const [optimizationUndo, setOptimizationUndo] = useState<{ before: string; after: string } | null>(null);
  const { width, height } = imageSizeFor(aspectRatio, resolution);
  const referencePreviews = useMemo(() => references.map((file) => ({ file, url: URL.createObjectURL(file) })), [references]);
  const activeJobs = useMemo(() => jobs.filter((job) => activeStatuses.includes(job.status)), [jobs]);

  function beginAction(key: string) {
    if (pendingActionKeys.current.has(key)) return false;
    pendingActionKeys.current.add(key);
    setPendingActions(new Set(pendingActionKeys.current));
    return true;
  }

  function finishAction(key: string) {
    pendingActionKeys.current.delete(key);
    setPendingActions(new Set(pendingActionKeys.current));
  }

  function feedback(jobId: string, text: string) {
    setJobFeedback((current) => ({ ...current, [jobId]: text }));
  }

  useEffect(() => () => referencePreviews.forEach((preview) => URL.revokeObjectURL(preview.url)), [referencePreviews]);
  useEffect(() => () => optimizationControllerRef.current?.abort(), []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    async function initialize() {
      try {
        async function selectCharacter(profileId: string | undefined, imageIds: string[] = []) {
          if (!profileId) return;
          if (imageIds.length) {
            setCharacterProfileId(profileId);
            setCharacterImageIds(imageIds.slice(0, 4));
            return;
          }
          const response = await fetch(`/api/v1/ai-models/${profileId}`, { cache: "no-store" });
          if (!response.ok) return;
          const profile = (await response.json()).data as { primaryImage?: { id: string } | null; images?: Array<{ id: string }> };
          const imageId = profile.primaryImage?.id ?? profile.images?.[0]?.id;
          if (imageId) {
            setCharacterProfileId(profileId);
            setCharacterImageIds([imageId]);
          }
        }
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
            const character = note.characterProfiles.find((item) => item.role === "primary" && !item.archivedAt)
              ?? note.characterProfiles.find((item) => !item.archivedAt);
            await selectCharacter(character?.id);
          }
        } else {
          const handoff = takePromptHandoff(searchParams.get("handoff"), "imagehub");
          const draft = sessionStorage.getItem("prompt-notebook:imagehub-draft");
          if (handoff) {
            setPrompt(handoff.prompt);
            setNegativePrompt(handoff.negativePrompt);
            setMessage("已载入图片反推结果，可以调整后开始生成。");
          } else if (draft) {
            sessionStorage.removeItem("prompt-notebook:imagehub-draft");
            const parsed = JSON.parse(draft) as {
              title?: string;
              prompt?: string;
              negativePrompt?: string;
              characterProfileId?: string;
              characterImageIds?: string[];
            };
            setTitle(parsed.title ?? "");
            setPrompt(parsed.prompt ?? "");
            setNegativePrompt(parsed.negativePrompt ?? "");
            await selectCharacter(
              typeof parsed.characterProfileId === "string" ? parsed.characterProfileId : undefined,
              Array.isArray(parsed.characterImageIds) ? parsed.characterImageIds.filter((id): id is string => typeof id === "string") : [],
            );
          } else if (sourceCharacterId) {
            await selectCharacter(sourceCharacterId);
          }
        }
      } catch {
        setMessage("暂时无法载入 ImageHub，请检查网络后重试。");
      } finally {
        setLoadingHistory(false);
      }
    }
    void initialize();
  }, [searchParams, sourceCharacterId, sourceNoteId]);

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
        characterProfileId,
        characterImageIds,
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
    const key = `cancel:${jobId}`;
    if (!beginAction(key)) return;
    feedback(jobId, "正在取消任务…");
    try {
      const response = await fetch(`/api/v1/generations/${jobId}?mode=cancel`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        setJobs((current) => current.map((job) => job.id === jobId ? body.data : job));
        feedback(jobId, "取消请求已提交。");
      } else {
        feedback(jobId, apiMessage(body, "取消任务失败。"));
      }
    } catch {
      feedback(jobId, "无法连接取消任务服务。");
    } finally {
      finishAction(key);
    }
  }

  async function removeHistory(job: GenerationJob) {
    if (!window.confirm("确认删除这条生成历史？此操作不会删除已经保存到提示词笔记中的图片。")) return;
    const key = `delete:${job.id}`;
    if (!beginAction(key)) return;
    feedback(job.id, "正在删除记录…");
    try {
      const response = await fetch(`/api/v1/generations/${job.id}?mode=history`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        setJobs((current) => current.filter((candidate) => candidate.id !== job.id));
        setMessage("生成历史已删除。");
      } else {
        feedback(job.id, apiMessage(body, "删除生成历史失败。"));
      }
    } catch {
      feedback(job.id, "无法连接删除历史服务。");
    } finally {
      finishAction(key);
    }
  }

  function reverseFrom(source: File | GenerationAsset) {
    setReverse({ source: source instanceof File ? source : { imageUrl: source.displayUrl, noteImage: noteImage(source) } });
  }

  function applyReverse(value: ReversePromptValue) {
    if ((prompt.trim() || negativePrompt.trim()) && !window.confirm("使用反推结果将替换当前 Prompt 和负面提示词，是否继续？原内容可撤销恢复。")) return;
    setReverseUndo({ before: { prompt, negativePrompt }, after: value });
    setPrompt(value.prompt); setNegativePrompt(value.negativePrompt); setReverse(null);
    setMessage("已使用图片反推结果；如需恢复原输入，可以撤销。");
  }

  async function optimizePrompt(sourcePrompt = prompt, options: PromptOptimizationRetryOptions = {}) {
    if (!sourcePrompt.trim()) {
      setMessage("请先输入提示词再进行优化。");
      return;
    }
    optimizationControllerRef.current?.abort();
    const controller = new AbortController();
    const sequence = optimizationSequenceRef.current + 1;
    optimizationSequenceRef.current = sequence;
    optimizationControllerRef.current = controller;
    const originalPrompt = sourcePrompt;
    setMessage("");
    setOptimization({ status: "loading", originalPrompt });
    try {
      const response = await fetch("/api/v1/ai/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: originalPrompt,
          context: options.context ?? "image_generation",
          ...(options.requestedModules ? { requestedModules: options.requestedModules } : {}),
          hints: {
            hasAiModel: Boolean(characterProfileId),
            referenceImageCount: Math.min(characterImageIds.length + references.length, 4),
            aspectRatio,
          },
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (sequence !== optimizationSequenceRef.current) return;
      if (!response.ok) {
        setOptimization({ status: "error", originalPrompt, message: apiMessage(body, "提示词优化失败。") });
        return;
      }
      setOptimization({ status: "ready", originalPrompt, optimizedPrompt: body.data.optimizedPrompt, modelName: body.data.model.name, structure: body.data.structure });
    } catch {
      if (controller.signal.aborted || sequence !== optimizationSequenceRef.current) return;
      setOptimization({ status: "error", originalPrompt, message: "无法连接 AI 优化服务。" });
    } finally {
      if (optimizationControllerRef.current === controller) optimizationControllerRef.current = null;
    }
  }

  function discardOptimization() {
    optimizationSequenceRef.current += 1;
    optimizationControllerRef.current?.abort();
    optimizationControllerRef.current = null;
    setOptimization(null);
  }

  function applyOptimization(value: string) {
    if (!optimization || optimization.status !== "ready" || prompt !== optimization.originalPrompt) return;
    setOptimizationUndo({ before: prompt, after: value });
    setPrompt(value);
    setOptimization(null);
  }

  function undoOptimization() {
    if (!optimizationUndo || prompt !== optimizationUndo.after) return;
    setPrompt(optimizationUndo.before);
    setOptimizationUndo(null);
  }

  async function saveAsNote(job: GenerationJob, withoutCharacter = false) {
    const key = `save:${job.id}`;
    if (savedJobs.has(job.id) || !beginAction(key)) return;
    feedback(job.id, "正在保存为笔记…");
    try {
      const images = job.assets.filter((asset) => asset.role === "result").map(noteImage);
      const response = await fetch("/api/v1/notes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `imagehub-note:${job.id}`,
        },
        body: JSON.stringify({
          title: title.trim() || job.prompt.slice(0, 60),
          prompt: job.prompt,
          negativePrompt: job.negativePrompt,
          model: job.modelName,
          tags: ["AI 生成"],
          images,
          characterProfiles: !withoutCharacter && job.characterProfile ? [{ id: job.characterProfile.id, role: "primary", sortOrder: 0 }] : [],
          parameters: { generationJobId: job.id, width: job.width, height: job.height, quality: job.quality },
        }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        const text = body?.meta?.replayed ? "这条生成结果已经保存过，不会重复创建。" : "已保存为新的提示词笔记。";
        setSavedJobs((current) => new Set(current).add(job.id));
        setCharacterSaveFallbacks((current) => {
          const next = new Set(current);
          next.delete(job.id);
          return next;
        });
        feedback(job.id, text);
      } else if (!withoutCharacter && apiErrorCode(body) === "CHARACTER_PROFILE_NOT_FOUND") {
        setCharacterSaveFallbacks((current) => new Set(current).add(job.id));
        feedback(job.id, "关联的 AI Model 已被移入回收站或删除，笔记尚未创建。你可以移除失效的角色关联后再次保存。");
      } else {
        feedback(job.id, apiMessage(body, "保存笔记失败。"));
      }
    } catch {
      feedback(job.id, "无法连接笔记保存服务。");
    } finally {
      finishAction(key);
    }
  }

  async function attachAsCover(job: GenerationJob, asset: GenerationAsset) {
    if (!sourceNoteId) return;
    const key = `cover:${asset.id}`;
    if (!beginAction(key)) return;
    feedback(job.id, "正在设置笔记封面…");
    try {
      const noteResponse = await fetch(`/api/v1/notes/${sourceNoteId}`, { cache: "no-store" });
      const noteBody = await noteResponse.json().catch(() => null);
      if (!noteResponse.ok) {
        feedback(job.id, apiMessage(noteBody, "无法读取原笔记。"));
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
      const body = await response.json().catch(() => null);
      const text = response.ok ? "生成图已设为原笔记封面。" : apiMessage(body, "设置封面失败。");
      feedback(job.id, text);
    } catch {
      feedback(job.id, "无法连接笔记封面服务。");
    } finally {
      finishAction(key);
    }
  }

  async function downloadAsset(job: GenerationJob, asset: GenerationAsset) {
    const key = `download:${asset.id}`;
    if (!beginAction(key)) return;
    feedback(job.id, "正在准备图片文件…");
    try {
      const response = await fetch(`/api/v1/generations/${job.id}/assets/${asset.id}/download`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        feedback(job.id, apiMessage(body, "图片下载失败。"));
        return;
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filenameFromDisposition(response.headers.get("content-disposition"), `prompt-notebook-${asset.id}.png`);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
      feedback(job.id, "图片下载已开始。");
    } catch {
      feedback(job.id, "无法准备图片下载，请稍后重试。");
    } finally {
      finishAction(key);
    }
  }

  async function copyPrompt(job: GenerationJob) {
    const key = `copy:${job.id}`;
    if (!beginAction(key)) return;
    feedback(job.id, "正在复制 Prompt…");
    try {
      await navigator.clipboard.writeText(job.prompt);
      feedback(job.id, "Prompt 已复制到剪贴板。");
    } catch {
      feedback(job.id, "复制失败，请检查浏览器剪贴板权限。");
    } finally {
      finishAction(key);
    }
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
          <label className="field"><span>Prompt</span><textarea aria-label="Prompt" className="imagehub-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={50_000} required placeholder="描述主体、构图、环境、光线、镜头与材质……" /></label>
          <div className="imagehub-inline-actions">
            <button type="button" onClick={() => setReverse({})}>图片反推提示词</button>
            {reverseUndo && prompt === reverseUndo.after.prompt && negativePrompt === reverseUndo.after.negativePrompt ? <button type="button" onClick={() => { setPrompt(reverseUndo.before.prompt); setNegativePrompt(reverseUndo.before.negativePrompt); setReverseUndo(null); setMessage("已恢复反推前的输入。"); }}>撤销图片反推</button> : null}
            {optimizationUndo && prompt === optimizationUndo.after ? <button type="button" onClick={undoOptimization}>撤销 AI 优化</button> : null}
            <button aria-busy={optimization?.status === "loading"} disabled={optimization?.status === "loading"} type="button" onClick={() => void optimizePrompt()}>{optimization?.status === "loading" ? "AI 优化中…" : "✦ AI 优化提示词"}</button>
            <span>{prompt.length.toLocaleString()} / 50,000</span>
          </div>
          <label className="field"><span>负面提示词</span><textarea aria-label="负面提示词" value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} maxLength={20_000} placeholder="watermark, blurry, malformed hands…" /></label>

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
            <div><strong>角色与参考图片</strong><span>AI Model 垫图与本地参考图合计最多 4 张</span></div>
            <GenerationCharacterPicker
              selectedProfileId={characterProfileId}
              selectedImageIds={characterImageIds}
              maxImages={Math.max(0, 4 - references.length)}
              onChange={(profileId, imageIds) => {
                setCharacterProfileId(profileId);
                setCharacterImageIds(imageIds);
              }}
            />
            <label className="imagehub-upload"><input accept="image/jpeg,image/png,image/webp" multiple type="file" onChange={(event) => setReferences(Array.from(event.target.files ?? []).slice(0, Math.max(0, 4 - characterImageIds.length)))} /><span>＋ 上传其他参考图</span></label>
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
                <figcaption><button type="button" onClick={() => void reverseFrom(asset)}>反推</button><button aria-busy={pendingActions.has(`download:${asset.id}`)} disabled={pendingActions.has(`download:${asset.id}`)} type="button" onClick={() => void downloadAsset(job, asset)}>{pendingActions.has(`download:${asset.id}`) ? "准备中…" : "下载"}</button>{sourceNoteId ? <button aria-busy={pendingActions.has(`cover:${asset.id}`)} disabled={pendingActions.has(`cover:${asset.id}`)} type="button" onClick={() => void attachAsCover(job, asset)}>{pendingActions.has(`cover:${asset.id}`) ? "设置中…" : "设为封面"}</button> : null}</figcaption>
              </figure>)}</div> : <div className="imagehub-placeholder"><span>{job.status === "failed" ? "!" : "◌"}</span><p>{job.errorMessage || "任务正在等待图像结果"}</p></div>}
              {job.characterProfile ? <p className="imagehub-job__character">AI Model · {job.characterProfile.available ? <Link href={`/ai-models/${job.characterProfile.id}`}>{job.characterProfile.name}</Link> : <span>{job.characterProfile.name}（角色卡已删除）</span>} · {job.characterProfile.imageIds.length} 张角色垫图</p> : null}
              <p className="imagehub-job__prompt">{job.prompt}</p>
              {jobFeedback[job.id] ? <p className="imagehub-job__feedback" role="status">{jobFeedback[job.id]}</p> : null}
              <footer>{activeStatuses.includes(job.status) ? <button aria-busy={pendingActions.has(`cancel:${job.id}`)} disabled={pendingActions.has(`cancel:${job.id}`)} type="button" onClick={() => void cancel(job.id)}>{pendingActions.has(`cancel:${job.id}`) ? "取消中…" : "取消任务"}</button> : null}{job.status === "succeeded" ? characterSaveFallbacks.has(job.id) ? <button aria-busy={pendingActions.has(`save:${job.id}`)} disabled={pendingActions.has(`save:${job.id}`) || savedJobs.has(job.id)} type="button" onClick={() => void saveAsNote(job, true)}>{pendingActions.has(`save:${job.id}`) ? "保存中…" : "移除角色关联后保存"}</button> : <button aria-busy={pendingActions.has(`save:${job.id}`)} disabled={pendingActions.has(`save:${job.id}`) || savedJobs.has(job.id)} type="button" onClick={() => void saveAsNote(job)}>{pendingActions.has(`save:${job.id}`) ? "保存中…" : savedJobs.has(job.id) ? "已保存" : "保存为笔记"}</button> : null}<button aria-busy={pendingActions.has(`copy:${job.id}`)} disabled={pendingActions.has(`copy:${job.id}`)} type="button" onClick={() => void copyPrompt(job)}>{pendingActions.has(`copy:${job.id}`) ? "复制中…" : "复制 Prompt"}</button>{!activeStatuses.includes(job.status) ? <button aria-busy={pendingActions.has(`delete:${job.id}`)} disabled={pendingActions.has(`delete:${job.id}`)} type="button" onClick={() => void removeHistory(job)}>{pendingActions.has(`delete:${job.id}`) ? "删除中…" : "删除记录"}</button> : null}</footer>
            </article>;
          })}</div> : <div className="imagehub-empty"><span>NO EXPOSURES YET</span><h3>还没有生成记录</h3><p>从左侧输入第一条提示词，任务会在这里持续更新。</p></div>}
        </section>
      </div>

      {reverse ? <ReversePromptDialog initialSource={reverse.source} onClose={() => setReverse(null)} onUse={applyReverse} onAnalyzeTerms={(value) => { const id = storePromptHandoff("analyze", value); window.location.assign(`/library?tab=analyze&handoff=${id}`); }} /> : null}

      {optimization ? <PromptOptimizationDialog state={optimization} currentPrompt={prompt} onApply={applyOptimization} onDiscard={discardOptimization} onRetry={(options) => void optimizePrompt(optimization.originalPrompt, options)} /> : null}
    </div>
  );
}
