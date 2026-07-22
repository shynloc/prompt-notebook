import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  aiGenerationAssets,
  aiGenerationJobs,
  aiModelProfiles,
  aiProviderConnections,
} from "@/db/schema";
import { decryptCredential } from "@/modules/ai/credential-crypto";
import { AiProviderRegistry } from "@/modules/ai/provider-registry";
import { AiProviderError, type AiProviderType, type AiReferenceImage } from "@/modules/ai/types";

import {
  PicbedGenerationMediaStore,
  type GenerationMediaStore,
  type StoredGenerationAsset,
} from "./generation-media-store";

const HEARTBEAT_INTERVAL_MS = 15_000;

interface GenerationWorkerDependencies {
  providers: AiProviderRegistry;
  media: GenerationMediaStore;
}

export interface GenerationAttemptContext {
  attempt: number;
  maxAttempts: number;
}

type GenerationWorkerResult = {
  status: "skipped" | "cancelled" | "succeeded";
};

class GenerationCancelledError extends Error {
  constructor() {
    super("Generation was cancelled");
    this.name = "GenerationCancelledError";
  }
}

function safeFailure(error: unknown) {
  if (error instanceof AiProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof GenerationCancelledError) {
    return { code: "GENERATION_CANCELLED", message: "Generation was cancelled", retryable: false };
  }
  return {
    code: "GENERATION_PROCESSING_FAILED",
    message: "The generation job could not be completed",
    retryable: true,
  };
}

