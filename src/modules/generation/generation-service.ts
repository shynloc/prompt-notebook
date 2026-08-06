import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  aiGenerationAssets,
  aiGenerationJobs,
  aiModelPreferences,
  aiModelProfiles,
  aiProviderConnections,
  characterProfileImages,
  characterProfiles,
  generationCharacterReferences,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { REFERENCE_IMAGE_IDENTITY_STRATEGY } from "@/modules/characters/identity-strategy";

import {
  PicbedGenerationMediaStore,
  type GenerationMediaStore,
  type StoredGenerationAsset,
} from "./generation-media-store";
import { BullMqGenerationQueue, type GenerationQueue } from "./generation-queue";
import { createGenerationSchema, type CreateGenerationInput } from "./generation-schema";

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ACTIVE_JOBS_PER_USER = 5;
const MAX_JOBS_PER_MINUTE = 12;
interface GenerationServiceDependencies {
  queue: GenerationQueue;
  media: GenerationMediaStore;
}

type CharacterReference = {
  profileId: string;
  profileImageId: string;
  profileName: string;
  profileVersion: number;
  viewType: string;
  storageProvider: "picbed" | "external";
  objectKey: string;
  displayUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
};

function fingerprint(
  input: ReturnType<typeof createGenerationSchema.parse>,
  referenceImages: Buffer[],
) {
  const referenceHashes = referenceImages.map((data) => createHash("sha256").update(data).digest("hex"));
  return createHash("sha256").update(JSON.stringify({ ...input, referenceHashes })).digest("hex");
}

