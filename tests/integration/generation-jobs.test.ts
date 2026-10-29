// @vitest-environment node

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { POST as createConfiguration } from "@/app/api/v1/ai/configurations/route";
import { PATCH as patchPreference } from "@/app/api/v1/ai/preferences/route";
import { db } from "@/db/client";
import { aiGenerationAssets, aiGenerationJobs, generationCharacterReferences } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import type { GenerationAssetRole, GenerationMediaStore, StoredGenerationAsset } from "@/modules/generation/generation-media-store";
import type { GenerationQueue } from "@/modules/generation/generation-queue";
import { GenerationService } from "@/modules/generation/generation-service";
import { createGenerationSchema } from "@/modules/generation/generation-schema";
import { GenerationWorkerProcessor } from "@/modules/generation/generation-worker";
import { AiProviderRegistry } from "@/modules/ai/provider-registry";
import { AiProviderError, type AiImageGenerationInput } from "@/modules/ai/types";
import { CharacterService } from "@/modules/characters/character-service";
import { createCharacterProfileSchema } from "@/modules/characters/character-schema";
import { inspectImage } from "@/modules/media/image-policy";

process.env.AI_CREDENTIAL_ENCRYPTION_KEYS = `test:${randomBytes(32).toString("base64url")}`;
process.env.AI_CREDENTIAL_ACTIVE_KEY_ID = "test";

const base = "http://localhost:3000";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function request(url: string, options: { body?: unknown; cookie?: string; method?: string } = {}) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function sessionFor(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await auth.handler(request(`${base}/api/auth/sign-up/email`, { body: { name: label, email, password } }));
  const response = await auth.handler(request(`${base}/api/auth/sign-in/email`, { body: { email, password } }));
  const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("no session");
  const session = await auth.api.getSession({ headers: new Headers({ cookie: `better-auth.session_token=${token}` }) });
  if (!session) throw new Error("no authenticated session");
  return { cookie: `better-auth.session_token=${token}`, userId: session.user.id };
}

async function configureImageModel(cookie: string, secret = "sk-image-secret", options: {
  modelId?: string;
  defaultParameters?: Record<string, string | number | boolean>;
} = {}) {
  const response = await createConfiguration(request(`${base}/api/v1/ai/configurations`, {
    cookie,
    body: {
      name: `Image model ${randomUUID()}`,
      baseUrl: "https://api.example.com/v1",
      apiKey: secret,
      modelId: options.modelId ?? "image-model",
      displayName: "Image Model",
      capabilities: ["image_generation"],
      defaultParameters: options.defaultParameters ?? {},
    },
  }));
  const created = (await response.json()).data;
  await patchPreference(request(`${base}/api/v1/ai/preferences`, {
    cookie,
    method: "PATCH",
    body: { purpose: "image_generation", modelProfileId: created.modelProfileId },
  }));
  return created;
}

class RecordingQueue implements GenerationQueue {
  enqueued: Array<{ jobId: string; maxAttempts: number }> = [];
  removed: string[] = [];

  async enqueue(jobId: string, maxAttempts: number) {
    this.enqueued.push({ jobId, maxAttempts });
  }

  async remove(jobId: string) {
    this.removed.push(jobId);
  }
}

class RecordingMediaStore implements GenerationMediaStore {
  uploads: Array<{ userId: string; jobId: string; role: GenerationAssetRole; ordinal: number; data: Buffer }> = [];
  private readonly stored = new Map<string, Buffer>();

  seed(objectKey: string, data: Buffer) {
    this.stored.set(objectKey, data);
  }

  async upload(userId: string, jobId: string, role: GenerationAssetRole, ordinal: number, data: Buffer): Promise<StoredGenerationAsset> {
    this.uploads.push({ userId, jobId, role, ordinal, data });
    const metadata = await inspectImage(data);
    const extension = metadata.mimeType.split("/")[1];
    const objectKey = `prompt-notebook/test/${jobId}/${role}/${ordinal}.${extension}`;
    this.stored.set(objectKey, data);
    return {
      storageProvider: "picbed",
      objectKey,
      displayUrl: `https://img.example.com/${objectKey}`,
      thumbnailUrl: `https://img.example.com/${objectKey}`,
      ...metadata,
    };
  }

  async read(asset: StoredGenerationAsset) {
    const data = this.stored.get(asset.objectKey);
    if (!data) throw new Error("missing stored test object");
    return data;
  }
}

class UnavailableQueue implements GenerationQueue {
  async enqueue() {
    throw new Error("redis unavailable");
  }

  async remove() {}
}

class BlockingMediaStore extends RecordingMediaStore {
  private releaseUpload: () => void = () => undefined;
  private markUploadStarted: () => void = () => undefined;
  readonly uploadStarted = new Promise<void>((resolve) => { this.markUploadStarted = resolve; });
  private readonly uploadGate = new Promise<void>((resolve) => { this.releaseUpload = resolve; });

  release() {
    this.releaseUpload();
  }

  override async upload(userId: string, jobId: string, role: GenerationAssetRole, ordinal: number, data: Buffer) {
    this.markUploadStarted();
    await this.uploadGate;
    return super.upload(userId, jobId, role, ordinal, data);
  }
}

