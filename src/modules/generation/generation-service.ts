import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  aiGenerationAssets,
  aiGenerationJobs,
  aiModelPreferences,
  aiModelProfiles,
  aiProviderConnections,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

import { PicbedGenerationMediaStore, type GenerationMediaStore } from "./generation-media-store";
import { BullMqGenerationQueue, type GenerationQueue } from "./generation-queue";
import { createGenerationSchema, type CreateGenerationInput } from "./generation-schema";

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ACTIVE_JOBS_PER_USER = 5;
const MAX_JOBS_PER_MINUTE = 12;
interface GenerationServiceDependencies {
  queue: GenerationQueue;
  media: GenerationMediaStore;
}

function fingerprint(input: ReturnType<typeof createGenerationSchema.parse>, referenceImages: Buffer[]) {
  const referenceHashes = referenceImages.map((data) => createHash("sha256").update(data).digest("hex"));
  return createHash("sha256").update(JSON.stringify({ ...input, referenceHashes })).digest("hex");
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

export class GenerationService {
  private readonly queue: GenerationQueue;
  private readonly media: GenerationMediaStore;

  constructor(dependencies: Partial<GenerationServiceDependencies> = {}) {
    this.queue = dependencies.queue ?? new BullMqGenerationQueue();
    this.media = dependencies.media ?? new PicbedGenerationMediaStore();
  }

  async create(userId: string, rawInput: CreateGenerationInput) {
    const { referenceImages = [], ...fields } = rawInput;
    if (referenceImages.length > 4) throw new ApiError(422, "GENERATION_REFERENCE_LIMIT", "At most 4 reference images are allowed");
    const input = createGenerationSchema.parse(fields);
    const selected = await this.resolveModel(userId, input.modelProfileId);
    const requestFingerprint = fingerprint(input, referenceImages);
    const existing = await this.findByIdempotencyKey(userId, input.idempotencyKey);
    if (existing) return this.replay(userId, existing, requestFingerprint);
    await this.assertWithinQuota(userId);

    const id = randomUUID();
    try {
      await db.insert(aiGenerationJobs).values({
        id,
        userId,
        modelProfileId: selected.modelProfileId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        kind: referenceImages.length ? "image_to_image" : "text_to_image",
        status: "preparing",
        prompt: input.prompt,
        negativePrompt: input.negativePrompt || null,
        modelId: selected.modelId,
        modelName: selected.displayName,
        providerType: selected.providerType,
        width: input.width,
        height: input.height,
        quality: input.quality,
        imageCount: input.imageCount,
        parameters: selected.defaultParameters,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findByIdempotencyKey(userId, input.idempotencyKey);
      if (!raced) throw error;
      return this.replay(userId, raced, requestFingerprint);
    }

    try {
      for (const [ordinal, data] of referenceImages.entries()) {
        const stored = await this.media.upload(userId, id, "reference", ordinal, data);
        await db.insert(aiGenerationAssets).values({ jobId: id, userId, role: "reference", ordinal, ...stored });
      }
    } catch {
      await db.update(aiGenerationJobs).set({
        status: "failed",
        errorCode: "GENERATION_REFERENCE_UPLOAD_FAILED",
        errorMessage: "A reference image could not be stored",
        finishedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(aiGenerationJobs.id, id), eq(aiGenerationJobs.userId, userId)));
      throw new ApiError(422, "GENERATION_REFERENCE_UPLOAD_FAILED", "参考图片上传失败，任务尚未进入队列");
    }

    await db.update(aiGenerationJobs).set({ status: "queued", updatedAt: new Date() })
      .where(and(eq(aiGenerationJobs.id, id), eq(aiGenerationJobs.userId, userId)));
    try {
      await this.queue.enqueue(id, DEFAULT_MAX_ATTEMPTS);
    } catch {
      throw new ApiError(503, "GENERATION_QUEUE_UNAVAILABLE", "生图队列暂时不可用，任务已安全保存并可重新投递");
    }
    return { ...(await this.get(userId, id)), replayed: false };
  }

  async get(userId: string, id: string) {
    const [job] = await db.select().from(aiGenerationJobs)
      .where(and(eq(aiGenerationJobs.id, id), eq(aiGenerationJobs.userId, userId)))
      .limit(1);
    if (!job) throw new ApiError(404, "GENERATION_NOT_FOUND", "Generation job was not found");
    const assets = await db.select().from(aiGenerationAssets)
      .where(and(eq(aiGenerationAssets.jobId, id), eq(aiGenerationAssets.userId, userId)))
      .orderBy(asc(aiGenerationAssets.role), asc(aiGenerationAssets.ordinal));
    return { ...job, assets };
  }

  async list(userId: string, options: { limit: number; status: "all" | "active" | "succeeded" | "failed" | "cancelled" }) {
    const statusCondition = options.status === "active"
      ? inArray(aiGenerationJobs.status, ["preparing", "queued", "running", "cancel_requested"])
      : options.status === "all"
        ? undefined
        : eq(aiGenerationJobs.status, options.status);
    const jobs = await db.select().from(aiGenerationJobs)
      .where(and(eq(aiGenerationJobs.userId, userId), statusCondition))
      .orderBy(desc(aiGenerationJobs.createdAt), desc(aiGenerationJobs.id))
      .limit(Math.min(Math.max(options.limit, 1), 100));
    if (!jobs.length) return [];
    const assets = await db.select().from(aiGenerationAssets).where(and(
      eq(aiGenerationAssets.userId, userId),
      inArray(aiGenerationAssets.jobId, jobs.map((job) => job.id)),
    )).orderBy(asc(aiGenerationAssets.role), asc(aiGenerationAssets.ordinal));
    const byJob = new Map<string, typeof assets>();
    for (const asset of assets) byJob.set(asset.jobId, [...(byJob.get(asset.jobId) ?? []), asset]);
    return jobs.map((job) => ({ ...job, assets: byJob.get(job.id) ?? [] }));
  }

  async cancel(userId: string, id: string) {
    const current = await this.get(userId, id);
    if (["cancelled", "succeeded", "failed"].includes(current.status)) return current;
    const now = new Date();
    if (current.status === "running" || current.status === "cancel_requested") {
      await db.update(aiGenerationJobs).set({
        status: "cancel_requested",
        cancelRequestedAt: current.cancelRequestedAt ?? now,
        updatedAt: now,
      }).where(and(eq(aiGenerationJobs.id, id), eq(aiGenerationJobs.userId, userId)));
    } else {
      await db.update(aiGenerationJobs).set({
        status: "cancelled",
        cancelRequestedAt: now,
        finishedAt: now,
        progress: 0,
        updatedAt: now,
      }).where(and(eq(aiGenerationJobs.id, id), eq(aiGenerationJobs.userId, userId)));
      await this.queue.remove(id).catch(() => undefined);
    }
    return this.get(userId, id);
  }

  async recoverStale(staleBefore: Date) {
    const now = new Date();
    await db.update(aiGenerationJobs).set({
      status: "failed",
      heartbeatAt: null,
      finishedAt: now,
      errorCode: "GENERATION_ATTEMPTS_EXHAUSTED",
      errorMessage: "The generation attempt limit was reached",
      updatedAt: now,
    }).where(and(
      eq(aiGenerationJobs.status, "running"),
      or(isNull(aiGenerationJobs.heartbeatAt), lt(aiGenerationJobs.heartbeatAt, staleBefore)),
      sql`${aiGenerationJobs.attempts} >= ${aiGenerationJobs.maxAttempts}`,
    ));
    const recovered = await db.update(aiGenerationJobs).set({
      status: "queued",
      heartbeatAt: null,
      errorCode: "GENERATION_STALE_RECOVERED",
      errorMessage: "A stale worker lease was recovered",
      updatedAt: new Date(),
    }).where(and(
      eq(aiGenerationJobs.status, "running"),
      or(isNull(aiGenerationJobs.heartbeatAt), lt(aiGenerationJobs.heartbeatAt, staleBefore)),
      sql`${aiGenerationJobs.attempts} < ${aiGenerationJobs.maxAttempts}`,
    )).returning({ id: aiGenerationJobs.id, maxAttempts: aiGenerationJobs.maxAttempts });
    for (const job of recovered) await this.queue.enqueue(job.id, job.maxAttempts);
    return recovered.map((job) => job.id);
  }

  async reconcileQueued(limit = 500) {
    const now = new Date();
    await db.update(aiGenerationJobs).set({
      status: "failed",
      finishedAt: now,
      errorCode: "GENERATION_ATTEMPTS_EXHAUSTED",
      errorMessage: "The generation attempt limit was reached",
      updatedAt: now,
    }).where(and(
      eq(aiGenerationJobs.status, "queued"),
      sql`${aiGenerationJobs.attempts} >= ${aiGenerationJobs.maxAttempts}`,
    ));
    const queued = await db.select({ id: aiGenerationJobs.id, maxAttempts: aiGenerationJobs.maxAttempts })
      .from(aiGenerationJobs)
      .where(and(
        eq(aiGenerationJobs.status, "queued"),
        sql`${aiGenerationJobs.attempts} < ${aiGenerationJobs.maxAttempts}`,
      ))
      .orderBy(asc(aiGenerationJobs.createdAt))
      .limit(Math.min(Math.max(limit, 1), 1_000));
    for (const job of queued) await this.queue.enqueue(job.id, job.maxAttempts);
    return queued.map((job) => job.id);
  }

  async detachModel(userId: string, modelProfileIds: string[]) {
    if (!modelProfileIds.length) return;
    const now = new Date();
    await db.update(aiGenerationJobs).set({
      status: "cancelled",
      cancelRequestedAt: now,
      finishedAt: now,
      errorCode: "GENERATION_MODEL_REMOVED",
      errorMessage: "The configured model was removed",
      updatedAt: now,
    }).where(and(
      eq(aiGenerationJobs.userId, userId),
      inArray(aiGenerationJobs.modelProfileId, modelProfileIds),
      inArray(aiGenerationJobs.status, ["preparing", "queued"]),
    ));
    await db.update(aiGenerationJobs).set({ status: "cancel_requested", cancelRequestedAt: now, updatedAt: now })
      .where(and(
        eq(aiGenerationJobs.userId, userId),
        inArray(aiGenerationJobs.modelProfileId, modelProfileIds),
        inArray(aiGenerationJobs.status, ["running", "cancel_requested"]),
      ));
    await db.update(aiGenerationJobs).set({ modelProfileId: null, updatedAt: now })
      .where(and(eq(aiGenerationJobs.userId, userId), inArray(aiGenerationJobs.modelProfileId, modelProfileIds)));
  }

  async close() {
    await this.queue.close?.();
  }

  private async replay(userId: string, existing: typeof aiGenerationJobs.$inferSelect, requestFingerprint: string) {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new ApiError(409, "GENERATION_IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different request");
    }
    if (existing.status === "queued") await this.queue.enqueue(existing.id, existing.maxAttempts);
    return { ...(await this.get(userId, existing.id)), replayed: true };
  }

  private async assertWithinQuota(userId: string) {
    const [counts] = await db.select({
      active: sql<number>`count(*) filter (where ${aiGenerationJobs.status} in ('preparing', 'queued', 'running', 'cancel_requested'))::int`,
      recent: sql<number>`count(*) filter (where ${aiGenerationJobs.createdAt} >= now() - interval '1 minute')::int`,
    }).from(aiGenerationJobs).where(eq(aiGenerationJobs.userId, userId));
    if (counts.active >= MAX_ACTIVE_JOBS_PER_USER) {
      throw new ApiError(429, "GENERATION_ACTIVE_LIMIT", `At most ${MAX_ACTIVE_JOBS_PER_USER} generation jobs may be active at once`);
    }
    if (counts.recent >= MAX_JOBS_PER_MINUTE) {
      throw new ApiError(429, "GENERATION_RATE_LIMITED", "Too many generation jobs were created; wait a minute and try again");
    }
  }

  private async findByIdempotencyKey(userId: string, idempotencyKey: string) {
    const [job] = await db.select().from(aiGenerationJobs).where(and(
      eq(aiGenerationJobs.userId, userId),
      eq(aiGenerationJobs.idempotencyKey, idempotencyKey),
    )).limit(1);
    return job;
  }

  private async resolveModel(userId: string, modelProfileId?: string) {
    const conditions = [
      eq(aiModelProfiles.userId, userId),
      eq(aiModelProfiles.enabled, true),
      eq(aiProviderConnections.userId, userId),
      eq(aiProviderConnections.enabled, true),
    ];
    const query = db.select({
      modelProfileId: aiModelProfiles.id,
      modelId: aiModelProfiles.modelId,
      displayName: aiModelProfiles.displayName,
      capabilities: aiModelProfiles.capabilities,
      defaultParameters: aiModelProfiles.defaultParameters,
      providerType: aiProviderConnections.providerType,
    }).from(aiModelProfiles)
      .innerJoin(aiProviderConnections, and(
        eq(aiProviderConnections.id, aiModelProfiles.connectionId),
        eq(aiProviderConnections.userId, userId),
      ));
    const rows = modelProfileId
      ? await query.where(and(...conditions, eq(aiModelProfiles.id, modelProfileId))).limit(1)
      : await query.innerJoin(aiModelPreferences, and(
        eq(aiModelPreferences.modelProfileId, aiModelProfiles.id),
        eq(aiModelPreferences.userId, userId),
        eq(aiModelPreferences.purpose, "image_generation"),
      )).where(and(...conditions)).limit(1);
    const selected = rows[0];
    if (!selected) throw new ApiError(422, "GENERATION_MODEL_NOT_CONFIGURED", "请先指定可用的图片生成模型");
    if (!selected.capabilities.includes("image_generation")) {
      throw new ApiError(422, "AI_MODEL_CAPABILITY_MISMATCH", "当前模型不支持图片生成");
    }
    return selected;
  }
}
