import { randomBytes } from "node:crypto";

import { MAX_GENERATED_IMAGE_BYTES, MAX_IMAGE_BYTES } from "@/modules/media/image-policy";

import { getImageModelCapabilities, validateImageGenerationSettings, validateImageModelSize } from "../image-capabilities";

import type { AddressResolver } from "../outbound-url-policy";
import { validateOutboundBaseUrl } from "../outbound-url-policy";
import { secureOutboundFetch } from "../secure-outbound-fetch";
import {
  AiProviderError,
  type AiConnectionInput,
  type AiConnectionTestResult,
  type AiImageGenerationInput,
  type AiImageGenerationResult,
  type AiPromptOptimizationInput,
  type AiPromptOptimizationResult,
  type AiReversePromptInput,
  type AiReversePromptResult,
  type AiProviderAdapter,
  type ImageGenerationQuality,
} from "../types";

const DEFAULT_TEXT_TIMEOUT_MS = 60_000;
const DEFAULT_REVERSE_PROMPT_TIMEOUT_MS = 120_000;
const DEFAULT_IMAGE_TIMEOUT_MS = 600_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256_000;
const MAX_ERROR_RESPONSE_BYTES = 32_000;

type Fetcher = typeof fetch;

interface OpenAiCompatibleOptions {
  fetcher?: Fetcher;
  resolver?: AddressResolver;
  timeoutMs?: number;
  imageTimeoutMs?: number;
  reversePromptTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

function configuredTimeout(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= minimum && value <= maximum ? Math.trunc(value) : fallback;
}

function endpoint(baseUrl: URL, path: string) {
  const next = new URL(baseUrl);
  next.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  return next;
}

async function readLimitedBytes(response: Response, limit: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new AiProviderError(
        "AI_PROVIDER_RESPONSE_INVALID",
        "AI provider returned an unexpectedly large response",
        false,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readLimitedText(response: Response, limit = MAX_RESPONSE_BYTES) {
  const bytes = await readLimitedBytes(response, limit);
  return typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
}

function sanitizedProviderDetail(value: unknown, secrets: string[] = []) {
  if (typeof value !== "string") return "";
  let detail = value;
  for (const secret of secrets) {
    if (secret.length >= 4) detail = detail.split(secret).join("[redacted]");
  }
  return detail
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9._-]+/g, "sk-[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 300);
}

async function statusError(response: Response, secrets: string[] = []) {
  const status = response.status;
  let code: AiProviderError["code"] = "AI_PROVIDER_UNAVAILABLE";
  let message = `AI 服务拒绝了请求（HTTP ${status}）`;
  let retryable = status >= 500;
  if (status === 401 || status === 403) {
    code = "AI_PROVIDER_AUTH_FAILED";
    message = "AI 服务拒绝了 API Key";
    retryable = false;
  } else if (status === 402) {
    code = "AI_PROVIDER_QUOTA_EXCEEDED";
    message = "AI 服务余额或配额不足";
    retryable = false;
  } else if (status === 429) {
    code = "AI_PROVIDER_RATE_LIMITED";
    message = "AI 服务请求过于频繁";
    retryable = true;
  }
  try {
    const text = await readLimitedText(response, MAX_ERROR_RESPONSE_BYTES);
    const payload = JSON.parse(text) as { error?: { code?: unknown; type?: unknown; message?: unknown } };
    const providerCode = sanitizedProviderDetail(payload.error?.code ?? payload.error?.type, secrets);
    const providerMessage = sanitizedProviderDetail(payload.error?.message, secrets);
    if (providerMessage) message += `：${providerMessage}`;
    if (providerCode) message += ` [${providerCode}]`;
  } catch {
    await response.body?.cancel().catch(() => undefined);
  }
  const requestId = sanitizedProviderDetail(
    response.headers.get("x-request-id")
      ?? response.headers.get("request-id")
      ?? response.headers.get("cf-ray"),
    secrets,
  );
  if (requestId) message += `（供应商请求 ID：${requestId}）`;
  return new AiProviderError(code, message, retryable);
}

function requestSignal(timeoutMs: number, external?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

function boundedOptimizationParameters(parameters: Record<string, string | number | boolean>) {
  const bounded: Record<string, number> = {};
  const numberInRange = (name: string, minimum: number, maximum: number, integer = false) => {
    const value = parameters[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) return;
    bounded[name] = integer ? Math.trunc(value) : value;
  };
  numberInRange("temperature", 0, 2);
  numberInRange("top_p", 0, 1);
  numberInRange("presence_penalty", -2, 2);
  numberInRange("frequency_penalty", -2, 2);
  numberInRange("max_tokens", 1, 8_192, true);
  numberInRange("max_completion_tokens", 1, 8_192, true);
  numberInRange("seed", -2_147_483_648, 2_147_483_647, true);
  return bounded;
}

export function mapOpenAiImageSize(modelId: string, width: number, height: number, parameters = {}) {
  return validateImageModelSize(getImageModelCapabilities(modelId, parameters), width, height);
}

export function mapOpenAiImageQuality(modelId: string, quality: ImageGenerationQuality, parameters = {}) {
  const capabilities = getImageModelCapabilities(modelId, parameters);
  if (!capabilities.qualities.includes(quality)) {
    throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", `${capabilities.label} 不支持 ${quality} 质量`, false);
  }
  return capabilities.profileId === "dall-e-3" ? quality === "high" ? "hd" : "standard" : quality;
}

function generationPrompt(prompt: string, negativePrompt?: string | null) {
  return negativePrompt?.trim() ? `${prompt}\n\nAvoid: ${negativePrompt.trim()}` : prompt;
}

function multipartGenerationBody(input: AiImageGenerationInput, settings: ReturnType<typeof validateImageGenerationSettings>) {
  const boundary = `prompt-notebook-${randomBytes(16).toString("hex")}`;
  const chunks: Buffer[] = [];
  const field = (name: string, value: string) => {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      "utf8",
    ));
  };
  field("model", input.modelId);
  field("prompt", generationPrompt(input.prompt, input.negativePrompt));
  field("size", settings.size);
  field("quality", settings.quality);
  field("n", String(input.imageCount));
  for (const [name, value] of Object.entries(settings.providerOptions)) field(name, String(value));
  for (const [index, image] of input.referenceImages.entries()) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference-${index}"\r\nContent-Type: ${image.mimeType}\r\n\r\n`,
      "utf8",
    ));
    chunks.push(Buffer.from(image.data));
    chunks.push(Buffer.from("\r\n"));
  }
  if (input.maskImage) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="mask"; filename="mask.png"\r\nContent-Type: image/png\r\n\r\n`,
      "utf8",
    ));
    chunks.push(Buffer.from(input.maskImage.data));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function decodeImage(value: string) {
  const estimatedBytes = Math.floor((value.length * 3) / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  if (estimatedBytes > MAX_GENERATED_IMAGE_BYTES) {
    throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider returned an image that is too large", false);
  }
  if (!value.length || !/^[a-zA-Z0-9+/_-]+={0,2}$/.test(value) || value.length % 4 === 1 || (value.includes("=") && value.length % 4 !== 0)) {
    throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider returned invalid image data", false);
  }
  const data = Buffer.from(value, value.includes("-") || value.includes("_") ? "base64url" : "base64");
  if (!data.length || data.length > MAX_GENERATED_IMAGE_BYTES) {
    throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider returned unusable image data", false);
  }
  return data;
}

const USAGE_COUNT_KEYS = ["total_tokens", "input_tokens", "output_tokens", "text_tokens", "image_tokens", "cached_tokens"] as const;

function boundedUsageCounts(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of USAGE_COUNT_KEYS) {
    const count = record[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000_000_000) safe[key] = count;
  }
  return Object.keys(safe).length ? safe : undefined;
}

function generationMetadata(payload: unknown, settings: ReturnType<typeof validateImageGenerationSettings>) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const metadata: NonNullable<AiImageGenerationResult["metadata"]> = {
    size: settings.size,
    quality: settings.quality,
    outputFormat: settings.outputFormat,
    background: settings.background,
  };
  // Accept only capability values, rather than persisting arbitrary strings from an upstream service.
  if (typeof record.size === "string" && /^\d{1,4}x\d{1,4}$/.test(record.size)) {
    const [width, height] = record.size.split("x").map(Number);
    try { metadata.size = validateImageModelSize(settings.capabilities, width, height); } catch { /* Retain the requested size. */ }
  }
  if (typeof record.quality === "string" && [...settings.capabilities.qualities, "standard", "hd"].includes(record.quality)) metadata.quality = record.quality;
  if (typeof record.output_format === "string" && settings.capabilities.formats.includes(record.output_format as "jpeg")) metadata.outputFormat = record.output_format;
  if (typeof record.background === "string" && settings.capabilities.backgrounds.includes(record.background as "auto")) metadata.background = record.background;
  const usage = boundedUsageCounts(record.usage);
  const usageRecord = record.usage && typeof record.usage === "object" ? record.usage as Record<string, unknown> : {};
  const inputDetails = boundedUsageCounts(usageRecord.input_tokens_details);
  const outputDetails = boundedUsageCounts(usageRecord.output_tokens_details);
  if (usage || inputDetails || outputDetails) {
    metadata.usage = { ...usage, ...(inputDetails ? { input_tokens_details: inputDetails } : {}), ...(outputDetails ? { output_tokens_details: outputDetails } : {}) };
  }
  return metadata;
}

function chatContent(payload: unknown) {
  const choices = typeof payload === "object" && payload !== null && "choices" in payload
    ? (payload as { choices?: unknown }).choices
    : undefined;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = typeof first === "object" && first !== null && "message" in first
    ? (first as { message?: unknown }).message
    : undefined;
  const content = typeof message === "object" && message !== null && "content" in message
    ? (message as { content?: unknown }).content
    : undefined;
  return typeof content === "string" ? content.trim() : "";
}

export class OpenAiCompatibleAdapter implements AiProviderAdapter {
  readonly type = "openai_compatible" as const;
  private readonly fetcher?: Fetcher;
  private readonly resolver?: AddressResolver;
  private readonly textTimeoutMs: number;
  private readonly imageTimeoutMs: number;
  private readonly reversePromptTimeoutMs: number;
  private readonly connectionTimeoutMs: number;

  constructor(options: OpenAiCompatibleOptions = {}) {
    this.fetcher = options.fetcher;
    this.resolver = options.resolver;
    this.textTimeoutMs = options.timeoutMs
      ?? configuredTimeout("AI_TEXT_TIMEOUT_MS", DEFAULT_TEXT_TIMEOUT_MS, 10_000, 300_000);
    this.imageTimeoutMs = options.imageTimeoutMs
      ?? configuredTimeout("AI_IMAGE_TIMEOUT_MS", DEFAULT_IMAGE_TIMEOUT_MS, 120_000, 1_800_000);
    this.reversePromptTimeoutMs = options.reversePromptTimeoutMs
      ?? configuredTimeout("AI_REVERSE_PROMPT_TIMEOUT_MS", DEFAULT_REVERSE_PROMPT_TIMEOUT_MS, 30_000, 600_000);
    this.connectionTimeoutMs = options.connectionTimeoutMs
      ?? options.timeoutMs
      ?? configuredTimeout("AI_CONNECTION_TIMEOUT_MS", DEFAULT_CONNECTION_TIMEOUT_MS, 3_000, 60_000);
  }

  async generateImages(input: AiImageGenerationInput): Promise<AiImageGenerationResult> {
    const settings = validateImageGenerationSettings(input);
    for (const image of [...input.referenceImages, ...(input.maskImage ? [input.maskImage] : [])]) {
      if (!image.data.length || image.data.length > MAX_IMAGE_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)) {
        throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "参考图片和蒙版必须为不超过 10MB 的 PNG、JPEG 或 WebP 图片", false);
      }
    }
    const baseUrl = await validateOutboundBaseUrl(input.baseUrl, this.resolver);
    const multipart = input.referenceImages.length ? multipartGenerationBody(input, settings) : null;
    const url = endpoint(baseUrl, input.referenceImages.length ? "images/edits" : "images/generations");
    const init: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": multipart?.contentType ?? "application/json",
      },
      body: multipart?.body ?? JSON.stringify({
        model: input.modelId,
        prompt: generationPrompt(input.prompt, input.negativePrompt),
        size: settings.size,
        quality: settings.quality,
        n: input.imageCount,
        ...settings.providerOptions,
      }),
      redirect: "manual",
      signal: requestSignal(this.imageTimeoutMs, input.signal),
    };
    let response: Response;
    try {
      response = await (this.fetcher
        ? this.fetcher(url, init)
        : secureOutboundFetch(url, init, { resolver: this.resolver }));
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new AiProviderError(
          "AI_PROVIDER_TIMEOUT",
          "图片生成等待超时。为避免供应商后台重复生成，本任务不会自动重试",
          false,
        );
      }
      throw new AiProviderError(
        "AI_PROVIDER_UNAVAILABLE",
        "生图请求连接中断，供应商可能已接单。为避免重复计费，本任务不会自动重试",
        false,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      throw new AiProviderError("AI_PROVIDER_REDIRECT_BLOCKED", "AI provider redirected the request", false);
    }
    if (!response.ok) throw await statusError(response, [input.apiKey]);
    const maxResponseBytes = Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 * input.imageCount + MAX_RESPONSE_BYTES;
    let text: string;
    try {
      text = await readLimitedText(response, maxResponseBytes);
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      const timeout = error instanceof DOMException && error.name === "TimeoutError";
      throw new AiProviderError(
        timeout ? "AI_PROVIDER_TIMEOUT" : "AI_PROVIDER_UNAVAILABLE",
        "生图结果接收中断，供应商可能已完成生成。为避免重复计费，本任务不会自动重试",
        false,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider returned an invalid response", false);
    }
    const data = typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data?: unknown }).data
      : undefined;
    if (!Array.isArray(data) || !data.length || data.length > input.imageCount) {
      throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider did not return the requested images", false);
    }
    const images = data.map((entry) => {
      const b64 = typeof entry === "object" && entry !== null && "b64_json" in entry
        ? (entry as { b64_json?: unknown }).b64_json
        : undefined;
      if (typeof b64 !== "string") {
        throw new AiProviderError(
          "AI_PROVIDER_RESPONSE_INVALID",
          "AI provider did not return inline image data",
          false,
        );
      }
      return { data: decodeImage(b64) };
    });
    return { images, metadata: generationMetadata(payload, settings) };
  }

  async reversePrompt(input: AiReversePromptInput): Promise<AiReversePromptResult> {
    if (!input.image.length || input.image.length > MAX_IMAGE_BYTES) {
      throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "The source image is invalid", false);
    }
    const baseUrl = await validateOutboundBaseUrl(input.baseUrl, this.resolver);
    const url = endpoint(baseUrl, "chat/completions");
    let response: Response;
    try {
      const init: RequestInit = {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.modelId,
          messages: [
            {
              role: "system",
              content: input.systemInstruction ?? "Analyze the supplied image and reconstruct a precise, production-ready image-generation prompt. Describe subject, composition, environment, lighting, lens, materials, color, style, and quality details. Return only the prompt in the user's likely language; do not add commentary or Markdown.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: input.userInstruction ?? "Reconstruct the image-generation prompt for this image." },
                {
                  type: "image_url",
                  image_url: { url: `data:${input.mimeType};base64,${Buffer.from(input.image).toString("base64")}` },
                },
              ],
            },
          ],
          ...boundedOptimizationParameters(input.parameters),
          stream: false,
        }),
        redirect: "manual",
        signal: requestSignal(this.reversePromptTimeoutMs, input.signal),
      };
      response = await (this.fetcher
        ? this.fetcher(url, init)
        : secureOutboundFetch(url, init, { resolver: this.resolver }));
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new AiProviderError("AI_PROVIDER_TIMEOUT", "AI provider request timed out", true);
      }
      throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider could not be reached", true);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new AiProviderError("AI_PROVIDER_REDIRECT_BLOCKED", "AI provider redirected the request", false);
    }
    if (!response.ok) throw await statusError(response, [input.apiKey]);
    const text = await readLimitedText(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider returned an invalid response", false);
    }
    const prompt = chatContent(payload);
    if (!prompt || prompt.length > 100_000) {
      throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider did not return a usable prompt", false);
    }
    return { prompt };
  }

  async optimizePrompt(input: AiPromptOptimizationInput): Promise<AiPromptOptimizationResult> {
    const baseUrl = await validateOutboundBaseUrl(input.baseUrl, this.resolver);
    let response: Response;
    try {
      const url = endpoint(baseUrl, "chat/completions");
      const init: RequestInit = {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.modelId,
          messages: [
            { role: "system", content: input.systemInstruction },
            { role: "user", content: input.prompt },
          ],
          ...boundedOptimizationParameters(input.parameters),
          stream: false,
        }),
        redirect: "manual",
        signal: requestSignal(this.textTimeoutMs, input.signal),
      };
      response = await (this.fetcher
        ? this.fetcher(url, init)
        : secureOutboundFetch(url, init, { resolver: this.resolver }));
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new AiProviderError("AI_PROVIDER_TIMEOUT", "AI provider request timed out", true);
      }
      throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider could not be reached", true);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new AiProviderError(
        "AI_PROVIDER_REDIRECT_BLOCKED",
        "AI provider redirected the request to an unverified location",
        false,
      );
    }
    if (!response.ok) throw await statusError(response, [input.apiKey]);
    const text = await readLimitedText(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider returned an invalid response", false);
    }
    const optimizedPrompt = chatContent(payload);
    if (!optimizedPrompt || optimizedPrompt.length > 100_000) {
      throw new AiProviderError(
        "AI_PROVIDER_RESPONSE_INVALID",
        "AI provider did not return a usable optimized prompt",
        false,
      );
    }
    return { optimizedPrompt };
  }

  async testConnection(input: AiConnectionInput): Promise<AiConnectionTestResult> {
    const startedAt = performance.now();
    const baseUrl = await validateOutboundBaseUrl(input.baseUrl, this.resolver);
    let response: Response;
    try {
      const url = endpoint(baseUrl, "models");
      response = await (this.fetcher
        ? this.fetcher(url, {
          method: "GET",
          headers: { authorization: `Bearer ${input.apiKey}` },
          redirect: "manual",
          signal: requestSignal(this.connectionTimeoutMs),
        })
        : secureOutboundFetch(url, {
          method: "GET",
          headers: { authorization: `Bearer ${input.apiKey}` },
          signal: requestSignal(this.connectionTimeoutMs),
        }, { resolver: this.resolver }));
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new AiProviderError("AI_PROVIDER_TIMEOUT", "AI provider connection timed out", true);
      }
      throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider could not be reached", true);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new AiProviderError(
        "AI_PROVIDER_REDIRECT_BLOCKED",
        "AI provider redirected the request to an unverified location",
        false,
      );
    }
    if (!response.ok) throw await statusError(response, [input.apiKey]);
    const text = await readLimitedText(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AiProviderError(
        "AI_PROVIDER_RESPONSE_INVALID",
        "AI provider returned an invalid response",
        false,
      );
    }
    const data = typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data?: unknown }).data
      : undefined;
    if (!Array.isArray(data)) {
      throw new AiProviderError(
        "AI_PROVIDER_RESPONSE_INVALID",
        "AI provider did not return a model list",
        false,
      );
    }
    const availableModelIds = data
      .map((model) => typeof model === "object" && model !== null && "id" in model ? (model as { id?: unknown }).id : undefined)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 500);
    return {
      ok: true,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      availableModelIds,
    };
  }
}
