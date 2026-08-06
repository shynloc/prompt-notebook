// @vitest-environment node

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { POST as createConfiguration } from "@/app/api/v1/ai/configurations/route";
import { PATCH as patchPreference } from "@/app/api/v1/ai/preferences/route";
import { db } from "@/db/client";
import { aiGenerationAssets, aiGenerationJobs, generationCharacterReferences } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import type { GenerationMediaStore, StoredGenerationAsset } from "@/modules/generation/generation-media-store";
import type { GenerationQueue } from "@/modules/generation/generation-queue";
import { GenerationService } from "@/modules/generation/generation-service";
import { createGenerationSchema } from "@/modules/generation/generation-schema";
import { GenerationWorkerProcessor } from "@/modules/generation/generation-worker";
import { AiProviderRegistry } from "@/modules/ai/provider-registry";
import { AiProviderError } from "@/modules/ai/types";
import { CharacterService } from "@/modules/characters/character-service";
import { createCharacterProfileSchema } from "@/modules/characters/character-schema";

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

async function configureImageModel(cookie: string, secret = "sk-image-secret") {
  const response = await createConfiguration(request(`${base}/api/v1/ai/configurations`, {
    cookie,
    body: {
      name: `Image model ${randomUUID()}`,
      baseUrl: "https://api.example.com/v1",
      apiKey: secret,
      modelId: "image-model",
      displayName: "Image Model",
      capabilities: ["image_generation"],
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
  uploads: Array<{ userId: string; jobId: string; role: "reference" | "result"; ordinal: number; data: Buffer }> = [];
  private readonly stored = new Map<string, Buffer>();

  seed(objectKey: string, data: Buffer) {
    this.stored.set(objectKey, data);
  }

  async upload(userId: string, jobId: string, role: "reference" | "result", ordinal: number, data: Buffer): Promise<StoredGenerationAsset> {
    this.uploads.push({ userId, jobId, role, ordinal, data });
    const objectKey = `prompt-notebook/test/${jobId}/${role}/${ordinal}.png`;
    this.stored.set(objectKey, data);
    return {
      storageProvider: "picbed",
      objectKey,
      displayUrl: `https://img.example.com/${objectKey}`,
      thumbnailUrl: `https://img.example.com/${objectKey}`,
      mimeType: "image/png",
      width: 1,
      height: 1,
      sizeBytes: data.length,
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

  override async upload(userId: string, jobId: string, role: "reference" | "result", ordinal: number, data: Buffer) {
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

  it("recovers stale running jobs and re-enqueues them", async () => {
    const owner = await sessionFor("generation-recovery");
    await configureImageModel(owner.cookie);
    const queue = new RecordingQueue();
    const media = new RecordingMediaStore();
    const service = new GenerationService({ queue, media });
    const created = await service.create(owner.userId, input());
    queue.enqueued = [];
    await db.update(aiGenerationJobs).set({
      status: "running",
      heartbeatAt: new Date(Date.now() - 10 * 60_000),
      startedAt: new Date(Date.now() - 11 * 60_000),
    }).where(and(eq(aiGenerationJobs.id, created.id), eq(aiGenerationJobs.userId, owner.userId)));

    const recovered = await service.recoverStale(new Date(Date.now() - 5 * 60_000));
    expect(recovered).toEqual([created.id]);
    expect(queue.enqueued).toEqual([{ jobId: created.id, maxAttempts: 3 }]);
    expect((await service.get(owner.userId, created.id)).status).toBe("queued");

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
