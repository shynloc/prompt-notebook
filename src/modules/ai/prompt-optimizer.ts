import { ApiError } from "@/lib/api/errors";

import { decryptCredential } from "@/modules/credentials/credential-crypto";
import { FixedWindowRateLimiter, type WindowRateLimiter } from "./fixed-window-rate-limiter";
import { selectPreferredModel } from "./model-selection";
import { providerApiError } from "./provider-api-error";
import {
  ADAPTIVE_PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION,
  buildAdaptivePromptUserMessage,
  extractCanonicalLockedFacts,
  normalizePromptStructure,
  parsePromptStructureResponse,
  plainFallbackStructure,
  PromptStructureResponseError,
  type PromptModuleId,
  type PromptOptimizationContext,
  type PromptOptimizationHints,
} from "./prompt-structure";
import { AiProviderRegistry } from "./provider-registry";
import { AiProviderError, type AiProviderType, type PromptOptimizationServiceResult } from "./types";

const OPTIMIZATION_PURPOSE = "prompt_optimization";

export const PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION = ADAPTIVE_PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION;
export const IMAGE_PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION = ADAPTIVE_PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION;

const defaultRateLimiter = new FixedWindowRateLimiter(8, 60_000);

export class PromptOptimizer {
  constructor(
    private readonly providers = new AiProviderRegistry(),
    private readonly rateLimiter: WindowRateLimiter = defaultRateLimiter,
  ) {}

  async optimize(
    userId: string,
    prompt: string,
    signal?: AbortSignal,
    context: PromptOptimizationContext = "auto",
    requestedModules: PromptModuleId[] = [],
    hints: PromptOptimizationHints = {},
  ): Promise<PromptOptimizationServiceResult> {
    const selection = await selectPreferredModel(userId, [OPTIMIZATION_PURPOSE]);

    if (!selection) {
      throw new ApiError(422, "AI_OPTIMIZER_NOT_CONFIGURED", "请先在 AI 助手配置中指定提示词优化模型");
    }
    if (!selection.connectionEnabled || !selection.modelEnabled) {
      throw new ApiError(422, "AI_OPTIMIZER_DISABLED", "当前提示词优化模型已停用");
    }
    if (!selection.capabilities.includes(OPTIMIZATION_PURPOSE)) {
      throw new ApiError(422, "AI_MODEL_CAPABILITY_MISMATCH", "当前模型不支持提示词优化");
    }
    if (!this.rateLimiter.consume(userId)) {
      throw new ApiError(429, "AI_OPTIMIZATION_RATE_LIMITED", "优化请求过于频繁，请稍后再试");
    }

    const adapter = this.providers.get(selection.providerType as AiProviderType);
    if (!adapter.optimizePrompt) {
      throw new ApiError(422, "AI_OPTIMIZATION_UNSUPPORTED", "当前接口类型不支持提示词优化");
    }
    const apiKey = decryptCredential(selection, {
      userId,
      connectionId: selection.connectionId,
      providerType: selection.providerType,
    });
    const lockedFactExtraction = extractCanonicalLockedFacts(prompt);
    const lockedFacts = lockedFactExtraction.facts;
    try {
      const result = await adapter.optimizePrompt({
        baseUrl: selection.baseUrl,
        apiKey,
        modelId: selection.modelId,
        prompt: buildAdaptivePromptUserMessage({ prompt, context, requestedModules, lockedFacts, hints }),
        systemInstruction: ADAPTIVE_PROMPT_OPTIMIZER_SYSTEM_INSTRUCTION,
        parameters: selection.defaultParameters,
        signal,
      });
      const parsed = parsePromptStructureResponse(result.optimizedPrompt);
      const normalized = parsed.kind === "structured"
        ? normalizePromptStructure({
          sourcePrompt: prompt,
          requestedContext: context,
          requestedModules,
          lockedFacts,
          lockedFactsTruncated: lockedFactExtraction.truncated,
          hints,
          model: parsed.value,
        })
        : {
          optimizedPrompt: parsed.optimizedPrompt,
          structure: plainFallbackStructure({
            optimizedPrompt: parsed.optimizedPrompt,
            requestedContext: context,
            requestedModules,
            lockedFacts,
            lockedFactsTruncated: lockedFactExtraction.truncated,
            hints,
          }),
        };
      return {
        optimizedPrompt: normalized.optimizedPrompt,
        model: { id: selection.modelId, name: selection.displayName },
        structure: normalized.structure,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw providerApiError(error);
      if (error instanceof PromptStructureResponseError) {
        throw new ApiError(502, "AI_OPTIMIZATION_INVALID", "AI 返回的优化结果格式无效，请重新尝试");
      }
      throw error;
    }
  }
}
