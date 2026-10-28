// @vitest-environment node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, rmdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as readFile } from "@/app/api/v1/media/files/[id]/route";
import { GET as readSharedImage } from "@/app/api/v1/shares/public/[token]/image/route";
import { GET as listImages } from "@/app/api/v1/images/route";
import { POST as uploadImage } from "@/app/api/v1/uploads/route";
import { createReversePromptHandler } from "@/app/api/v1/ai/reverse-prompt/route";
import { db } from "@/db/client";
import { aiGenerationAssets, aiGenerationJobs, localMediaObjects, mediaStoragePreferences, mediaStorageSettings, noteShares, user } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { createCharacterProfileSchema } from "@/modules/characters/character-schema";
import { CharacterService } from "@/modules/characters/character-service";
import { PicbedGenerationMediaStore } from "@/modules/generation/generation-media-store";
import { GenerationService } from "@/modules/generation/generation-service";
import { GenerationWorkerProcessor } from "@/modules/generation/generation-worker";
import { AiConfigurationService } from "@/modules/ai/ai-configuration-service";
import { createAiConfigurationSchema } from "@/modules/ai/ai-configuration-schema";
import { AiProviderRegistry } from "@/modules/ai/provider-registry";
import { LocalMediaStore, localMediaIdFromUrl, localMediaUsage, readLocalMediaUrl } from "@/modules/media/local-media-store";
import { MediaService } from "@/modules/media/media-service";
import { MediaStorageConfigurationService } from "@/modules/media/media-storage-configuration-service";
import { createNoteSchema } from "@/modules/notes/note-schema";
import { NoteService } from "@/modules/notes/note-service";
import { ShareService } from "@/modules/sharing/share-service";
import { NotebookTransferService } from "@/modules/transfer/transfer-service";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const base = process.env.APP_URL ?? "http://localhost:3000";
const users: string[] = [];
let root: string;
const testOutputRoot = path.resolve("outputs");

function request(url: string, cookie?: string) {
  return new Request(url, { headers: cookie ? { cookie } : {} });
}

