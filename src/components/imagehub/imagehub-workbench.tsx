"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  PromptOptimizationDialog,
  type PromptOptimizationRetryOptions,
  type PromptOptimizationState,
} from "@/components/ai/prompt-optimization-dialog";
import { GenerationCharacterPicker } from "@/components/characters/generation-character-picker";
import { ReversePromptDialog, type ReversePromptSource, type ReversePromptValue } from "@/components/ai/reverse-prompt-workbench";
import { storePromptHandoff, takePromptHandoff } from "@/modules/sync/prompt-handoff";
import { getImageModelCapabilities, MAX_IMAGE_GENERATION_PROMPT_LENGTH, validateImageGenerationSettings } from "@/modules/ai/image-capabilities";
import type { NoteImage, NoteView } from "@/components/notes/types";

import {
  imageAspectRatios,
  imageResolutionTiers,
  imageSizeFor,
  type ImageAspectRatio,
  type ImageResolutionTier,
} from "./image-presets";
import { activeStatuses, type GenerationAsset, type GenerationJob } from "./types";
import { generationUsage, imageModelOptions, type ImageModelOption } from "./model-options";
import { ImageMaskEditor } from "./image-mask-editor";
import { prepareEditingImage } from "./editing-image";

const qualityOptions = [
  { id: "auto", label: "智能", detail: "模型决定" },
  { id: "low", label: "草图", detail: "更快" },
  { id: "medium", label: "标准", detail: "均衡" },
  { id: "high", label: "精细", detail: "质量优先" },
  { id: "xhigh", label: "超精细", detail: "更多细节" },
  { id: "max", label: "最高", detail: "最高质量" },
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
  const router = useRouter();
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
  const [explicitSize, setExplicitSize] = useState<{ width: number; height: number } | null>(null);
  const [quality, setQuality] = useState<GenerationJob["quality"]>("auto");
  const [imageCount, setImageCount] = useState(1);
  const [models, setModels] = useState<ImageModelOption[]>([]);
  const [modelProfileId, setModelProfileId] = useState("");
  const [defaultModelProfileId, setDefaultModelProfileId] = useState("");
  const [modelMessage, setModelMessage] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [outputFormat, setOutputFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [background, setBackground] = useState<"auto" | "opaque" | "transparent">("auto");
  const [outputCompression, setOutputCompression] = useState<number | "">("");
  const [references, setReferences] = useState<File[]>([]);
  const [mask, setMask] = useState<{ source: File; file: File } | null>(null);
  const [maskEditorSource, setMaskEditorSource] = useState<File | null>(null);
  const referenceSelectionRef = useRef({ references, characterImageIds: [] as string[], capabilities: getImageModelCapabilities("gpt-image-2") });
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
  const { width, height } = explicitSize ?? imageSizeFor(aspectRatio, resolution);
  const selectedModel = models.find((model) => model.modelProfileId === (modelProfileId || defaultModelProfileId));
  const capabilities = useMemo(() => {
    try { return getImageModelCapabilities(selectedModel?.modelId ?? "gpt-image-2", selectedModel?.defaultParameters); }
    catch { return getImageModelCapabilities("unknown"); }
  }, [selectedModel]);
  const appliedMask = mask && mask.source === references[0] && !characterProfileId && capabilities.supportsMask ? mask.file : null;
  let settingsError = modelsLoaded && !selectedModel ? models.length ? "请选择本次任务使用的生图模型。" : "请先在 AI 设置中配置并启用生图模型。" : "";
  if (selectedModel) {
    try {
      validateImageGenerationSettings({
        modelId: selectedModel.modelId, parameters: selectedModel.defaultParameters,
        width, height, quality, imageCount, outputFormat, background,
        ...(outputFormat !== "png" && outputCompression !== "" ? { outputCompression } : {}),
        prompt, negativePrompt, referenceImageCount: references.length + characterImageIds.length,
      });
    } catch (error) { settingsError = error instanceof Error ? error.message : "请检查当前模型的生成设置。"; }
  }
  const referencePreviews = useMemo(() => references.map((file) => ({ file, url: URL.createObjectURL(file) })), [references]);
  const activeJobs = useMemo(() => jobs.filter((job) => activeStatuses.includes(job.status)), [jobs]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    void Promise.all([
      fetch("/api/v1/ai/configurations", { cache: "no-store", signal }),
      fetch("/api/v1/ai/preferences", { cache: "no-store", signal }),
    ]).then(async ([configurationResponse, preferenceResponse]) => {
      if (!configurationResponse.ok || !preferenceResponse.ok) throw new Error("配置暂时无法载入");
      const [configurationBody, preferenceBody] = await Promise.all([configurationResponse.json(), preferenceResponse.json()]);
      if (controller.signal.aborted) return;
      const eligible = imageModelOptions(configurationBody.data);
      setModels(eligible);
      setModelsLoaded(true);
      const preference = Array.isArray(preferenceBody.data)
        ? preferenceBody.data.find((item: { purpose?: string }) => item.purpose === "image_generation") : null;
      const selected = eligible.find((item) => item.modelProfileId === preference?.modelProfileId);
      if (selected) {
        setDefaultModelProfileId(selected.modelProfileId);
        setModelProfileId(selected.modelProfileId);
        applyModelDefaults(selected);
      }
      if (!eligible.length) setModelMessage("尚无已启用的生图模型，请先在 AI 设置中配置。");
      else if (!selected) setModelMessage("请选择本次任务使用的模型；设置中的默认模型不会改变。");
    }).catch(() => {
      if (!controller.signal.aborted) setModelMessage("暂时无法载入模型选项，仍可使用设置中的默认模型提交任务。");
    }).finally(() => { if (!controller.signal.aborted) setLoadingModels(false); });
    return () => controller.abort();
  }, []);

  function applyModelDefaults(model: ImageModelOption) {
    let nextCapabilities;
    try { nextCapabilities = getImageModelCapabilities(model.modelId, model.defaultParameters); }
    catch { nextCapabilities = getImageModelCapabilities("unknown"); }
    const format = model.defaultParameters.output_format;
    const nextFormat = nextCapabilities.formats.find((candidate) => candidate === format) ?? nextCapabilities.formats[0];
    const configuredBackground = model.defaultParameters.background;
    setOutputFormat(nextFormat);
    setBackground(nextCapabilities.backgrounds.find((candidate) => candidate === configuredBackground && (nextFormat !== "jpeg" || candidate !== "transparent")) ?? "auto");
    const compression = model.defaultParameters.output_compression;
    setOutputCompression(nextFormat !== "png" && nextCapabilities.supportsCompression && typeof compression === "number" && Number.isInteger(compression) && compression >= 0 && compression <= 100 ? compression : "");
    const defaultQuality = model.defaultParameters.quality;
    setQuality(nextCapabilities.qualities.find((candidate) => candidate === defaultQuality) ?? "auto");
    setImageCount((current) => Math.min(current, nextCapabilities.maxImageCount));
    if (!nextCapabilities.supportsMask) { setMask(null); setMaskEditorSource(null); }
  }

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
  useEffect(() => { referenceSelectionRef.current = { references, characterImageIds, capabilities }; }, [references, characterImageIds, capabilities]);
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
          router.replace(`/sign-in?returnTo=${encodeURIComponent("/imagehub")}`);
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
            const character = (note.characterProfiles ?? []).find((item) => item.role === "primary" && !item.archivedAt)
              ?? (note.characterProfiles ?? []).find((item) => !item.archivedAt);
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
  }, [router, searchParams, sourceCharacterId, sourceNoteId]);

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
    if (submitting) return;
    if (!prompt.trim()) {
      setMessage("请先输入用于测试的提示词。");
      return;
    }
    if (settingsError) { setMessage(settingsError); return; }
    if (!beginAction("generate")) return;
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
        ...(selectedModel ? { modelProfileId: selectedModel.modelProfileId } : {}),
        outputFormat,
        background,
        ...(outputFormat !== "png" && outputCompression !== "" ? { outputCompression } : {}),
      }));
      references.forEach((file) => form.append("references", file));
      if (appliedMask) form.set("mask", appliedMask);
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
      finishAction("generate");
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
          parameters: {
            generationJobId: job.id,
            width: job.width, height: job.height, quality: job.quality,
            modelId: job.modelId ?? job.modelName,
            ...(job.modelProfileId ? { modelProfileId: job.modelProfileId } : {}),
            ...(job.providerType ? { providerType: job.providerType } : {}),
            ...(job.parameters ? { request: job.parameters } : {}),
            ...(job.resultMetadata ? { result: job.resultMetadata } : {}),
            actualImages: images.map((image) => ({ width: image.width, height: image.height, mimeType: image.mimeType })),
          },
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

  async function continueEditing(job: GenerationJob, asset: GenerationAsset) {
    const key = "continue-edit";
    if (!beginAction(key)) return;
    feedback(job.id, "正在载入图片供继续编辑…");
    try {
      if (!capabilities.supportsReferences) throw new Error("当前模型不支持参考图，请先选择支持图片编辑的模型。");
      if (!Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width < 1 || asset.height < 1 || asset.width * asset.height > 40_000_000) throw new Error("这张图片的像素过大，请下载后缩小再继续编辑。");
      const response = await fetch(`/api/v1/generations/${job.id}/assets/${asset.id}/download`, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(apiMessage(await response.json().catch(() => null), "无法读取生成作品。"));
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024) feedback(job.id, "正在将大图压缩为 WebP，保留原始尺寸和透明度…");
      const file = await prepareEditingImage(blob, filenameFromDisposition(response.headers.get("content-disposition"), `edit-${asset.id}.${asset.mimeType.split("/")[1]}`), asset.mimeType);
      const current = referenceSelectionRef.current;
      if (!current.capabilities.supportsReferences) throw new Error("当前模型已切换且不支持参考图，请选择支持图片编辑的模型后重试。");
      if (current.references.length + current.characterImageIds.length >= Math.min(current.capabilities.maxReferenceImages, 4)) {
        throw new Error("参考图已满，请先移除一张图片，再继续编辑。");
      }
      setReferences((files) => [...files, file]);
      setMask(null);
      setMaskEditorSource(null);
      feedback(job.id, "已加入参考图，当前提示词保持原样。请填写修改要求后开始生成。");
      setMessage("已载入生成作品作为参考图，请在 Prompt 中填写这次的修改要求。");
      document.getElementById("imagehub-prompt")?.focus();
    } catch (error) {
      feedback(job.id, error instanceof Error ? error.message : "图片载入失败，请稍后重试。");
    } finally { finishAction(key); }
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
          <p>在笔记本里验证提示词、比较构图并保存作品。任务离开页面后继续执行，生成图保存到所选的站点本地存储或外部图床。</p>
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
          <label className="field"><span>本次生图模型</span><select aria-label="本次生图模型" disabled={loadingModels} value={modelProfileId} onChange={(event) => {
            setModelProfileId(event.target.value);
            const model = models.find((item) => item.modelProfileId === (event.target.value || defaultModelProfileId));
            if (model) applyModelDefaults(model);
            setModelMessage("已切换本次任务模型并载入默认输出设置；请确认画布与质量。");
          }}><option value="">{loadingModels ? "正在加载模型…" : "使用设置中的默认模型"}</option>{models.map((model) => <option key={model.modelProfileId} value={model.modelProfileId}>{model.name}</option>)}</select></label>
          {modelMessage ? <p className="imagehub-option-note">{modelMessage} <Link href="/settings/ai">管理 AI 模型</Link></p> : null}
          {selectedModel ? <p className="imagehub-option-note">{capabilities.label}{!capabilities.known ? <> · 供应商能力尚未验证，请按接口文档选择兼容系列。 <Link href="/settings/ai">调整兼容设置</Link></> : null}</p> : null}
          <label className="field"><span>作品标题（保存笔记时使用）</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="例如：冬夜灯塔实验" /></label>
          <label className="field"><span>Prompt</span><textarea id="imagehub-prompt" aria-label="Prompt" className="imagehub-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={MAX_IMAGE_GENERATION_PROMPT_LENGTH} required placeholder="描述主体、构图、环境、光线、镜头与材质……" /></label>
          <div className="imagehub-inline-actions">
            <button type="button" onClick={() => setReverse({})}>图片反推提示词</button>
            {reverseUndo && prompt === reverseUndo.after.prompt && negativePrompt === reverseUndo.after.negativePrompt ? <button type="button" onClick={() => { setPrompt(reverseUndo.before.prompt); setNegativePrompt(reverseUndo.before.negativePrompt); setReverseUndo(null); setMessage("已恢复反推前的输入。"); }}>撤销图片反推</button> : null}
            {optimizationUndo && prompt === optimizationUndo.after ? <button type="button" onClick={undoOptimization}>撤销 AI 优化</button> : null}
            <button aria-busy={optimization?.status === "loading"} disabled={optimization?.status === "loading"} type="button" onClick={() => void optimizePrompt()}>{optimization?.status === "loading" ? "AI 优化中…" : "✦ AI 优化提示词"}</button>
            <span>{prompt.length.toLocaleString()} / {MAX_IMAGE_GENERATION_PROMPT_LENGTH.toLocaleString()}</span>
          </div>
          <label className="field"><span>负面提示词</span><textarea aria-label="负面提示词" value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} maxLength={20_000} placeholder="watermark, blurry, malformed hands…" /></label>

          {capabilities.supportsCustomSize ? <><fieldset className="imagehub-options"><legend>画布比例</legend><div className="imagehub-segments imagehub-segments--ratios">{imageAspectRatios.map((ratio) => <button aria-pressed={!explicitSize && aspectRatio === ratio.id} key={ratio.id} type="button" onClick={() => { setAspectRatio(ratio.id); setExplicitSize(null); }}><strong>{ratio.label}</strong><small>{ratio.id}</small></button>)}</div></fieldset>
          <fieldset className="imagehub-options"><legend>输出尺寸</legend><div className="imagehub-segments imagehub-segments--resolutions">{imageResolutionTiers.map((tier) => {
            const size = imageSizeFor(aspectRatio, tier.id);
            return <button aria-pressed={!explicitSize && resolution === tier.id} key={tier.id} type="button" onClick={() => { setResolution(tier.id); setExplicitSize(null); }}><strong>{tier.label}</strong><small>{size.width}×{size.height} · {tier.detail}</small></button>;
          })}</div>{explicitSize ? <p className="imagehub-option-note">当前画布 {width}×{height}，可点击比例或尺寸重新选择。</p> : resolution === "4k" ? <p className="imagehub-option-note">4K/最大画布仍属供应商实验能力，生成时间和费用通常会增加；渲染质量可独立选择。</p> : null}</fieldset></> : <fieldset className="imagehub-options"><legend>该模型可用尺寸</legend><div className="imagehub-segments">{capabilities.sizes.map((size) => {
            const [sizeWidth, sizeHeight] = size.split("x").map(Number);
            return <button key={size} type="button" aria-pressed={width === sizeWidth && height === sizeHeight} onClick={() => setExplicitSize({ width: sizeWidth, height: sizeHeight })}><strong>{sizeWidth === sizeHeight ? "方形" : sizeWidth > sizeHeight ? "横版" : "竖版"}</strong><small>{sizeWidth}×{sizeHeight}</small></button>;
          })}</div><p className="imagehub-option-note">当前型号使用固定尺寸，不会自动缩小或改变你的画布。</p></fieldset>}
          <div className="imagehub-settings-row">
            <fieldset><legend>渲染质量</legend><div className={`imagehub-choice${capabilities.qualities.length > 4 ? " imagehub-choice--extended" : ""}`}>{qualityOptions.filter((option) => capabilities.qualities.includes(option.id)).map((option) => <button aria-pressed={quality === option.id} key={option.id} type="button" onClick={() => setQuality(option.id)}><strong>{option.label}</strong><small>{option.detail}</small></button>)}</div></fieldset>
            <label><span>张数</span><select value={imageCount} onChange={(event) => setImageCount(Number(event.target.value))}>{[1, 2, 3, 4].filter((count) => count <= capabilities.maxImageCount).map((count) => <option key={count} value={count}>{count} 张</option>)}</select></label>
          </div>

          <div className="imagehub-output-grid">
            <label className="field"><span>图片格式</span><select aria-label="图片格式" value={outputFormat} onChange={(event) => {
              const format = event.target.value as typeof outputFormat;
              setOutputFormat(format);
              if (format === "jpeg" && background === "transparent") { setBackground("opaque"); setMessage("JPEG 不支持透明背景，已切换为不透明。"); }
            }}>{capabilities.formats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label>
            <label className="field"><span>图片背景</span><select aria-label="图片背景" value={background} onChange={(event) => setBackground(event.target.value as typeof background)}>{capabilities.backgrounds.map((value) => <option key={value} disabled={value === "transparent" && outputFormat === "jpeg"} value={value}>{value === "auto" ? "自动" : value === "opaque" ? "不透明" : "透明"}</option>)}</select></label>
            {outputFormat !== "png" && capabilities.supportsCompression ? <label className="field"><span>压缩质量（0–100）</span><input aria-label="压缩质量" type="number" min={0} max={100} step={1} value={outputCompression} placeholder="默认 90" onChange={(event) => setOutputCompression(event.target.value === "" ? "" : Number(event.target.value))} /></label> : null}
          </div>

          <div className="imagehub-references">
            <div><strong>角色与参考图片</strong><span>AI Model 垫图与本地参考图合计最多 4 张</span></div>
            <p className="imagehub-option-note">上传参考图和蒙版每张最多 10 MiB，整个上传请求合计最多 44 MiB。</p>
            <GenerationCharacterPicker
              selectedProfileId={characterProfileId}
              selectedImageIds={characterImageIds}
              maxImages={Math.max(0, Math.min(4, capabilities.maxReferenceImages) - references.length)}
              onChange={(profileId, imageIds) => {
                setCharacterProfileId(profileId);
                setCharacterImageIds(imageIds);
                setMask(null); setMaskEditorSource(null);
              }}
            />
            {!capabilities.supportsReferences ? <p className="imagehub-option-note">该模型不支持参考图；如已有图片，请先移除或切换模型。</p> : null}
            <label className="imagehub-upload"><input aria-label="上传其他参考图" disabled={!capabilities.supportsReferences} accept="image/jpeg,image/png,image/webp" multiple type="file" onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              const available = Math.max(0, Math.min(4, capabilities.maxReferenceImages) - characterImageIds.length - references.length);
              if (files.some((file) => file.size <= 0 || file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) { setMessage("请选择 JPEG / PNG / WebP 图片，每张须在 10MB 以内。"); event.target.value = ""; return; }
              if (files.length > available) { setMessage(`参考图剩余 ${available} 个位置，请减少选择数量。`); event.target.value = ""; return; }
              setReferences((current) => [...current, ...files]);
              event.target.value = "";
            }} /><span>＋ 上传其他参考图</span></label>
            {referencePreviews.length ? <div className="imagehub-reference-grid">{referencePreviews.map(({ file, url }, index) => <figure key={`${file.name}-${file.lastModified}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`参考图 ${index + 1}`} />
              <figcaption><button type="button" onClick={() => void reverseFrom(file)}>反推 Prompt</button>{index === 0 && capabilities.supportsMask && !characterProfileId ? <button type="button" onClick={() => setMaskEditorSource(file)}>涂抹修改区域</button> : null}<button aria-label={`移除参考图 ${index + 1}`} type="button" onClick={() => {
                if (index === 0) { setMask(null); setMaskEditorSource(null); }
                setReferences((current) => current.filter((candidate) => candidate !== file));
              }}>移除</button></figcaption>
            </figure>)}</div> : null}
            {appliedMask ? <div className="imagehub-mask-status"><span>已设置局部修改区域 · 透明区域会被重绘</span><button type="button" onClick={() => setMask(null)}>清除修改区域</button></div> : null}
            {capabilities.supportsMask && characterProfileId ? <p className="imagehub-option-note">局部涂抹编辑使用第一张上传参考图；请先清除 AI Model 角色选择。</p> : null}
          </div>
          {settingsError ? <p className="imagehub-message" role="alert">{settingsError}</p> : null}
          {message ? <p className="imagehub-message" role="status">{message}</p> : null}
          <button className="imagehub-generate" disabled={submitting || loadingModels || Boolean(settingsError)} type="submit"><span>{submitting ? "正在建立任务…" : loadingModels ? "正在加载模型…" : "开始生成"}</span><small>{width} × {height} · {imageCount} 张</small></button>
        </form>

        <section className="imagehub-results" aria-busy={loadingHistory}>
          <div className="imagehub-results__heading"><div><span className="imagehub-console__label"><span>02</span> 任务胶片墙</span><h3>最近生成</h3></div><button type="button" onClick={() => window.location.reload()}>刷新</button></div>
          {loadingHistory ? <div className="imagehub-empty" role="status">正在显影历史任务…</div> : jobs.length ? <div className="imagehub-jobs">{jobs.map((job) => {
            const results = job.assets.filter((asset) => asset.role === "result");
            return <article className="imagehub-job" data-status={job.status} key={job.id}>
              <header><div><span>{new Date(job.createdAt).toLocaleString("zh-CN")}</span><strong>{statusLabel(job)}</strong></div><small>{job.modelName} · {results.length ? `${results[0].width}×${results[0].height}` : `${job.width}×${job.height}`}</small></header>
              {results.some((asset) => asset.width !== job.width || asset.height !== job.height) ? <p className="imagehub-option-note">请求尺寸 {job.width}×{job.height}；供应商返回的实际尺寸显示在各图片下方。</p> : null}
              {generationUsage(job.resultMetadata) ? <p className="imagehub-option-note">{generationUsage(job.resultMetadata)}</p> : null}
              {activeStatuses.includes(job.status) ? <div className="imagehub-progress"><span style={{ width: `${Math.max(job.progress, 6)}%` }} /></div> : null}
              {results.length ? <div className="imagehub-filmstrip">{results.map((asset, index) => <figure key={asset.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.thumbnailUrl || asset.displayUrl} alt={`生成作品 ${index + 1}`} />
                <span className="imagehub-asset-size">{asset.width}×{asset.height} · {asset.mimeType.replace("image/", "").toUpperCase()}</span>
                <figcaption><button type="button" onClick={() => void reverseFrom(asset)}>反推</button><button aria-busy={pendingActions.has("continue-edit")} disabled={pendingActions.has("continue-edit") || !capabilities.supportsReferences} type="button" onClick={() => void continueEditing(job, asset)}>{pendingActions.has("continue-edit") ? "载入中…" : "继续编辑"}</button><button aria-busy={pendingActions.has(`download:${asset.id}`)} disabled={pendingActions.has(`download:${asset.id}`)} type="button" onClick={() => void downloadAsset(job, asset)}>{pendingActions.has(`download:${asset.id}`) ? "准备中…" : "下载"}</button>{sourceNoteId ? <button aria-busy={pendingActions.has(`cover:${asset.id}`)} disabled={pendingActions.has(`cover:${asset.id}`)} type="button" onClick={() => void attachAsCover(job, asset)}>{pendingActions.has(`cover:${asset.id}`) ? "设置中…" : "设为封面"}</button> : null}</figcaption>
              </figure>)}</div> : <div className="imagehub-placeholder"><span>{job.status === "failed" ? "!" : "◌"}</span><p>{job.errorMessage || "任务正在等待图像结果"}</p></div>}
              {job.characterProfile ? <p className="imagehub-job__character">AI Model · {job.characterProfile.available ? <Link href={`/ai-models/${job.characterProfile.id}`}>{job.characterProfile.name}</Link> : <span>{job.characterProfile.name}（角色卡已删除）</span>} · {job.characterProfile.imageIds.length} 张角色垫图</p> : null}
              <p className="imagehub-job__prompt">{job.prompt}</p>
              {jobFeedback[job.id] ? <p className="imagehub-job__feedback" role="status">{jobFeedback[job.id]}</p> : null}
              <footer>{activeStatuses.includes(job.status) ? <button aria-busy={pendingActions.has(`cancel:${job.id}`)} disabled={pendingActions.has(`cancel:${job.id}`)} type="button" onClick={() => void cancel(job.id)}>{pendingActions.has(`cancel:${job.id}`) ? "取消中…" : "取消任务"}</button> : null}{job.status === "succeeded" ? characterSaveFallbacks.has(job.id) ? <button aria-busy={pendingActions.has(`save:${job.id}`)} disabled={pendingActions.has(`save:${job.id}`) || savedJobs.has(job.id)} type="button" onClick={() => void saveAsNote(job, true)}>{pendingActions.has(`save:${job.id}`) ? "保存中…" : "移除角色关联后保存"}</button> : <button aria-busy={pendingActions.has(`save:${job.id}`)} disabled={pendingActions.has(`save:${job.id}`) || savedJobs.has(job.id)} type="button" onClick={() => void saveAsNote(job)}>{pendingActions.has(`save:${job.id}`) ? "保存中…" : savedJobs.has(job.id) ? "已保存" : "保存为笔记"}</button> : null}<button aria-busy={pendingActions.has(`copy:${job.id}`)} disabled={pendingActions.has(`copy:${job.id}`)} type="button" onClick={() => void copyPrompt(job)}>{pendingActions.has(`copy:${job.id}`) ? "复制中…" : "复制 Prompt"}</button>{!activeStatuses.includes(job.status) ? <button aria-busy={pendingActions.has(`delete:${job.id}`)} disabled={pendingActions.has(`delete:${job.id}`)} type="button" onClick={() => void removeHistory(job)}>{pendingActions.has(`delete:${job.id}`) ? "删除中…" : "删除记录"}</button> : null}</footer>
            </article>;
          })}</div> : <div className="imagehub-empty"><span>NO EXPOSURES YET</span><h3>还没有生成记录</h3><p>从左侧输入第一条提示词，任务会在这里持续更新。</p></div>}
        </section>
      </div>

      {maskEditorSource ? <ImageMaskEditor source={maskEditorSource} onClose={() => setMaskEditorSource(null)} onApply={(file) => { setMask({ source: maskEditorSource, file }); setMaskEditorSource(null); setMessage("已设置修改区域，生成时会与首张参考图一同提交。"); }} /> : null}

      {reverse ? <ReversePromptDialog initialSource={reverse.source} onClose={() => setReverse(null)} onUse={applyReverse} onAnalyzeTerms={(value) => { const id = storePromptHandoff("analyze", value); router.push(`/library?tab=analyze&handoff=${id}`); }} /> : null}

      {optimization ? <PromptOptimizationDialog state={optimization} currentPrompt={prompt} onApply={applyOptimization} onDiscard={discardOptimization} onRetry={(options) => void optimizePrompt(optimization.originalPrompt, options)} /> : null}
    </div>
  );
}
