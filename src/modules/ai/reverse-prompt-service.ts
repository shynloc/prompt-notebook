import { ApiError } from "@/lib/api/errors";

import { decryptCredential } from "@/modules/credentials/credential-crypto";
import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter";
import { selectPreferredModel } from "./model-selection";
import { providerApiError } from "./provider-api-error";
import { AiProviderRegistry } from "./provider-registry";
import { AiProviderError, type AiProviderType } from "./types";
import { parseReversePromptDocument, REVERSE_PROMPT_SYSTEM_INSTRUCTION, reverseOptionsSchema, type ReversePromptOptions } from "./reverse-prompt-structure";

const PURPOSE = "reverse_prompt";
const rateLimiter = new FixedWindowRateLimiter(6, 60_000);

export class ReversePromptService {
  constructor(private readonly providers = new AiProviderRegistry()) {}

  async reverse(userId: string, image: Buffer, mimeType: "image/jpeg" | "image/png" | "image/webp", signal?: AbortSignal, options: ReversePromptOptions = { additionalRequirements: "", language: "zh" }) {
    const validatedOptions = reverseOptionsSchema.parse(options);
    const selection = await selectPreferredModel(userId, [PURPOSE]);
    if (!selection || !selection.connectionEnabled || !selection.modelEnabled) throw new ApiError(422, "AI_REVERSE_PROMPT_NOT_CONFIGURED", "请先配置图片反推模型");
    if (!selection.capabilities.includes(PURPOSE)) throw new ApiError(422, "AI_MODEL_CAPABILITY_MISMATCH", "当前模型不支持图片反推");
    if (!rateLimiter.consume(userId)) throw new ApiError(429, "AI_REVERSE_PROMPT_RATE_LIMITED", "反推请求过于频繁，请稍后再试");
    const adapter = this.providers.get(selection.providerType as AiProviderType);
    if (!adapter.reversePrompt) throw new ApiError(422, "AI_REVERSE_PROMPT_UNSUPPORTED", "当前接口类型不支持图片反推");
    const apiKey = decryptCredential(selection, {
      userId,
      connectionId: selection.connectionId,
      providerType: selection.providerType,
    });
    try {
      const result = await adapter.reversePrompt({
        baseUrl: selection.baseUrl,
        apiKey,
        modelId: selection.modelId,
        image,
        mimeType,
        parameters: selection.defaultParameters,
        systemInstruction: REVERSE_PROMPT_SYSTEM_INSTRUCTION,
        userInstruction: JSON.stringify({ task: "reconstruct_image_prompt", ...validatedOptions }),
        signal,
      });
      if (result.prompt.includes(apiKey)) throw new ApiError(502, "AI_REVERSE_PROMPT_INVALID", "模型返回的反推结果不安全，请重试或更换模型。");
      return { ...parseReversePromptDocument(result.prompt, validatedOptions), model: { id: selection.modelId, name: selection.displayName } };
    } catch (error) {
      if (error instanceof AiProviderError) throw providerApiError(error);
      throw error;
    }
  }
}