async function owner(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  const signup = await auth.handler(new Request(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: label, email, password }) }));
  if (!signup.ok) throw new Error("test signup failed");
  const response = await auth.handler(new Request(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
  const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("test session failed");
  const cookie = `better-auth.session_token=${token}`;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("test session missing");
  users.push(session.user.id);
  return { userId: session.user.id, cookie };
}

beforeAll(async () => { await mkdir(testOutputRoot, { recursive: true }); root = await mkdtemp(path.join(testOutputRoot, "local-media-test-")); });
beforeEach(() => {
  vi.stubEnv("LOCAL_MEDIA_ROOT", root);
  vi.stubEnv("LOCAL_MEDIA_QUOTA_BYTES", String(1024 * 1024 * 1024));
  vi.stubEnv("LOCAL_MEDIA_MIN_FREE_BYTES", "0");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEYS", `local-media-test:${randomBytes(32).toString("hex")}`);
  vi.stubEnv("CREDENTIAL_ACTIVE_KEY_ID", "local-media-test");
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => {
  for (const id of users) await db.delete(user).where(eq(user.id, id));
  if (path.dirname(root) !== testOutputRoot || !path.basename(root).startsWith("local-media-test-")) throw new Error("Unsafe test cleanup target");
  await rm(root, { recursive: true, force: true });
});

describe("private local image storage", () => {
  it("defaults new accounts to local and serves only authenticated owner files", async () => {
    const mine = await owner("local-owner");
    const other = await owner("local-other");
    const settings = new MediaStorageConfigurationService();
    expect(await settings.get(mine.userId)).toMatchObject({ providerType: "local", endpoint: "", tokenHint: "", enabled: true, picbedConfigured: false, local: { usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 } });
    const image = await new MediaService().upload(mine.userId, PNG);
    const id = localMediaIdFromUrl(image.displayUrl)!;
    expect(image).toMatchObject({ storageProvider: "local", mimeType: "image/png", width: 1, height: 1, sizeBytes: PNG.length });
    expect(image.displayUrl).toBe(`${new URL(base).origin}/api/v1/media/files/${id}`);
    const context = { params: Promise.resolve({ id }) };
    const response = await readFile(request(image.displayUrl, mine.cookie), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect((await readFile(request(image.displayUrl, other.cookie), context)).status).toBe(404);
    expect((await readFile(request(image.displayUrl), context)).status).toBe(401);
    expect(await localMediaUsage(mine.userId)).toMatchObject({ usedBytes: PNG.length });
    await expect(new PicbedGenerationMediaStore().read(image, mine.userId)).resolves.toEqual(PNG);
    await expect(new PicbedGenerationMediaStore().read(image, other.userId)).rejects.toMatchObject({ status: 404 });
    await expect(new PicbedGenerationMediaStore().read(image)).rejects.toMatchObject({ status: 404 });
    await expect(new MediaService().importUrl(mine.userId, image.displayUrl)).resolves.toMatchObject({ storageProvider: "local" });
    await expect(new MediaService().importUrl(other.userId, image.displayUrl)).rejects.toMatchObject({ status: 404 });
    if (process.platform !== "win32") {
      expect((await stat(path.join(root, image.objectKey))).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(path.join(root, image.objectKey)))).mode & 0o777).toBe(0o700);
    }
  });

  it("preserves encrypted Picbed settings across local switching and defaults legacy accounts to Picbed", async () => {
    const mine = await owner("local-switch");
    const service = new MediaStorageConfigurationService();
    await service.upsert(mine.userId, { providerType: "picbed", endpoint: "https://images.example.com/upload", token: "fixture-image-token", enabled: true });
    const [initial] = await db.select().from(mediaStorageSettings).where(eq(mediaStorageSettings.userId, mine.userId));
    await db.delete(mediaStoragePreferences).where(eq(mediaStoragePreferences.userId, mine.userId));
    expect(await service.get(mine.userId)).toMatchObject({ providerType: "picbed", picbedConfigured: true });
    expect(await service.upsert(mine.userId, { providerType: "local" })).toMatchObject({ providerType: "local", picbedConfigured: true });
    expect(await service.providerFor(mine.userId)).toBeInstanceOf(LocalMediaStore);
    expect(await service.test(mine.userId)).toEqual({ ok: true, providerType: "local" });
    expect(await localMediaUsage(mine.userId)).toMatchObject({ usedBytes: 0 });
    const [after] = await db.select().from(mediaStorageSettings).where(eq(mediaStorageSettings.userId, mine.userId));
    expect(after.encryptedSecret).toBe(initial.encryptedSecret);
    await service.upsert(mine.userId, { providerType: "picbed", endpoint: initial.endpoint, enabled: true });
    const factory = vi.fn(() => ({ upload: vi.fn() }));
    await new MediaStorageConfigurationService(factory).providerFor(mine.userId);
    expect(factory).toHaveBeenCalledWith(initial.endpoint, "fixture-image-token");
    expect(await service.delete(mine.userId)).toMatchObject({ deleted: true, providerType: "local", picbedConfigured: false });
  });

  it("bounds upload bodies and resolves local URL import/reverse under the authenticated owner", async () => {
    const mine = await owner("local-upload-api");
    const other = await owner("local-reverse-other");
    const form = new FormData();
    form.set("file", new Blob([PNG], { type: "image/png" }), "fixture.png");
    const upload = await uploadImage(new Request(`${base}/api/v1/uploads`, { method: "POST", headers: { cookie: mine.cookie }, body: form }));
    expect(upload.status).toBe(201);
    const image = (await upload.json()).data;
    const imported = await uploadImage(new Request(`${base}/api/v1/uploads`, { method: "POST", headers: { cookie: mine.cookie, "content-type": "application/json" }, body: JSON.stringify({ url: image.displayUrl }) }));
    expect(imported.status).toBe(201);
    const tooLarge = await uploadImage(new Request(`${base}/api/v1/uploads`, { method: "POST", headers: { cookie: mine.cookie, "content-type": "multipart/form-data; boundary=fixture", "content-length": String(10 * 1024 * 1024 + 64_001) }, body: "" }));
    expect(tooLarge.status).toBe(413);
    const tooLargeJson = await uploadImage(new Request(`${base}/api/v1/uploads`, { method: "POST", headers: { cookie: mine.cookie, "content-type": "application/json" }, body: " ".repeat(16_001) }));
    expect(tooLargeJson.status).toBe(413);
    const duplicate = new FormData();
    duplicate.append("file", new Blob([PNG], { type: "image/png" }), "one.png");
    duplicate.append("file", new Blob([PNG], { type: "image/png" }), "two.png");
    expect((await uploadImage(new Request(`${base}/api/v1/uploads`, { method: "POST", headers: { cookie: mine.cookie }, body: duplicate }))).status).toBe(422);
    const reverse = vi.fn(async () => ({ prompt: "fixture analyzed prompt" }));
    const handler = createReversePromptHandler({ reverse });
    const reverseRequest = (cookie: string) => new Request(`${base}/api/v1/ai/reverse-prompt`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ imageUrl: image.displayUrl }) });
    expect((await handler(reverseRequest(mine.cookie))).status).toBe(200);
    expect(reverse).toHaveBeenCalledWith(mine.userId, PNG, "image/png", expect.any(AbortSignal), expect.objectContaining({ additionalRequirements: "", language: "zh" }));
    expect((await handler(reverseRequest(other.cookie))).status).toBe(404);
    expect(reverse).toHaveBeenCalledOnce();
  });

  it("serializes concurrent uploads against per-user quota without orphaning rejected files", async () => {
    const mine = await owner("local-quota");
    vi.stubEnv("LOCAL_MEDIA_QUOTA_BYTES", String(PNG.length + 1));
    const service = new MediaService();
    const results = await Promise.allSettled([service.upload(mine.userId, PNG), service.upload(mine.userId, PNG)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 413, code: "LOCAL_STORAGE_QUOTA_EXCEEDED" });
    expect(await localMediaUsage(mine.userId)).toMatchObject({ usedBytes: PNG.length });
    const namespace = createHash("sha256").update(mine.userId).digest("hex");
    expect(await readdir(path.join(root, namespace))).toHaveLength(1);
  });

  it("preserves a committed file when the transaction acknowledgement is lost", async () => {
    const mine = await owner("local-commit-ack");
    const transaction = db.transaction.bind(db);
    const interrupted = vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, config) => {
      await transaction(callback, config);
      throw new Error("fixture lost commit acknowledgement");
    });
    try {
      const image = await new MediaService().upload(mine.userId, PNG);
      await expect(new LocalMediaStore(mine.userId).read(localMediaIdFromUrl(image.displayUrl)!)).resolves.toMatchObject({ data: PNG });
      expect(await localMediaUsage(mine.userId)).toMatchObject({ usedBytes: PNG.length });
    } finally { interrupted.mockRestore(); }
  });

  it("atomically serializes first configuration and delete/update races without dangling Picbed selection", async () => {
    const mine = await owner("local-settings-race");
    const settings = new MediaStorageConfigurationService();
    const remote = { providerType: "picbed" as const, endpoint: "https://images.example.com/upload", enabled: true };
    await expect(Promise.all([
      settings.upsert(mine.userId, { ...remote, token: "fixture-first-token" }),
      settings.upsert(mine.userId, { ...remote, token: "fixture-second-token" }),
    ])).resolves.toHaveLength(2);
    expect(await db.select().from(mediaStorageSettings).where(eq(mediaStorageSettings.userId, mine.userId))).toHaveLength(1);
    await expect(Promise.all([
      settings.upsert(mine.userId, { ...remote, token: "fixture-final-token" }), settings.delete(mine.userId),
    ])).resolves.toHaveLength(2);
    const [row] = await db.select().from(mediaStorageSettings).where(eq(mediaStorageSettings.userId, mine.userId));
    const view = await settings.get(mine.userId);
    expect(view).toMatchObject({ providerType: row ? "picbed" : "local", picbedConfigured: Boolean(row) });
    await db.delete(mediaStorageSettings).where(eq(mediaStorageSettings.userId, mine.userId));
    await db.insert(mediaStoragePreferences).values({ userId: mine.userId, providerType: "picbed" }).onConflictDoUpdate({ target: mediaStoragePreferences.userId, set: { providerType: "picbed" } });
    expect(await settings.get(mine.userId)).toMatchObject({ providerType: "picbed", enabled: false, picbedConfigured: false });
    await expect(settings.providerFor(mine.userId)).rejects.toMatchObject({ code: "IMAGE_STORAGE_NOT_CONFIGURED" });
  });

  it("rejects path traversal and forged cross-owner image references", async () => {
    const mine = await owner("local-path");
    const other = await owner("local-forge");
    const image = await new MediaService().upload(mine.userId, PNG);
    const id = localMediaIdFromUrl(image.displayUrl)!;
    expect(localMediaIdFromUrl(`${image.displayUrl}?path=secret`)).toBeNull();
    expect(localMediaIdFromUrl(`https://evil.example/api/v1/media/files/${id}`)).toBeNull();
    expect(localMediaIdFromUrl(`${new URL(base).origin}/api/v1/media/files/../../secret`)).toBeNull();
    await expect(new NoteService().create(other.userId, createNoteSchema.parse({ title: "forged", prompt: "test", images: [image] }))).rejects.toMatchObject({ status: 404 });
    await expect(new CharacterService().create(other.userId, createCharacterProfileSchema.parse({ name: "forged", roleDefinition: "fixture role", images: [{ ...image, isCover: true, isPrimary: true }] }))).rejects.toMatchObject({ status: 404 });
    await db.update(localMediaObjects).set({ objectKey: "../../outside.png" }).where(and(eq(localMediaObjects.id, id), eq(localMediaObjects.userId, mine.userId)));
    await expect(new LocalMediaStore(mine.userId).read(id)).rejects.toMatchObject({ status: 404 });
    expect(() => new LocalMediaStore(mine.userId, path.resolve("public", "uploads"))).toThrow();
  });

  it("refuses a symlinked owner namespace without reading or writing its target", async () => {
    const mine = await owner("local-symlink");
    const image = await new MediaService().upload(mine.userId, PNG);
    const destination = path.join(root, image.objectKey);
    const namespace = path.dirname(destination);
    await unlink(destination);
    await rmdir(namespace);
    const target = path.join(root, `symlink-target-${randomUUID()}`);
    await mkdir(target);
    await writeFile(path.join(target, path.basename(destination)), PNG);
    await symlink(target, namespace, process.platform === "win32" ? "junction" : "dir");
    await expect(new LocalMediaStore(mine.userId).read(localMediaIdFromUrl(image.displayUrl)!)).rejects.toMatchObject({ status: 404 });
    await expect(new MediaService().upload(mine.userId, PNG)).rejects.toMatchObject({ code: "LOCAL_STORAGE_UNAVAILABLE" });
    expect(await readdir(target)).toEqual([path.basename(destination)]);
  });

  it("retains configured free-space reserve and rejects writes before consuming quota", async () => {
    const mine = await owner("local-disk-reserve");
    vi.stubEnv("LOCAL_MEDIA_MIN_FREE_BYTES", String(Number.MAX_SAFE_INTEGER - 1));
    await expect(new MediaService().upload(mine.userId, PNG)).rejects.toMatchObject({ status: 507, code: "LOCAL_STORAGE_DISK_FULL" });
    expect(await localMediaUsage(mine.userId)).toMatchObject({ usedBytes: 0 });
  });

  it("rebinds trusted local database views to a changed APP_URL without relaxing user URL imports", async () => {
    const mine = await owner("local-origin-migration");
    const image = await new MediaService().upload(mine.userId, PNG);
    const characters = new CharacterService();
    const character = await characters.create(mine.userId, createCharacterProfileSchema.parse({ name: "Fixture model", roleDefinition: "fixture role", images: [{ ...image, isCover: true, isPrimary: true }] }));
    const notes = new NoteService();
    const note = await notes.create(mine.userId, createNoteSchema.parse({ title: "Migrate", prompt: "fixture", images: [image], characterProfiles: [{ id: character.id, role: "primary", sortOrder: 0 }] }));
    const [job] = await db.insert(aiGenerationJobs).values({ userId: mine.userId, idempotencyKey: randomUUID(), requestFingerprint: "fixture", status: "succeeded", prompt: "fixture", modelId: "fixture", modelName: "Fixture", providerType: "openai_compatible", width: 1024, height: 1024, quality: "auto", imageCount: 1 }).returning();
    const [asset] = await db.insert(aiGenerationAssets).values({ userId: mine.userId, jobId: job.id, role: "result", ordinal: 0, ...image }).returning();
    const shares = new ShareService();
    const shared = await shares.create(mine.userId, { noteId: note.id, expiresInDays: 7, includeImage: true, includeSource: false, allowCopy: true });
    if (!shared.token) throw new Error("share token missing");
    vi.stubEnv("APP_URL", "https://migrated.example.com");
    const expected = `https://migrated.example.com/api/v1/media/files/${localMediaIdFromUrl(image.displayUrl) ?? path.basename(image.objectKey).slice(0, 36)}`;
    expect((await notes.get(mine.userId, note.id)).coverImage?.displayUrl).toBe(expected);
    expect((await notes.get(mine.userId, note.id)).characterProfiles[0].avatar?.displayUrl).toBe(expected);
    expect((await characters.get(mine.userId, character.id)).coverImage?.displayUrl).toBe(expected);
    const gallery = await listImages(request("https://migrated.example.com/api/v1/images", mine.cookie));
    expect((await gallery.json()).data[0].displayUrl).toBe(expected);
    const generations = new GenerationService({ queue: { enqueue: async () => undefined, remove: async () => undefined } });
    expect((await generations.get(mine.userId, job.id)).assets[0].displayUrl).toBe(expected);
    expect((await generations.list(mine.userId, { limit: 10, status: "all" }))[0].assets[0].displayUrl).toBe(expected);
    await expect(generations.downloadAsset(mine.userId, job.id, asset.id)).resolves.toMatchObject({ data: PNG });
    await expect(new PicbedGenerationMediaStore().read(image, mine.userId)).resolves.toEqual(PNG);
    expect((await shares.list(mine.userId))[0].previewImageUrl).toBe(expected);
    expect((await shares.publicRead(shared.token, randomUUID())).image?.displayUrl).toContain("https://migrated.example.com/api/v1/shares/public/");
    await expect(shares.publicImage(shared.token, randomUUID())).resolves.toMatchObject({ data: PNG });
    expect((await new NotebookTransferService().export(mine.userId)).notes[0].images[0].displayUrl).toBe(expected);
    expect(localMediaIdFromUrl(image.displayUrl)).toBeNull();
    await expect(readLocalMediaUrl(mine.userId, image.displayUrl)).resolves.toBeNull();
  });

  it("runs image generation with local references/results and saves output as a note without a Picbed account", async () => {
    const mine = await owner("local-generation");
    const configurations = new AiConfigurationService();
    const model = await configurations.create(mine.userId, createAiConfigurationSchema.parse({ name: "Fixture", baseUrl: "https://api.example.com/v1", apiKey: "fixture-generation-key", modelId: "gpt-image-2.5-sunburst", displayName: "Fixture", capabilities: ["image_generation"] }));
    await configurations.updatePreference(mine.userId, { purpose: "image_generation", modelProfileId: model.modelProfileId });
    const queue = { enqueue: vi.fn(async () => undefined), remove: async () => undefined };
    const generations = new GenerationService({ queue });
    const created = await generations.create(mine.userId, { idempotencyKey: randomUUID(), prompt: "fixture prompt", width: 1024, height: 1024, quality: "xhigh", imageCount: 1, referenceImages: [PNG] });
    expect(created.assets[0].storageProvider).toBe("local");
    const generateImages = vi.fn(async () => ({ images: [{ data: PNG }] }));
    const worker = new GenerationWorkerProcessor({ providers: new AiProviderRegistry([{ type: "openai_compatible", testConnection: vi.fn(), generateImages }]) });
    await expect(worker.process(created.id, { attempt: 1, maxAttempts: 3 })).resolves.toEqual({ status: "succeeded" });
    expect(generateImages).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [expect.objectContaining({ data: PNG })] }));
    const completed = await generations.get(mine.userId, created.id);
    const result = completed.assets.find((item) => item.role === "result")!;
    expect(result.storageProvider).toBe("local");
    const note = await new NoteService().create(mine.userId, createNoteSchema.parse({ title: "Generated", prompt: "fixture", images: [result] }));
    expect(note.coverImage?.displayUrl).toBe(result.displayUrl);
    expect(await db.select().from(mediaStorageSettings).where(eq(mediaStorageSettings.userId, mine.userId))).toEqual([]);
  });

  it("exposes only a valid share cover and stops access after revocation, expiry or image exclusion", async () => {
    const mine = await owner("local-share");
    const media = new MediaService();
    const first = await media.upload(mine.userId, PNG);
    const second = await media.upload(mine.userId, PNG);
    const note = await new NoteService().create(mine.userId, createNoteSchema.parse({ title: "Shared local image", prompt: "fixture prompt", images: [first, second] }));
    const shares = new ShareService();
    const shared = await shares.create(mine.userId, { noteId: note.id, expiresInDays: 7, allowCopy: true, includeImage: true, includeSource: false });
    if (!shared.token) throw new Error("share token missing");
    const view = await shares.publicRead(shared.token, randomUUID());
    expect(view.image?.displayUrl).toContain(`/api/v1/shares/public/${shared.token}/image`);
    expect(JSON.stringify(view)).not.toContain(first.objectKey);
    expect(JSON.stringify(view)).not.toContain(localMediaIdFromUrl(second.displayUrl));
    const context = { params: Promise.resolve({ token: shared.token }) };
    const response = await readSharedImage(request(view.image!.displayUrl), context);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await db.update(noteShares).set({ includeImage: false }).where(eq(noteShares.id, shared.id));
    await expect(shares.publicImage(shared.token, randomUUID())).rejects.toMatchObject({ status: 404 });
    await db.update(noteShares).set({ includeImage: true, expiresAt: new Date(0) }).where(eq(noteShares.id, shared.id));
    expect((await readSharedImage(request(view.image!.displayUrl), context)).status).toBe(404);
    await db.update(noteShares).set({ expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() }).where(eq(noteShares.id, shared.id));
    expect((await readSharedImage(request(view.image!.displayUrl), context)).status).toBe(404);
    expect((await readFile(request(first.displayUrl), { params: Promise.resolve({ id: localMediaIdFromUrl(first.displayUrl)! }) })).status).toBe(401);
  });

  it("cleans only a deleted account namespace and never another owner's files", async () => {
    const mine = await owner("local-delete");
    const other = await owner("local-keep");
    const first = await new MediaService().upload(mine.userId, PNG);
    const keep = await new MediaService().upload(other.userId, PNG);
    await db.delete(user).where(eq(user.id, mine.userId));
    await new LocalMediaStore(mine.userId).purgeDeletedAccount();
    await expect(stat(path.join(root, first.objectKey))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(new LocalMediaStore(other.userId).read(localMediaIdFromUrl(keep.displayUrl)!)).resolves.toMatchObject({ data: PNG });
  });
});
