import type { PromptOptimizationStructure } from "./prompt-structure-contract";

export const AI_PROVIDER_TYPES = ["openai_compatible"] as const;
export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

export const AI_CAPABILITIES = [
  "prompt_optimization",
  "image_generation",
  "reverse_prompt",
] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const AI_PURPOSES = [
  "prompt_optimization",
  "term_analysis",
  "image_generation",
  "reverse_prompt",
] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

export function capabilityForPurpose(purpose: AiPurpose): AiCapability {
  return purpose === "term_analysis" ? "prompt_optimization" : purpose;
}

export const AI_PROVIDER_ERROR_CODES = [
  "AI_PROVIDER_AUTH_FAILED",
  "AI_PROVIDER_RATE_LIMITED",
  "AI_PROVIDER_QUOTA_EXCEEDED",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_REDIRECT_BLOCKED",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_RESPONSE_INVALID",
] as const;
export type AiProviderErrorCode = (typeof AI_PROVIDER_ERROR_CODES)[number];

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
export interface AiConnectionInput {
  baseUrl: string;
  apiKey: string;
}

export interface AiConnectionTestResult {
  ok: true;
  latencyMs: number;
  availableModelIds: string[];
}

export interface AiPromptOptimizationInput extends AiConnectionInput {
  modelId: string;
  prompt: string;
  systemInstruction: string;
  parameters: Record<string, string | number | boolean>;
  signal?: AbortSignal;
}

export interface AiPromptOptimizationResult {
  optimizedPrompt: string;
}

export interface PromptOptimizationServiceResult {
  optimizedPrompt: string;
  model: { id: string; name: string };
  structure?: PromptOptimizationStructure;
}

export interface AiReferenceImage {
  data: Uint8Array;
  filename: string;
  mimeType: string;
}

export const IMAGE_GENERATION_QUALITIES = ["auto", "low", "medium", "high"] as const;
export type ImageGenerationQuality = (typeof IMAGE_GENERATION_QUALITIES)[number];

export interface AiImageGenerationInput extends AiConnectionInput {
  modelId: string;
  prompt: string;
  negativePrompt?: string | null;
  width: number;
  height: number;
  quality: ImageGenerationQuality;
  imageCount: number;
  parameters: Record<string, string | number | boolean>;
  referenceImages: AiReferenceImage[];
  signal?: AbortSignal;
}

export interface AiImageGenerationResult {
  images: Array<{ data: Uint8Array }>;
}

export interface AiReversePromptInput extends AiConnectionInput {
  modelId: string;
  image: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  parameters: Record<string, string | number | boolean>;
  signal?: AbortSignal;
}

export interface AiReversePromptResult {
  prompt: string;
}

export interface AiProviderAdapter {
  readonly type: AiProviderType;
  testConnection(input: AiConnectionInput): Promise<AiConnectionTestResult>;
  optimizePrompt?(input: AiPromptOptimizationInput): Promise<AiPromptOptimizationResult>;
  generateImages?(input: AiImageGenerationInput): Promise<AiImageGenerationResult>;
  reversePrompt?(input: AiReversePromptInput): Promise<AiReversePromptResult>;
}
