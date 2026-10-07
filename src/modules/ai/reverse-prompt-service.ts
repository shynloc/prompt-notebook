import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { aiModelPreferences, aiModelProfiles, aiProviderConnections } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

import { decryptCredential } from "./credential-crypto";
import { AiProviderRegistry } from "./provider-registry";
import { AiProviderError, type AiProviderType } from "./types";
import { parseReversePromptDocument, REVERSE_PROMPT_SYSTEM_INSTRUCTION, reverseOptionsSchema, type ReversePromptOptions } from "./reverse-prompt-structure";

const PURPOSE = "reverse_prompt";
const LIMIT = 6;
const WINDOW_MS = 60_000;
const windows = new Map<string, { count: number; startedAt: number }>();

function consume(userId: string) {
  const now = Date.now();
  const current = windows.get(userId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    if (windows.size >= 10_000) {
      for (const [id, window] of windows) if (now - window.startedAt >= WINDOW_MS) windows.delete(id);
    }
    windows.set(userId, { count: 1, startedAt: now });
    return true;
  }
  if (current.count >= LIMIT) return false;
  current.count += 1;
  return true;
}

function providerApiError(error: AiProviderError) {
  const status = error.code === "AI_PROVIDER_RATE_LIMITED"
    ? 429
    : error.code === "AI_PROVIDER_TIMEOUT"
      ? 504
      : error.code === "AI_PROVIDER_AUTH_FAILED" || error.code === "AI_PROVIDER_QUOTA_EXCEEDED"
        ? 422
        : 502;
  return new ApiError(status, error.code, error.message);
}

export class ReversePromptService {
  constructor(private readonly providers = new AiProviderRegistry()) {}

  async reverse(userId: string, image: Buffer, mimeType: "image/jpeg" | "image/png" | "image/webp", signal?: AbortSignal, options: ReversePromptOptions = { additionalRequirements: "", language: "zh" }) {
    const validatedOptions = reverseOptionsSchema.parse(options);
    const [selection] = await db.select({
      modelId: aiModelProfiles.modelId,
      displayName: aiModelProfiles.displayName,
      capabilities: aiModelProfiles.capabilities,
      defaultParameters: aiModelProfiles.defaultParameters,
      connectionId: aiProviderConnections.id,
      providerType: aiProviderConnections.providerType,
      baseUrl: aiProviderConnections.baseUrl,
      encryptedSecret: aiProviderConnections.encryptedSecret,
      secretIv: aiProviderConnections.secretIv,
      secretAuthTag: aiProviderConnections.secretAuthTag,
      secretKeyId: aiProviderConnections.secretKeyId,
    }).from(aiModelPreferences)
      .innerJoin(aiModelProfiles, and(
        eq(aiModelProfiles.id, aiModelPreferences.modelProfileId),
        eq(aiModelProfiles.userId, userId),
        eq(aiModelProfiles.enabled, true),
      ))
      .innerJoin(aiProviderConnections, and(
        eq(aiProviderConnections.id, aiModelProfiles.connectionId),
        eq(aiProviderConnections.userId, userId),
        eq(aiProviderConnections.enabled, true),
      ))
      .where(and(
        eq(aiModelPreferences.userId, userId),
        eq(aiModelPreferences.purpose, PURPOSE),
      ))
      .limit(1);
    if (!selection) throw new ApiError(422, "AI_REVERSE_PROMPT_NOT_CONFIGURED", "请先配置图片反推模型");
    if (!selection.capabilities.includes(PURPOSE)) throw new ApiError(422, "AI_MODEL_CAPABILITY_MISMATCH", "当前模型不支持图片反推");
    if (!consume(userId)) throw new ApiError(429, "AI_REVERSE_PROMPT_RATE_LIMITED", "反推请求过于频繁，请稍后再试");
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