function legacyFingerprint(
  input: ReturnType<typeof createGenerationSchema.parse>,
  referenceImages: Buffer[],
) {
  const { characterProfileId: _profileId, characterImageIds: _imageIds, ...legacyInput } = input;
  void _profileId;
  void _imageIds;
  const referenceHashes = referenceImages.map((data) => createHash("sha256").update(data).digest("hex"));
  return createHash("sha256").update(JSON.stringify({ ...legacyInput, referenceHashes })).digest("hex");
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
    const existing = await this.findByIdempotencyKey(userId, input.idempotencyKey);
    if (existing) {
      return this.replay(
        userId,
        existing,
        fingerprint(input, referenceImages),
        input.characterProfileId ? undefined : legacyFingerprint(input, referenceImages),
      );
    }
    const characterReferences = await this.resolveCharacterReferences(
      userId,
      input.characterProfileId,
      input.characterImageIds,
    );
    if (referenceImages.length + characterReferences.length > 4) {
      throw new ApiError(422, "GENERATION_REFERENCE_LIMIT", "At most 4 reference images are allowed in total");
    }
    const selected = await this.resolveModel(userId, input.modelProfileId);
    const requestFingerprint = fingerprint(input, referenceImages);

    const id = randomUUID();
    try {
      const raced = await db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`generation:${userId}`}, 0))`);
        const [claimed] = await transaction.select().from(aiGenerationJobs).where(and(
          eq(aiGenerationJobs.userId, userId),
          eq(aiGenerationJobs.idempotencyKey, input.idempotencyKey),
        )).limit(1);
        if (claimed) return claimed;
        if (input.characterProfileId) {
          await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`character:${userId}:${input.characterProfileId}`}, 0))`);
          const [availableProfile] = await transaction.select({ id: characterProfiles.id }).from(characterProfiles).where(and(
            eq(characterProfiles.id, input.characterProfileId),
            eq(characterProfiles.userId, userId),
            isNull(characterProfiles.archivedAt),
            isNull(characterProfiles.deletedAt),
          )).limit(1);
          if (!availableProfile) {
            throw new ApiError(404, "CHARACTER_PROFILE_NOT_FOUND", "The selected AI Model profile was not found");
          }
        }
        const [activeCounts, recentCounts] = await Promise.all([
          transaction.select({ value: sql<number>`count(*)::int` }).from(aiGenerationJobs).where(and(
            eq(aiGenerationJobs.userId, userId),
            sql`${aiGenerationJobs.status} in ('preparing', 'queued', 'running', 'cancel_requested')`,
          )),
          transaction.select({ value: sql<number>`count(*)::int` }).from(aiGenerationJobs).where(and(
            eq(aiGenerationJobs.userId, userId),
            sql`${aiGenerationJobs.createdAt} >= now() - interval '1 minute'`,
          )),
        ]);
        if (activeCounts[0].value >= MAX_ACTIVE_JOBS_PER_USER) {
          throw new ApiError(429, "GENERATION_ACTIVE_LIMIT", `At most ${MAX_ACTIVE_JOBS_PER_USER} generation jobs may be active at once`);
        }
        if (recentCounts[0].value >= MAX_JOBS_PER_MINUTE) {
          throw new ApiError(429, "GENERATION_RATE_LIMITED", "Too many generation jobs were created; wait a minute and try again");
        }
        await transaction.insert(aiGenerationJobs).values({
          id,
          userId,
          modelProfileId: selected.modelProfileId,
          characterProfileId: input.characterProfileId ?? null,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
          kind: referenceImages.length || characterReferences.length ? "image_to_image" : "text_to_image",
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
          heartbeatAt: new Date(),
        });
        return null;
      });
      if (raced) return this.replay(
        userId,
        raced,
        requestFingerprint,
        characterReferences.length ? undefined : legacyFingerprint(input, referenceImages),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findByIdempotencyKey(userId, input.idempotencyKey);
      if (!raced) throw error;
      return this.replay(
        userId,
        raced,
        requestFingerprint,
        characterReferences.length ? undefined : legacyFingerprint(input, referenceImages),
      );
    }

    let characterReferenceImages: Buffer[];
    try {
      characterReferenceImages = await Promise.all(characterReferences.map((reference) => this.media.read({
        storageProvider: reference.storageProvider,
        objectKey: reference.objectKey,
        displayUrl: reference.displayUrl,
        thumbnailUrl: reference.thumbnailUrl,
        mimeType: reference.mimeType,
        width: reference.width,
        height: reference.height,
        sizeBytes: reference.sizeBytes,
      })));
    } catch {
      if (!await this.heartbeatPreparation(userId, id)) {
        throw new ApiError(409, "GENERATION_PREPARATION_CANCELLED", "The generation task stopped while references were being prepared");
      }
      await this.failPreparation(userId, id, "CHARACTER_REFERENCE_UNAVAILABLE", "An AI Model reference image could not be read safely");
      throw new ApiError(422, "CHARACTER_REFERENCE_UNAVAILABLE", "One or more AI Model reference images could not be read safely");
    }

    const prepared: Array<{ ordinal: number; stored: StoredGenerationAsset; character?: CharacterReference }> = [];
    try {
      if (!await this.heartbeatPreparation(userId, id)) {
        throw new ApiError(409, "GENERATION_PREPARATION_CANCELLED", "The generation task was cancelled while references were being prepared");
      }
      for (const [ordinal, reference] of characterReferences.entries()) {
        if (!await this.heartbeatPreparation(userId, id)) {
          throw new ApiError(409, "GENERATION_PREPARATION_CANCELLED", "The generation task was cancelled while references were being prepared");
        }
        const data = characterReferenceImages[ordinal];
        const stored = await this.media.upload(userId, id, "reference", ordinal, data);
        prepared.push({ ordinal, stored, character: reference });
        if (!await this.heartbeatPreparation(userId, id)) {
          throw new ApiError(409, "GENERATION_PREPARATION_CANCELLED", "The generation task was cancelled while references were being prepared");
        }
      }
      for (const [localOrdinal, data] of referenceImages.entries()) {
        if (!await this.heartbeatPreparation(userId, id)) {
          throw new ApiError(409, "GENERATION_PREPARATION_CANCELLED", "The generation task was cancelled while references were being prepared");
        }
        const ordinal = characterReferences.length + localOrdinal;
        const stored = await this.media.upload(userId, id, "reference", ordinal, data);
        prepared.push({ ordinal, stored });
        if (!await this.heartbeatPreparation(userId, id)) {
          throw new ApiError(409, "GENERATION_PREPARATION_CANCELLED", "The generation task was cancelled while references were being prepared");
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "GENERATION_PREPARATION_CANCELLED") throw error;
      await this.failPreparation(userId, id, "GENERATION_REFERENCE_UPLOAD_FAILED", "A reference image could not be stored");
      throw new ApiError(422, "GENERATION_REFERENCE_UPLOAD_FAILED", "参考图片上传失败，任务尚未进入队列");
    }

    let queued: boolean;
    try {
      queued = await db.transaction(async (transaction) => {
        const [transitioned] = await transaction.update(aiGenerationJobs).set({
          status: "queued",
          heartbeatAt: null,
          updatedAt: new Date(),
        }).where(and(
          eq(aiGenerationJobs.id, id),
          eq(aiGenerationJobs.userId, userId),
          eq(aiGenerationJobs.status, "preparing"),
        )).returning({ id: aiGenerationJobs.id });
        if (!transitioned) return false;
        for (const item of prepared) {
          const [asset] = await transaction.insert(aiGenerationAssets).values({
            jobId: id,
            userId,
            role: "reference",
            ordinal: item.ordinal,
            ...item.stored,
          }).returning({ id: aiGenerationAssets.id });
          if (item.character) await transaction.insert(generationCharacterReferences).values({
            jobId: id,
            generationAssetId: asset.id,
            userId,
            profileId: item.character.profileId,
            profileImageId: item.character.profileImageId,
            profileNameSnapshot: item.character.profileName,
            profileVersionSnapshot: item.character.profileVersion,
            viewTypeSnapshot: item.character.viewType,
            role: "primary",
            ordinal: item.ordinal,
            parameters: { identityStrategy: REFERENCE_IMAGE_IDENTITY_STRATEGY },
          });
        }
        return true;
      });
    } catch (error) {
      await this.failPreparation(userId, id, "GENERATION_PREPARATION_PERSIST_FAILED", "Prepared references could not be committed").catch(() => undefined);
      throw error;
    }
    if (!queued) throw new ApiError(409, "GENERATION_PREPARATION_CANCELLED", "The generation task was cancelled while references were being prepared");
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
    const references = await this.characterReferences(userId, [id]);
    const availableProfiles = await this.availableCharacterProfiles(userId, references);
    return { ...job, assets, characterProfile: this.characterProfileForJob(references, id, availableProfiles) };
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
    const references = await this.characterReferences(userId, jobs.map((job) => job.id));
    const availableProfiles = await this.availableCharacterProfiles(userId, references);
    return jobs.map((job) => ({
      ...job,
      assets: byJob.get(job.id) ?? [],
      characterProfile: this.characterProfileForJob(references, job.id, availableProfiles),
    }));
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

  async removeHistory(userId: string, id: string) {
    const current = await this.get(userId, id);
    if (!["cancelled", "succeeded", "failed"].includes(current.status)) {
      throw new ApiError(409, "GENERATION_STILL_ACTIVE", "请先取消仍在运行的生成任务，再删除历史记录");
    }
    await this.queue.remove(id).catch(() => undefined);
    const [deleted] = await db.delete(aiGenerationJobs)
      .where(and(eq(aiGenerationJobs.id, id), eq(aiGenerationJobs.userId, userId)))
      .returning({ id: aiGenerationJobs.id });
    if (!deleted) throw new ApiError(404, "GENERATION_NOT_FOUND", "Generation job was not found");
    return { id: deleted.id, deleted: true };
  }

  async downloadAsset(userId: string, jobId: string, assetId: string) {
    const [asset] = await db.select().from(aiGenerationAssets).where(and(
      eq(aiGenerationAssets.id, assetId),
      eq(aiGenerationAssets.jobId, jobId),
      eq(aiGenerationAssets.userId, userId),
      eq(aiGenerationAssets.role, "result"),
    )).limit(1);
    if (!asset) throw new ApiError(404, "GENERATION_ASSET_NOT_FOUND", "生成图片不存在或已被删除");
    const stored: StoredGenerationAsset = {
      storageProvider: "picbed",
      objectKey: asset.objectKey,
      displayUrl: asset.displayUrl,
      thumbnailUrl: asset.thumbnailUrl,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      sizeBytes: asset.sizeBytes,
    };
    const extension = asset.mimeType === "image/jpeg" ? "jpg" : asset.mimeType === "image/webp" ? "webp" : "png";
    return {
      data: await this.media.read(stored),
      mimeType: asset.mimeType,
      filename: `prompt-notebook-${jobId.slice(0, 8)}-${asset.ordinal + 1}.${extension}`,
    };
  }

  async recoverStale(staleBefore: Date) {
    const now = new Date();
    await db.update(aiGenerationJobs).set({
      status: "failed",
      heartbeatAt: null,
      finishedAt: now,
      errorCode: "GENERATION_PREPARATION_INTERRUPTED",
      errorMessage: "Reference preparation was interrupted and can be retried as a new task",
      updatedAt: now,
    }).where(and(
      eq(aiGenerationJobs.status, "preparing"),
      or(isNull(aiGenerationJobs.heartbeatAt), lt(aiGenerationJobs.heartbeatAt, staleBefore)),
    ));
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

  private async replay(
    userId: string,
    existing: typeof aiGenerationJobs.$inferSelect,
    requestFingerprint: string,
    compatibleLegacyFingerprint?: string,
  ) {
    if (existing.requestFingerprint !== requestFingerprint && existing.requestFingerprint !== compatibleLegacyFingerprint) {
      throw new ApiError(409, "GENERATION_IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different request");
    }
    if (existing.status === "queued") {
      try {
        await this.queue.enqueue(existing.id, existing.maxAttempts);
      } catch {
        throw new ApiError(503, "GENERATION_QUEUE_UNAVAILABLE", "生图队列暂时不可用，任务已安全保存并可重新投递");
      }
    }
    return { ...(await this.get(userId, existing.id)), replayed: true };
  }

  private async heartbeatPreparation(userId: string, id: string) {
    const [updated] = await db.update(aiGenerationJobs).set({ heartbeatAt: new Date(), updatedAt: new Date() }).where(and(
      eq(aiGenerationJobs.id, id),
      eq(aiGenerationJobs.userId, userId),
      eq(aiGenerationJobs.status, "preparing"),
    )).returning({ id: aiGenerationJobs.id });
    return Boolean(updated);
  }

  private async failPreparation(userId: string, id: string, code: string, message: string) {
    await db.update(aiGenerationJobs).set({
      status: "failed",
      heartbeatAt: null,
      errorCode: code,
      errorMessage: message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(aiGenerationJobs.id, id),
      eq(aiGenerationJobs.userId, userId),
      eq(aiGenerationJobs.status, "preparing"),
    ));
  }

  private async findByIdempotencyKey(userId: string, idempotencyKey: string) {
    const [job] = await db.select().from(aiGenerationJobs).where(and(
      eq(aiGenerationJobs.userId, userId),
      eq(aiGenerationJobs.idempotencyKey, idempotencyKey),
    )).limit(1);
    return job;
  }

  private async resolveCharacterReferences(
    userId: string,
    profileId: string | undefined,
    requestedImageIds: string[],
  ): Promise<CharacterReference[]> {
    if (!profileId) return [];
    const [profile] = await db.select({
      id: characterProfiles.id,
      name: characterProfiles.name,
      version: characterProfiles.version,
    }).from(characterProfiles).where(and(
      eq(characterProfiles.id, profileId),
      eq(characterProfiles.userId, userId),
      isNull(characterProfiles.archivedAt),
      isNull(characterProfiles.deletedAt),
    )).limit(1);
    if (!profile) {
      throw new ApiError(404, "CHARACTER_PROFILE_NOT_FOUND", "The selected AI Model profile was not found");
    }

    const rows = await db.select().from(characterProfileImages).where(and(
      eq(characterProfileImages.profileId, profile.id),
      eq(characterProfileImages.userId, userId),
      isNull(characterProfileImages.deletedAt),
      eq(characterProfileImages.status, "ready"),
      requestedImageIds.length ? inArray(characterProfileImages.id, requestedImageIds) : undefined,
    )).orderBy(asc(characterProfileImages.sortOrder));
    const images = requestedImageIds.length
      ? requestedImageIds.map((imageId) => rows.find((row) => row.id === imageId)).filter((row): row is typeof rows[number] => Boolean(row))
      : [rows.find((row) => row.isPrimary) ?? rows.find((row) => row.isCover) ?? rows[0]].filter((row): row is typeof rows[number] => Boolean(row));
    if (!images.length || (requestedImageIds.length && images.length !== requestedImageIds.length)) {
      throw new ApiError(404, "CHARACTER_IMAGE_NOT_FOUND", "One or more selected AI Model images were not found");
    }
    return images.map((image) => ({
      profileId: profile.id,
      profileImageId: image.id,
      profileName: profile.name,
      profileVersion: profile.version,
      viewType: image.viewType,
      storageProvider: image.storageProvider as CharacterReference["storageProvider"],
      objectKey: image.objectKey,
      displayUrl: image.displayUrl,
      thumbnailUrl: image.thumbnailUrl,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      sizeBytes: image.sizeBytes,
    }));
  }

  private async characterReferences(userId: string, jobIds: string[]) {
    if (!jobIds.length) return [];
    return db.select().from(generationCharacterReferences).where(and(
      eq(generationCharacterReferences.userId, userId),
      inArray(generationCharacterReferences.jobId, jobIds),
    )).orderBy(asc(generationCharacterReferences.ordinal));
  }

  private characterProfileForJob(
    references: Array<typeof generationCharacterReferences.$inferSelect>,
    jobId: string,
    availableProfiles: Set<string>,
  ) {
    const selected = references.filter((reference) => reference.jobId === jobId);
    const first = selected[0];
    return first ? {
      id: first.profileId,
      name: first.profileNameSnapshot,
      version: first.profileVersionSnapshot,
      imageIds: selected.map((reference) => reference.profileImageId),
      available: availableProfiles.has(first.profileId),
    } : null;
  }

  private async availableCharacterProfiles(
    userId: string,
    references: Array<typeof generationCharacterReferences.$inferSelect>,
  ) {
    const profileIds = [...new Set(references.map((reference) => reference.profileId))];
    if (!profileIds.length) return new Set<string>();
    const rows = await db.select({ id: characterProfiles.id }).from(characterProfiles).where(and(
      eq(characterProfiles.userId, userId),
      inArray(characterProfiles.id, profileIds),
    ));
    return new Set(rows.map((row) => row.id));
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
    if (!selected) throw new ApiError(422, "GENERATION_MODEL_NOT_CONFIGURED", "请先在 AI 助手设置中添加模型，并将其指定为图片生成模型");
    if (!selected.capabilities.includes("image_generation")) {
      throw new ApiError(422, "AI_MODEL_CAPABILITY_MISMATCH", "当前模型不支持图片生成");
    }
    return selected;
  }
}