function storedAsset(asset: typeof aiGenerationAssets.$inferSelect): StoredGenerationAsset {
  if (asset.storageProvider !== "picbed") throw new Error("Unsupported generation storage provider");
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

export class GenerationWorkerProcessor {
  private readonly providers: AiProviderRegistry;
  private readonly media: GenerationMediaStore;

  constructor(dependencies: Partial<GenerationWorkerDependencies> = {}) {
    this.providers = dependencies.providers ?? new AiProviderRegistry();
    this.media = dependencies.media ?? new PicbedGenerationMediaStore();
  }

  async process(jobId: string, context: GenerationAttemptContext): Promise<GenerationWorkerResult> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      return { status: "skipped" };
    }
    const attempt = Math.max(1, Math.trunc(context.attempt));
    const maxAttempts = Math.max(1, Math.trunc(context.maxAttempts));
    const now = new Date();
    const [job] = await db.update(aiGenerationJobs).set({
      status: "running",
      attempts: sql<number>`greatest(${aiGenerationJobs.attempts} + 1, ${attempt})`,
      progress: 5,
      startedAt: now,
      heartbeatAt: now,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    }).where(and(
      eq(aiGenerationJobs.id, jobId),
      eq(aiGenerationJobs.status, "queued"),
      sql`${aiGenerationJobs.attempts} < ${aiGenerationJobs.maxAttempts}`,
    )).returning();

    if (!job) return { status: "skipped" };

    const heartbeat = setInterval(() => {
      void db.update(aiGenerationJobs).set({ heartbeatAt: new Date(), updatedAt: new Date() })
        .where(and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.status, "running")))
        .catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();

    try {
      const selection = await this.loadSelection(job.id, job.userId, job.modelProfileId);
      const adapter = this.providers.get(selection.providerType as AiProviderType);
      if (!adapter.generateImages) {
        throw new AiProviderError(
          "AI_PROVIDER_UNAVAILABLE",
          "The selected provider does not support image generation",
          false,
        );
      }
      const apiKey = decryptCredential(selection, {
        userId: job.userId,
        connectionId: selection.connectionId,
        providerType: selection.providerType,
      });
      const references = await this.loadReferences(job.id, job.userId);
      await this.assertNotCancelled(job.id);
      await this.progress(job.id, 20);

      const result = await adapter.generateImages({
        baseUrl: selection.baseUrl,
        apiKey,
        modelId: job.modelId,
        prompt: job.prompt,
        negativePrompt: job.negativePrompt,
        width: job.width,
        height: job.height,
        quality: job.quality as "standard" | "high",
        imageCount: job.imageCount,
        parameters: job.parameters,
        referenceImages: references,
      });
      await this.assertNotCancelled(job.id);
      if (!result.images.length || result.images.length > job.imageCount) {
        throw new AiProviderError(
          "AI_PROVIDER_RESPONSE_INVALID",
          "AI provider returned an unexpected number of images",
          false,
        );
      }

      const storedResults: StoredGenerationAsset[] = [];
      for (const [ordinal, image] of result.images.entries()) {
        await this.assertNotCancelled(job.id);
        storedResults.push(await this.media.upload(
          job.userId,
          job.id,
          "result",
          ordinal,
          Buffer.from(image.data),
        ));
        await this.progress(job.id, 70 + Math.round(((ordinal + 1) / result.images.length) * 20));
      }

      const completed = await db.transaction(async (transaction) => {
        const [updated] = await transaction.update(aiGenerationJobs).set({
          status: "succeeded",
          progress: 100,
          heartbeatAt: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(aiGenerationJobs.id, job.id),
          eq(aiGenerationJobs.status, "running"),
        )).returning({ id: aiGenerationJobs.id });
        if (!updated) return false;
        await transaction.insert(aiGenerationAssets).values(storedResults.map((asset, ordinal) => ({
          jobId: job.id,
          userId: job.userId,
          role: "result",
          ordinal,
          ...asset,
        })));
        return true;
      });
      if (!completed) return this.finishCancellation(job.id);
      return { status: "succeeded" };
    } catch (error) {
      if (error instanceof GenerationCancelledError || await this.cancellationRequested(job.id)) {
        return this.finishCancellation(job.id);
      }
      const failure = safeFailure(error);
      const canRetry = failure.retryable && job.attempts < Math.min(maxAttempts, job.maxAttempts);
      await db.update(aiGenerationJobs).set({
        status: canRetry ? "queued" : "failed",
        progress: canRetry ? 0 : job.progress,
        heartbeatAt: null,
        finishedAt: canRetry ? null : new Date(),
        errorCode: failure.code,
        errorMessage: failure.message,
        updatedAt: new Date(),
      }).where(and(eq(aiGenerationJobs.id, job.id), eq(aiGenerationJobs.status, "running")));
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async loadSelection(jobId: string, userId: string, modelProfileId: string | null) {
    if (!modelProfileId) {
      throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", "The configured image model is no longer available", false);
    }
    const [selection] = await db.select({
      connectionId: aiProviderConnections.id,
      providerType: aiProviderConnections.providerType,
      baseUrl: aiProviderConnections.baseUrl,
      encryptedSecret: aiProviderConnections.encryptedSecret,
      secretIv: aiProviderConnections.secretIv,
      secretAuthTag: aiProviderConnections.secretAuthTag,
      secretKeyId: aiProviderConnections.secretKeyId,
      capabilities: aiModelProfiles.capabilities,
    }).from(aiModelProfiles)
      .innerJoin(aiProviderConnections, and(
        eq(aiProviderConnections.id, aiModelProfiles.connectionId),
        eq(aiProviderConnections.userId, userId),
      ))
      .where(and(
        eq(aiModelProfiles.id, modelProfileId),
        eq(aiModelProfiles.userId, userId),
        eq(aiModelProfiles.enabled, true),
        eq(aiProviderConnections.enabled, true),
      ))
      .limit(1);
    if (!selection || !selection.capabilities.includes("image_generation")) {
      throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", `The configured image model for job ${jobId} is unavailable`, false);
    }
    return selection;
  }

  private async loadReferences(jobId: string, userId: string): Promise<AiReferenceImage[]> {
    const assets = await db.select().from(aiGenerationAssets).where(and(
      eq(aiGenerationAssets.jobId, jobId),
      eq(aiGenerationAssets.userId, userId),
      eq(aiGenerationAssets.role, "reference"),
    )).orderBy(asc(aiGenerationAssets.ordinal));
    const images: AiReferenceImage[] = [];
    for (const asset of assets) {
      images.push({
        data: await this.media.read(storedAsset(asset)),
        filename: `reference-${asset.ordinal}.${asset.mimeType.split("/")[1] ?? "png"}`,
        mimeType: asset.mimeType,
      });
    }
    return images;
  }

  private async progress(jobId: string, progress: number) {
    await db.update(aiGenerationJobs).set({ progress, heartbeatAt: new Date(), updatedAt: new Date() })
      .where(and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.status, "running")));
  }

  private async assertNotCancelled(jobId: string) {
    if (await this.cancellationRequested(jobId)) throw new GenerationCancelledError();
  }

  private async cancellationRequested(jobId: string) {
    const [job] = await db.select({ status: aiGenerationJobs.status }).from(aiGenerationJobs)
      .where(eq(aiGenerationJobs.id, jobId)).limit(1);
    return !job || job.status === "cancel_requested" || job.status === "cancelled";
  }

  private async finishCancellation(jobId: string): Promise<GenerationWorkerResult> {
    await db.update(aiGenerationJobs).set({
      status: "cancelled",
      progress: 0,
      heartbeatAt: null,
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(and(
      eq(aiGenerationJobs.id, jobId),
      eq(aiGenerationJobs.status, "cancel_requested"),
    ));
    return { status: "cancelled" };
  }
}