function input(idempotencyKey: string = randomUUID()) {
  return {
    idempotencyKey,
    prompt: "A lighthouse in a winter storm",
    negativePrompt: "text, watermark",
    width: 1024,
    height: 1024,
    quality: "high" as const,
    imageCount: 1,
  };
}

describe("durable generation jobs", () => {
  it.each([[3840, 2160], [2160, 3840]])("preserves a bare GPT Image 2.5 alias and %ix%i max-quality settings from database to worker", async (width, height) => {
    const owner = await sessionFor(`generation-alias-${width}-${height}`);
    const modelId = "gpt-image-2.5";
    const configuration = await configureImageModel(owner.cookie, "sk-image-secret", {
      modelId,
      defaultParameters: { imageModelFamily: "auto" },
    });
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    const requestInput = { ...input(), width, height, quality: "max" as const };
    const created = await service.create(owner.userId, requestInput);
    const [persisted] = await db.select().from(aiGenerationJobs).where(and(
      eq(aiGenerationJobs.id, created.id),
      eq(aiGenerationJobs.userId, owner.userId),
    ));
    expect(persisted).toMatchObject({
      modelProfileId: configuration.modelProfileId,
      modelId, width, height, quality: "max", status: "queued",
      parameters: { imageModelFamily: "auto", output_format: "jpeg", background: "auto", output_compression: 90 },
    });
    expect(queue.enqueued).toEqual([{ jobId: created.id, maxAttempts: 3 }]);

    // The provider and storage are in-memory fixtures; no image API or image host is contacted.
    const generateImages = vi.fn<(input: AiImageGenerationInput) => Promise<{ images: Array<{ data: Buffer }> }>>(
      async () => ({ images: [{ data: png }] }),
    );
    const processor = new GenerationWorkerProcessor({ media, providers: new AiProviderRegistry([{
      type: "openai_compatible", testConnection: vi.fn(), generateImages,
    }]) });
    await expect(processor.process(created.id, { attempt: 1, maxAttempts: 3 })).resolves.toEqual({ status: "succeeded" });
    expect(generateImages).toHaveBeenCalledTimes(1);
    expect(generateImages).toHaveBeenCalledWith(expect.objectContaining({
      modelId, width, height, quality: "max",
      parameters: { imageModelFamily: "auto", output_format: "jpeg", background: "auto", output_compression: 90 },
      referenceImages: [],
    }));
    expect(await service.get(owner.userId, created.id)).toMatchObject({ modelId, width, height, quality: "max", status: "succeeded" });
  }, 15_000);

  it.each(["xhigh", "max"] as const)("snapshots GPT Image 2.5 %s quality and effective output parameters for the worker", async (quality) => {
    const owner = await sessionFor(`generation-25-${quality}`);
    const modelId = quality === "xhigh" ? "gpt-image-2.5-sunburst" : "gpt-image-2.5-flare";
    await configureImageModel(owner.cookie, "sk-image-secret", {
      modelId,
      defaultParameters: { output_format: "jpeg", background: "opaque", output_compression: 90 },
    });
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    const created = await service.create(owner.userId, {
      ...input(), quality, outputFormat: "webp", background: "transparent", outputCompression: 72,
    });
    expect(created).toMatchObject({
      modelId, quality,
      parameters: { output_format: "webp", background: "transparent", output_compression: 72 },
    });
    const metadata = {
      size: "1024x1024", quality, outputFormat: "webp", background: "transparent",
      usage: { input_tokens: 24, output_tokens: 15, total_tokens: 39 },
    };
    const generateImages = vi.fn(async () => ({ images: [{ data: png }], metadata }));
    const processor = new GenerationWorkerProcessor({ media, providers: new AiProviderRegistry([{
      type: "openai_compatible", testConnection: vi.fn(), generateImages,
    }]) });
    await expect(processor.process(created.id, { attempt: 1, maxAttempts: 3 })).resolves.toEqual({ status: "succeeded" });
    expect(generateImages).toHaveBeenCalledWith(expect.objectContaining({
      modelId, quality,
      parameters: { output_format: "webp", background: "transparent", output_compression: 72 },
    }));
    expect((await service.get(owner.userId, created.id)).resultMetadata).toEqual(metadata);
    expect((await service.list(owner.userId, { limit: 10, status: "succeeded" }))[0].resultMetadata).toEqual(metadata);
  });

  it("persists the PNG mask separately, includes its bytes in idempotency, and loads it for the worker", async () => {
    const owner = await sessionFor("generation-mask-roundtrip");
    await configureImageModel(owner.cookie, "sk-image-secret", { modelId: "gpt-image-2.5-flare" });
    const maskImage = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    const differentMask = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    const requestInput = { ...input(), quality: "max" as const, outputFormat: "png" as const, referenceImages: [png], maskImage };
    const created = await service.create(owner.userId, requestInput);
    expect(created.kind).toBe("image_to_image");
    expect(created.assets.map((asset) => asset.role).sort()).toEqual(["mask", "reference"]);
    expect(media.uploads).toEqual([
      expect.objectContaining({ role: "reference", ordinal: 0, data: png }),
      expect.objectContaining({ role: "mask", ordinal: 0, data: maskImage }),
    ]);
    await expect(service.create(owner.userId, requestInput)).resolves.toMatchObject({ id: created.id, replayed: true });
    await expect(service.create(owner.userId, { ...requestInput, maskImage: differentMask }))
      .rejects.toMatchObject({ status: 409, code: "GENERATION_IDEMPOTENCY_CONFLICT" });
    expect(media.uploads).toHaveLength(2);
    const generateImages = vi.fn(async () => ({ images: [{ data: png }] }));
    const processor = new GenerationWorkerProcessor({ media, providers: new AiProviderRegistry([{
      type: "openai_compatible", testConnection: vi.fn(), generateImages,
    }]) });
    await processor.process(created.id, { attempt: 1, maxAttempts: 3 });
    expect(generateImages).toHaveBeenCalledWith(expect.objectContaining({
      referenceImages: [{ data: png, mimeType: "image/png", filename: "reference-0.png" }],
      maskImage: { data: maskImage, mimeType: "image/png", filename: "mask.png" },
      parameters: { output_format: "png", background: "auto" },
    }));
    expect((await service.get(owner.userId, created.id)).assets.filter((asset) => asset.role === "result")).toHaveLength(1);
  });

  it("rejects wrong-size, non-alpha, non-PNG, and unreferenced masks before storing or queueing anything", async () => {
    const owner = await sessionFor("generation-invalid-mask");
    await configureImageModel(owner.cookie, "sk-image-secret", { modelId: "gpt-image-2.5-flare" });
    const alphaMask = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    const wrongSize = await sharp({ create: { width: 2, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    const noAlpha = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    const jpegMask = await sharp(noAlpha).jpeg().toBuffer();
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    for (const invalid of [
      { referenceImages: [png], maskImage: wrongSize },
      { referenceImages: [png], maskImage: noAlpha },
      { referenceImages: [png], maskImage: jpegMask },
      { referenceImages: [], maskImage: alphaMask },
    ]) {
      await expect(service.create(owner.userId, { ...input(), ...invalid }))
        .rejects.toMatchObject({ status: 422, code: "GENERATION_SETTINGS_INVALID" });
    }
    expect(media.uploads).toHaveLength(0);
    expect(queue.enqueued).toHaveLength(0);
    expect(await db.select().from(aiGenerationJobs).where(eq(aiGenerationJobs.userId, owner.userId))).toHaveLength(0);
  });

  it("normalizes an EXIF-rotated reference to match the browser-sized mask without changing original request idempotency", async () => {
    const owner = await sessionFor("generation-exif-mask");
    await configureImageModel(owner.cookie, "sk-image-secret", { modelId: "gpt-image-2.5-flare" });
    const source = await sharp({ create: { width: 32, height: 16, channels: 3, background: "red" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const maskImage = await sharp({ create: { width: 16, height: 32, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    expect(await sharp(source).metadata()).toMatchObject({ width: 32, height: 16, orientation: 6 });
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue: new RecordingQueue(), media });
    const requestInput = { ...input(), referenceImages: [source], maskImage };
    const created = await service.create(owner.userId, requestInput);
    const reference = created.assets.find((asset) => asset.role === "reference");
    const mask = created.assets.find((asset) => asset.role === "mask");
    expect(reference).toMatchObject({ width: 16, height: 32, mimeType: "image/jpeg" });
    expect(mask).toMatchObject({ width: 16, height: 32, mimeType: "image/png" });
    await expect(service.create(owner.userId, requestInput)).resolves.toMatchObject({ id: created.id, replayed: true });
    expect(media.uploads).toHaveLength(2);
    const generateImages = vi.fn<(input: AiImageGenerationInput) => Promise<{ images: Array<{ data: Buffer }> }>>(async () => ({ images: [{ data: png }] }));
    const processor = new GenerationWorkerProcessor({ media, providers: new AiProviderRegistry([{
      type: "openai_compatible", testConnection: vi.fn(), generateImages,
    }]) });
    await processor.process(created.id, { attempt: 1, maxAttempts: 3 });
    const requestInputAtProvider = generateImages.mock.calls[0][0];
    expect(requestInputAtProvider.referenceImages).toHaveLength(1);
    expect(requestInputAtProvider.referenceImages[0].mimeType).toBe("image/jpeg");
    const normalized = await sharp(Buffer.from(requestInputAtProvider.referenceImages[0].data)).metadata();
    expect(normalized).toMatchObject({ width: 16, height: 32 });
    expect(normalized.orientation ?? 1).toBe(1);
    expect(requestInputAtProvider.maskImage).toMatchObject({ data: maskImage, mimeType: "image/png" });
    expect(await sharp(Buffer.from(requestInputAtProvider.maskImage!.data)).metadata()).toMatchObject({ width: 16, height: 32, hasAlpha: true });
  });

  it("does not regenerate after the provider returned but result storage failed", async () => {
    const owner = await sessionFor("generation-storage-no-regen");
    await configureImageModel(owner.cookie, "sk-image-secret", { modelId: "gpt-image-2.5-sunburst" });
    class FailingResultStore extends RecordingMediaStore {
      override async upload(userId: string, jobId: string, role: GenerationAssetRole, ordinal: number, data: Buffer) {
        if (role === "result") throw new Error("test storage unavailable");
        return super.upload(userId, jobId, role, ordinal, data);
      }
    }
    const queue = new RecordingQueue();
    const media = new FailingResultStore();
    const service = new GenerationService({ queue, media });
    const created = await service.create(owner.userId, { ...input(), quality: "xhigh" });
    const metadata = { quality: "xhigh", usage: { total_tokens: 150 } };
    const generateImages = vi.fn(async () => ({ images: [{ data: png }], metadata }));
    const processor = new GenerationWorkerProcessor({ media, providers: new AiProviderRegistry([{
      type: "openai_compatible", testConnection: vi.fn(), generateImages,
    }]) });
    await expect(processor.process(created.id, { attempt: 1, maxAttempts: 3 })).rejects.toThrow("test storage unavailable");
    const failed = await service.get(owner.userId, created.id);
    expect(failed).toMatchObject({
      status: "failed", attempts: 1, errorCode: "GENERATION_RESULT_STORAGE_FAILED", resultMetadata: metadata,
    });
    expect(failed.errorMessage).toContain("不会自动重新生图");
    expect(failed.assets).toHaveLength(0);
    expect(failed.finishedAt).not.toBeNull();
    await expect(processor.process(created.id, { attempt: 2, maxAttempts: 3 })).resolves.toEqual({ status: "skipped" });
    expect(generateImages).toHaveBeenCalledOnce();
    queue.enqueued = [];
    await service.reconcileQueued();
    expect(queue.enqueued.some((job) => job.jobId === created.id)).toBe(false);
  });

  it.each([0, 2])("retains a provider response error for %i returned images instead of blaming result storage", async (imageCount) => {
    const owner = await sessionFor(`generation-invalid-result-${imageCount}`);
    await configureImageModel(owner.cookie);
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue: new RecordingQueue(), media });
    const created = await service.create(owner.userId, input());
    const generateImages = vi.fn(async () => ({ images: Array.from({ length: imageCount }, () => ({ data: png })) }));
    const processor = new GenerationWorkerProcessor({ media, providers: new AiProviderRegistry([{
      type: "openai_compatible", testConnection: vi.fn(), generateImages,
    }]) });
    await expect(processor.process(created.id, { attempt: 1, maxAttempts: 3 }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_RESPONSE_INVALID", retryable: false });
    expect(await service.get(owner.userId, created.id)).toMatchObject({
      status: "failed", attempts: 1, errorCode: "AI_PROVIDER_RESPONSE_INVALID",
      errorMessage: "AI provider returned an unexpected number of images",
    });
    expect(media.uploads).toHaveLength(0);
    await expect(processor.process(created.id, { attempt: 2, maxAttempts: 3 })).resolves.toEqual({ status: "skipped" });
    expect(generateImages).toHaveBeenCalledOnce();
  });

  it("snapshots owned AI Model images into durable generation references", async () => {
    const owner = await sessionFor("generation-character-owner");
    const other = await sessionFor("generation-character-other");
    await configureImageModel(owner.cookie);
    const characters = new CharacterService();
    const character = await characters.create(owner.userId, createCharacterProfileSchema.parse({
      name: "Mira",
      roleDefinition: "Editorial fashion model",
      images: [{
        storageProvider: "picbed",
        objectKey: "characters/mira/main.png",
        displayUrl: "https://img.example.com/characters/mira/main.png",
        thumbnailUrl: "https://img.example.com/characters/mira/main.png",
        mimeType: "image/png",
        width: 1,
        height: 1,
        sizeBytes: png.length,
        viewType: "portrait",
        isCover: true,
        isPrimary: true,
      }],
    }));
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    media.seed("characters/mira/main.png", png);
    const service = new GenerationService({ queue, media });

    const characterInput = {
      ...input("character-reference-idempotency"),
      characterProfileId: character.id,
      characterImageIds: [character.images[0].id],
    };
    const created = await service.create(owner.userId, characterInput);

    expect(created.characterProfile).toEqual({
      id: character.id,
      name: "Mira",
      version: 1,
      imageIds: [character.images[0].id],
      available: true,
    });
    expect(media.uploads).toHaveLength(1);
    expect(media.uploads[0]).toMatchObject({ role: "reference", ordinal: 0, data: png });
    const provenance = await db.select().from(generationCharacterReferences)
      .where(eq(generationCharacterReferences.jobId, created.id));
    expect(provenance).toHaveLength(1);
    expect(provenance[0]).toMatchObject({
      profileId: character.id,
      profileImageId: character.images[0].id,
      profileNameSnapshot: "Mira",
      viewTypeSnapshot: "portrait",
    });
    media.seed("characters/mira/main.png", Buffer.concat([png, Buffer.from("changed")]));
    await expect(service.create(owner.userId, characterInput))
      .resolves.toMatchObject({ id: created.id, replayed: true });
    await expect(service.create(owner.userId, {
      ...input(),
      characterProfileId: character.id,
      characterImageIds: [character.images[0].id],
      referenceImages: [png, png, png, png],
    })).rejects.toMatchObject({ code: "GENERATION_REFERENCE_LIMIT", status: 422 });
    const trashed = await characters.remove(owner.userId, character.id, character.version);
    await expect(characters.permanentlyRemove(owner.userId, character.id, trashed.version))
      .rejects.toMatchObject({ code: "CHARACTER_PROFILE_IN_USE", status: 409 });
    await expect(service.create(owner.userId, characterInput))
      .resolves.toMatchObject({ id: created.id, replayed: true });
    await expect(service.create(other.userId, {
      ...input(),
      characterProfileId: character.id,
      characterImageIds: [character.images[0].id],
    })).rejects.toMatchObject({ code: "CHARACTER_PROFILE_NOT_FOUND", status: 404 });
    await db.update(aiGenerationJobs).set({ status: "failed", finishedAt: new Date() })
      .where(and(eq(aiGenerationJobs.id, created.id), eq(aiGenerationJobs.userId, owner.userId)));
    await expect(characters.permanentlyRemove(owner.userId, character.id, trashed.version))
      .resolves.toEqual({ id: character.id, deleted: true, permanent: true });
    await expect(characters.get(owner.userId, character.id, true))
      .rejects.toMatchObject({ code: "CHARACTER_PROFILE_NOT_FOUND", status: 404 });
    await expect(service.get(owner.userId, created.id))
      .resolves.toMatchObject({ characterProfile: { id: character.id, name: "Mira", available: false } });
  });

  it("isolates owners, deduplicates requests, and uploads references before queueing only a job id", async () => {
    const owner = await sessionFor("generation-owner");
    const other = await sessionFor("generation-other");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    const requestInput = { ...input("same-request"), referenceImages: [png] };

    const created = await service.create(owner.userId, requestInput);
    const replayed = await service.create(owner.userId, requestInput);
    expect(replayed.id).toBe(created.id);
    expect(replayed.replayed).toBe(true);
    expect(media.uploads[0]).toMatchObject({ role: "reference", jobId: created.id });
    expect(queue.enqueued).toEqual([
      { jobId: created.id, maxAttempts: 3 },
      { jobId: created.id, maxAttempts: 3 },
    ]);
    expect(JSON.stringify(queue.enqueued)).not.toContain(png.toString("base64"));

    await expect(service.create(owner.userId, { ...requestInput, prompt: "different request" }))
      .rejects.toMatchObject({ code: "GENERATION_IDEMPOTENCY_CONFLICT", status: 409 });
    await expect(service.get(other.userId, created.id))
      .rejects.toMatchObject({ code: "GENERATION_NOT_FOUND", status: 404 });

    const [storedJob] = await db.select().from(aiGenerationJobs).where(eq(aiGenerationJobs.id, created.id));
    const storedAssets = await db.select().from(aiGenerationAssets).where(eq(aiGenerationAssets.jobId, created.id));
    expect(storedJob.status).toBe("queued");
    expect(storedAssets).toHaveLength(1);
    expect(JSON.stringify({ storedJob, storedAssets })).not.toContain(png.toString("base64"));

    const second = await service.create(owner.userId, input());
    await expect(db.insert(generationCharacterReferences).values({
      jobId: second.id,
      generationAssetId: storedAssets[0].id,
      userId: owner.userId,
      profileId: randomUUID(),
      profileImageId: randomUUID(),
      profileNameSnapshot: "Mismatched provenance",
      profileVersionSnapshot: 1,
      viewTypeSnapshot: "other",
      role: "primary",
      ordinal: 0,
      parameters: {},
    })).rejects.toMatchObject({ cause: { code: "23503" } });
  });

  it("claims a job once and stores successful output only through the media store", async () => {
    const owner = await sessionFor("generation-success");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    const created = await service.create(owner.userId, input());
    const generateImages = vi.fn(async (requestInput: { apiKey: string }) => {
      expect(requestInput.apiKey).toBe("sk-image-secret");
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { images: [{ data: png }] };
    });
    const processor = new GenerationWorkerProcessor({
      media,
      providers: new AiProviderRegistry([{
        type: "openai_compatible",
        testConnection: vi.fn(),
        generateImages,
      }]),
    });

    const results = await Promise.all([
      processor.process(created.id, { attempt: 1, maxAttempts: 3 }),
      processor.process(created.id, { attempt: 1, maxAttempts: 3 }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["skipped", "succeeded"]);
    expect(generateImages).toHaveBeenCalledOnce();
    expect(media.uploads.filter((upload) => upload.role === "result")).toHaveLength(1);
    const job = await service.get(owner.userId, created.id);
    expect(job.status).toBe("succeeded");
    expect(job.assets).toHaveLength(1);
    expect(JSON.stringify(job)).not.toContain(png.toString("base64"));
    await expect(service.downloadAsset(owner.userId, created.id, job.assets[0].id))
      .resolves.toMatchObject({ data: png, mimeType: "image/png", filename: expect.stringMatching(/\.png$/) });
    await expect(service.downloadAsset("not-the-owner", created.id, job.assets[0].id))
      .rejects.toMatchObject({ code: "GENERATION_ASSET_NOT_FOUND", status: 404 });
  });

  it("records retryable failures and stops after the configured attempt limit", async () => {
    const owner = await sessionFor("generation-retry");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    const created = await service.create(owner.userId, input());
    const processor = new GenerationWorkerProcessor({
      media,
      providers: new AiProviderRegistry([{
        type: "openai_compatible",
        testConnection: vi.fn(),
        generateImages: vi.fn(async () => {
          throw new AiProviderError("AI_PROVIDER_RATE_LIMITED", "provider is busy", true);
        }),
      }]),
    });

    await expect(processor.process(created.id, { attempt: 1, maxAttempts: 3 })).rejects.toThrow("provider is busy");
    expect((await service.get(owner.userId, created.id)).status).toBe("queued");
    await expect(processor.process(created.id, { attempt: 3, maxAttempts: 3 })).rejects.toThrow("provider is busy");
    const failed = await service.get(owner.userId, created.id);
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(3);
    expect(failed.errorCode).toBe("AI_PROVIDER_RATE_LIMITED");
  });

  it("honors cancellation while a provider request is running and stores no result", async () => {
    const owner = await sessionFor("generation-cancel");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    const created = await service.create(owner.userId, input());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started: () => void = () => undefined;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const processor = new GenerationWorkerProcessor({
      media,
      providers: new AiProviderRegistry([{
        type: "openai_compatible",
        testConnection: vi.fn(),
        generateImages: vi.fn(async () => {
          started();
          await gate;
          return { images: [{ data: png }] };
        }),
      }]),
    });

    const processing = processor.process(created.id, { attempt: 1, maxAttempts: 3 });
    await providerStarted;
    expect((await service.cancel(owner.userId, created.id)).status).toBe("cancel_requested");
    release();
    await expect(processing).resolves.toMatchObject({ status: "cancelled" });
    expect((await service.get(owner.userId, created.id)).status).toBe("cancelled");
    expect(media.uploads.filter((upload) => upload.role === "result")).toHaveLength(0);
  });

  it("does not let a stale queued cancellation snapshot overwrite a concurrently completed job", async () => {
    const owner = await sessionFor("generation-cancel-completed-race");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const service = new GenerationService({ queue, media: new RecordingMediaStore() });
    const created = await service.create(owner.userId, input());
    const staleQueued = await service.get(owner.userId, created.id);
    const startedAt = new Date();
    await db.update(aiGenerationJobs).set({ status: "running", attempts: 1, startedAt, heartbeatAt: startedAt })
      .where(eq(aiGenerationJobs.id, created.id));
    await db.update(aiGenerationJobs).set({ status: "succeeded", progress: 100, finishedAt: new Date(), heartbeatAt: null })
      .where(eq(aiGenerationJobs.id, created.id));

    const realGet = service.get.bind(service);
    // The stale read is only a pre-update snapshot. A final read after an atomic
    // state update must still observe the real database, not this fixture.
    const updateObserver = vi.spyOn(db, "update");
    const staleRead = vi.spyOn(service, "get").mockImplementation(async (userId, id) => {
      if (!updateObserver.mock.calls.length) return staleQueued;
      return realGet(userId, id);
    });
    try {
      const result = await service.cancel(owner.userId, created.id);
      expect(result.status).toBe("succeeded");
      expect(await realGet(owner.userId, created.id)).toMatchObject({ status: "succeeded", progress: 100, attempts: 1 });
      expect(queue.removed).not.toContain(created.id);
    } finally {
      staleRead.mockRestore();
      updateObserver.mockRestore();
    }
  });

  it("replays pre-character idempotency fingerprints and consistently maps queue outages", async () => {
    const owner = await sessionFor("generation-legacy-idempotency");
    await configureImageModel(owner.cookie);
    const requestInput = input("legacy-request");
    const service = new GenerationService({ queue: new RecordingQueue(), media: new RecordingMediaStore() });
    const created = await service.create(owner.userId, requestInput);
    const parsed = createGenerationSchema.parse(requestInput);
    const { characterProfileId: _profileId, characterImageIds: _imageIds, ...legacyInput } = parsed;
    void _profileId;
    void _imageIds;
    const legacy = createHash("sha256").update(JSON.stringify({ ...legacyInput, referenceHashes: [] })).digest("hex");
    await db.update(aiGenerationJobs).set({ requestFingerprint: legacy })
      .where(and(eq(aiGenerationJobs.id, created.id), eq(aiGenerationJobs.userId, owner.userId)));

    await expect(service.create(owner.userId, requestInput))
      .resolves.toMatchObject({ id: created.id, replayed: true });
    await expect(new GenerationService({ queue: new UnavailableQueue(), media: new RecordingMediaStore() })
      .create(owner.userId, requestInput))
      .rejects.toMatchObject({ code: "GENERATION_QUEUE_UNAVAILABLE", status: 503 });
  });

  it("does not revive a task cancelled while reference snapshots are uploading", async () => {
    const owner = await sessionFor("generation-cancel-preparing");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const media = new BlockingMediaStore();
    const service = new GenerationService({ queue, media });
    const requestInput = { ...input(), referenceImages: [png] };
    const creating = service.create(owner.userId, requestInput);
    await media.uploadStarted;
    const [preparing] = await db.select().from(aiGenerationJobs).where(and(
      eq(aiGenerationJobs.userId, owner.userId),
      eq(aiGenerationJobs.status, "preparing"),
    ));
    expect(preparing).toBeDefined();
    await expect(service.create(owner.userId, requestInput))
      .resolves.toMatchObject({ id: preparing.id, status: "preparing", replayed: true });
    expect((await service.cancel(owner.userId, preparing.id)).status).toBe("cancelled");
    media.release();
    await expect(creating).rejects.toMatchObject({ code: "GENERATION_PREPARATION_CANCELLED", status: 409 });
    expect((await service.get(owner.userId, preparing.id)).status).toBe("cancelled");
    expect(queue.enqueued).toHaveLength(0);
    expect(await db.select().from(aiGenerationAssets).where(eq(aiGenerationAssets.jobId, preparing.id))).toHaveLength(0);
  });

  it("blocks permanent character deletion while its first reference snapshot is still preparing", async () => {
    const owner = await sessionFor("generation-character-preparing-delete");
    await configureImageModel(owner.cookie);
    const characters = new CharacterService();
    const character = await characters.create(owner.userId, createCharacterProfileSchema.parse({
      name: "Preparing model",
      roleDefinition: "Must remain available until preparation stops",
      images: [{
        storageProvider: "picbed",
        objectKey: "characters/preparing/main.png",
        displayUrl: "https://img.example.com/characters/preparing/main.png",
        thumbnailUrl: "https://img.example.com/characters/preparing/main.png",
        mimeType: "image/png",
        width: 1,
        height: 1,
        sizeBytes: png.length,
        isPrimary: true,
      }],
    }));
    const media = new BlockingMediaStore();
    media.seed("characters/preparing/main.png", png);
    const service = new GenerationService({ queue: new RecordingQueue(), media });
    const requestInput = {
      ...input(),
      characterProfileId: character.id,
      characterImageIds: [character.images[0].id],
    };
    const creating = service.create(owner.userId, requestInput);
    await media.uploadStarted;
    const [preparing] = await db.select().from(aiGenerationJobs).where(and(
      eq(aiGenerationJobs.userId, owner.userId),
      eq(aiGenerationJobs.characterProfileId, character.id),
      eq(aiGenerationJobs.status, "preparing"),
    ));
    expect(preparing).toBeDefined();
    await expect(service.create(owner.userId, requestInput))
      .resolves.toMatchObject({ id: preparing.id, status: "preparing", replayed: true });
    expect(await db.select().from(generationCharacterReferences)
      .where(eq(generationCharacterReferences.jobId, preparing.id))).toHaveLength(0);

    const trashed = await characters.remove(owner.userId, character.id, character.version);
    await expect(characters.permanentlyRemove(owner.userId, character.id, trashed.version))
      .rejects.toMatchObject({ code: "CHARACTER_PROFILE_IN_USE", status: 409 });
    await service.cancel(owner.userId, preparing.id);
    media.release();
    await expect(creating).rejects.toMatchObject({ code: "GENERATION_PREPARATION_CANCELLED", status: 409 });
    await expect(characters.permanentlyRemove(owner.userId, character.id, trashed.version))
      .resolves.toEqual({ id: character.id, deleted: true, permanent: true });
  });

  it("deletes terminal history and cascades its database assets", async () => {
    const owner = await sessionFor("generation-delete-history");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const service = new GenerationService({ queue, media: new RecordingMediaStore() });
    const created = await service.create(owner.userId, { ...input(), referenceImages: [png] });
    await expect(service.removeHistory(owner.userId, created.id))
      .rejects.toMatchObject({ code: "GENERATION_STILL_ACTIVE", status: 409 });
    await db.update(aiGenerationJobs).set({ status: "failed", finishedAt: new Date() })
      .where(and(eq(aiGenerationJobs.id, created.id), eq(aiGenerationJobs.userId, owner.userId)));

    await expect(service.removeHistory(owner.userId, created.id))
      .resolves.toEqual({ id: created.id, deleted: true });
    expect(queue.removed).toContain(created.id);
    expect(await db.select().from(aiGenerationJobs).where(eq(aiGenerationJobs.id, created.id))).toHaveLength(0);
    expect(await db.select().from(aiGenerationAssets).where(eq(aiGenerationAssets.jobId, created.id))).toHaveLength(0);
  });

  it("fails stale running jobs as provider-state unknown without requeueing, while queued and preparation recovery remain safe", async () => {
    const owner = await sessionFor("generation-recovery");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    const created = await service.create(owner.userId, input());
    queue.enqueued = [];
    await db.update(aiGenerationJobs).set({
      status: "running",
      attempts: 1,
      heartbeatAt: new Date(Date.now() - 10 * 60_000),
      startedAt: new Date(Date.now() - 11 * 60_000),
    }).where(and(eq(aiGenerationJobs.id, created.id), eq(aiGenerationJobs.userId, owner.userId)));

    const recovered = await service.recoverStale(new Date(Date.now() - 5 * 60_000));
    expect(recovered).toContain(created.id);
    expect(queue.enqueued).toHaveLength(0);
    expect(await service.get(owner.userId, created.id)).toMatchObject({
      status: "failed", errorCode: "GENERATION_PROVIDER_STATE_UNKNOWN", attempts: 1, heartbeatAt: null,
    });
    const generateImages = vi.fn();
    const processor = new GenerationWorkerProcessor({ media, providers: new AiProviderRegistry([{
      type: "openai_compatible", testConnection: vi.fn(), generateImages,
    }]) });
    await expect(processor.process(created.id, { attempt: 2, maxAttempts: 3 })).resolves.toEqual({ status: "skipped" });
    expect(generateImages).not.toHaveBeenCalled();

    const interrupted = await service.create(owner.userId, { ...input(), prompt: "Interrupted preparation" });
    await db.update(aiGenerationJobs).set({
      status: "preparing",
      heartbeatAt: new Date(Date.now() - 10 * 60_000),
    }).where(and(eq(aiGenerationJobs.id, interrupted.id), eq(aiGenerationJobs.userId, owner.userId)));
    await service.recoverStale(new Date(Date.now() - 5 * 60_000));
    const recoveredPreparation = await service.get(owner.userId, interrupted.id);
    expect(recoveredPreparation).toMatchObject({
      status: "failed",
      errorCode: "GENERATION_PREPARATION_INTERRUPTED",
    });

    const fresh = await service.create(owner.userId, { ...input(), prompt: "Fresh preparation" });
    await db.update(aiGenerationJobs).set({ status: "preparing", heartbeatAt: new Date() }).where(eq(aiGenerationJobs.id, fresh.id));
    const queued = await service.create(owner.userId, { ...input(), prompt: "Recover a safely queued request" });
    const exhausted = await service.create(owner.userId, { ...input(), prompt: "Exhausted stale provider request" });
    await db.update(aiGenerationJobs).set({ status: "running", attempts: 3, heartbeatAt: null }).where(eq(aiGenerationJobs.id, exhausted.id));
    queue.enqueued = [];
    await service.recoverStale(new Date(Date.now() - 5 * 60_000));
    expect((await service.get(owner.userId, fresh.id)).status).toBe("preparing");
    expect(await service.get(owner.userId, exhausted.id)).toMatchObject({ status: "failed", errorCode: "GENERATION_ATTEMPTS_EXHAUSTED" });
    expect(await service.reconcileQueued()).toContain(queued.id);
    expect(queue.enqueued).toContainEqual({ jobId: queued.id, maxAttempts: 3 });
    expect(queue.enqueued.some((job) => [created.id, interrupted.id, fresh.id, exhausted.id].includes(job.jobId))).toBe(false);
    expect((await service.get(owner.userId, queued.id)).status).toBe("queued");
  });

  it("finishes stale cancellation requests so history can be removed while leaving a fresh cancellation active", async () => {
    const owner = await sessionFor("generation-stale-cancellation");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const service = new GenerationService({ queue, media: new RecordingMediaStore() });
    const stale = await service.create(owner.userId, { ...input(), prompt: "Stale cancellation request" });
    const fresh = await service.create(owner.userId, { ...input(), prompt: "Fresh cancellation request" });
    const oldHeartbeat = new Date(Date.now() - 10 * 60_000);
    await db.update(aiGenerationJobs).set({
      status: "cancel_requested", attempts: 1, cancelRequestedAt: oldHeartbeat, heartbeatAt: oldHeartbeat, updatedAt: oldHeartbeat,
    }).where(eq(aiGenerationJobs.id, stale.id));
    await db.update(aiGenerationJobs).set({
      status: "cancel_requested", attempts: 1, cancelRequestedAt: new Date(), heartbeatAt: new Date(), updatedAt: new Date(),
    }).where(eq(aiGenerationJobs.id, fresh.id));

    await service.recoverStale(new Date(Date.now() - 5 * 60_000));
    const cancelled = await service.get(owner.userId, stale.id);
    expect(cancelled).toMatchObject({ status: "cancelled", heartbeatAt: null });
    expect(cancelled.finishedAt).not.toBeNull();
    expect((await service.get(owner.userId, fresh.id)).status).toBe("cancel_requested");
    await expect(service.removeHistory(owner.userId, stale.id)).resolves.toEqual({ id: stale.id, deleted: true });
    expect(queue.removed).toContain(stale.id);
    expect(await db.select().from(aiGenerationJobs).where(eq(aiGenerationJobs.id, stale.id))).toHaveLength(0);
    await expect(service.removeHistory(owner.userId, fresh.id)).rejects.toMatchObject({ code: "GENERATION_STILL_ACTIVE", status: 409 });
  });

  it("limits active jobs per owner while allowing another owner to generate", async () => {
    const owner = await sessionFor("generation-quota-owner");
    const other = await sessionFor("generation-quota-other");
    await configureImageModel(owner.cookie);
    await configureImageModel(other.cookie);
    const queue = new RecordingQueue();
    const service = new GenerationService({ queue, media: new RecordingMediaStore() });
    for (let index = 0; index < 5; index += 1) {
      await service.create(owner.userId, { ...input(), prompt: `Owner task ${index}` });
    }
    await expect(service.create(owner.userId, { ...input(), prompt: "Owner task over limit" }))
      .rejects.toMatchObject({ code: "GENERATION_ACTIVE_LIMIT", status: 429 });
    await expect(service.create(other.userId, { ...input(), prompt: "Other owner task" }))
      .resolves.toMatchObject({ status: "queued" });
  });
});
