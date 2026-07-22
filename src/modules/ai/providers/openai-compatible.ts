import { randomBytes } from "node:crypto";

import { MAX_IMAGE_BYTES } from "@/modules/media/image-policy";

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
} from "../types";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 256_000;
const MAX_IMAGE_RESPONSE_BYTES = MAX_IMAGE_BYTES * 6;

type Fetcher = typeof fetch;

interface OpenAiCompatibleOptions {
  fetcher?: Fetcher;
  resolver?: AddressResolver;
  timeoutMs?: number;
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

function statusError(status: number) {
  if (status === 401 || status === 403) {
    return new AiProviderError("AI_PROVIDER_AUTH_FAILED", "AI provider rejected the API key", false);
  }
  if (status === 402) {
    return new AiProviderError("AI_PROVIDER_QUOTA_EXCEEDED", "AI provider quota is unavailable", false);
  }
  if (status === 429) {
    return new AiProviderError("AI_PROVIDER_RATE_LIMITED", "AI provider rate limit was reached", true);
  }
  return new AiProviderError(
    "AI_PROVIDER_UNAVAILABLE",
    `AI provider is unavailable (${status})`,
    status >= 500,
  );
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

export function mapOpenAiImageSize(modelId: string, width: number, height: number) {
  const dallE3 = modelId.toLowerCase().includes("dall-e-3");
  if (width === height) return "1024x1024";
  if (dallE3) return width > height ? "1792x1024" : "1024x1792";
  return width > height ? "1536x1024" : "1024x1536";
}

export function mapOpenAiImageQuality(modelId: string, quality: "standard" | "high") {
  if (modelId.toLowerCase().includes("dall-e-3")) return quality === "high" ? "hd" : "standard";
  return quality === "high" ? "high" : "medium";
}

function generationPrompt(prompt: string, negativePrompt?: string | null) {
  return negativePrompt?.trim() ? `${prompt}\n\nAvoid: ${negativePrompt.trim()}` : prompt;
}

function multipartGenerationBody(input: AiImageGenerationInput, size: string, quality: string) {
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
  field("size", size);
  field("quality", quality);
  field("n", String(input.imageCount));
  field("response_format", "b64_json");
  for (const [index, image] of input.referenceImages.entries()) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference-${index}"\r\nContent-Type: ${image.mimeType}\r\n\r\n`,
      "utf8",
    ));
    chunks.push(Buffer.from(image.data));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function decodeImage(value: string) {
  if (!/^[a-zA-Z0-9+/=_-]+$/.test(value)) {
    throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider returned invalid image data", false);
  }
  const estimatedBytes = Math.floor((value.length * 3) / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider returned an image that is too large", false);
  }
  const data = Buffer.from(value, value.includes("-") || value.includes("_") ? "base64url" : "base64");
  if (!data.length || data.length > MAX_IMAGE_BYTES) {
    throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "AI provider returned unusable image data", false);
  }
  return data;
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
  private readonly timeoutMs: number;

  constructor(options: OpenAiCompatibleOptions = {}) {
    this.fetcher = options.fetcher;
    this.resolver = options.resolver;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generateImages(input: AiImageGenerationInput): Promise<AiImageGenerationResult> {
    const baseUrl = await validateOutboundBaseUrl(input.baseUrl, this.resolver);
    const size = mapOpenAiImageSize(input.modelId, input.width, input.height);
    const quality = mapOpenAiImageQuality(input.modelId, input.quality);
    const multipart = input.referenceImages.length ? multipartGenerationBody(input, size, quality) : null;
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
        size,
        quality,
        n: input.imageCount,
        response_format: "b64_json",
      }),
      redirect: "manual",
      signal: requestSignal(Math.max(this.timeoutMs, 120_000), input.signal),
    };
    let response: Response;
    try {
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
    if (!response.ok) throw statusError(response.status);
    const text = await readLimitedText(response, MAX_IMAGE_RESPONSE_BYTES);
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
    return { images };
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
              content: "Analyze the supplied image and reconstruct a precise, production-ready image-generation prompt. Describe subject, composition, environment, lighting, lens, materials, color, style, and quality details. Return only the prompt in the user's likely language; do not add commentary or Markdown.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Reconstruct the image-generation prompt for this image." },
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
        signal: requestSignal(Math.max(this.timeoutMs, 60_000), input.signal),
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
    if (!response.ok) throw statusError(response.status);
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
        signal: requestSignal(this.timeoutMs, input.signal),
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
    if (!response.ok) throw statusError(response.status);
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
          signal: requestSignal(this.timeoutMs),
        })
        : secureOutboundFetch(url, {
          method: "GET",
          headers: { authorization: `Bearer ${input.apiKey}` },
          signal: requestSignal(this.timeoutMs),
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
    if (!response.ok) throw statusError(response.status);
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
