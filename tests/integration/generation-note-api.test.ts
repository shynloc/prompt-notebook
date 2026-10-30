// @vitest-environment node

import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createGenerationNoteHandler, POST as saveGenerationNote } from "@/app/api/v1/generations/[id]/note/route";
import { POST as createNote } from "@/app/api/v1/notes/route";
import { db } from "@/db/client";
import {
  aiGenerationAssets,
  aiGenerationJobs,
  characterProfiles,
  generationCharacterReferences,
  idempotencyKeys,
  promptNotes,
  user,
} from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { generationNoteInput } from "@/modules/generation/generation-note";
import { GenerationService } from "@/modules/generation/generation-service";

const base = "http://localhost:3000";
const createdUsers = new Set<string>();
const generations = new GenerationService({ queue: { enqueue: async () => undefined, remove: async () => undefined } });
const save = createGenerationNoteHandler(generations);

function request(url: string, options: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(url, { method: "POST", headers, body: JSON.stringify(options.body ?? {}) });
}

function saveRequest(id: string, cookie?: string, body: unknown = {}) {
  return save(request(`${base}/api/v1/generations/${id}/note`, { cookie, body }), { params: Promise.resolve({ id }) });
}

async function sessionFor() {
  const email = `generation-note-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  const signup = await auth.handler(request(`${base}/api/auth/sign-up/email`, { body: { name: "Generation note fixture", email, password } }));
  expect(signup.status).toBe(200);
  const signIn = await auth.handler(request(`${base}/api/auth/sign-in/email`, { body: { email, password } }));
  const token = signIn.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("No fixture session cookie");
  const cookie = `better-auth.session_token=${token}`;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("No fixture authenticated session");
  createdUsers.add(session.user.id);
  return { userId: session.user.id, cookie };
}

async function seedJob(userId: string, options: { status?: string; character?: boolean } = {}) {
  const id = randomUUID();
  const profileId = options.character ? randomUUID() : undefined;
  if (profileId) {
    await db.insert(characterProfiles).values({ id: profileId, userId, name: "Synthetic model", roleDefinition: "Synthetic character fixture" });
  }
  await db.insert(aiGenerationJobs).values({
    id, userId, characterProfileId: profileId, idempotencyKey: randomUUID(), requestFingerprint: randomUUID(),
    status: options.status ?? "succeeded", prompt: "Synthetic paper observatory", negativePrompt: "blurry",
    modelId: "gpt-image-2.5-flare", modelName: "Synthetic image model", providerType: "openai_compatible",
    width: 1536, height: 1024, quality: "high", imageCount: 2,
    parameters: { output_format: "png", background: "transparent" },
    resultMetadata: { usage: { total_tokens: 120 } },
  });
  const assets = await db.insert(aiGenerationAssets).values([
    ...[0, 1].map((ordinal) => ({
      jobId: id, userId, role: "result", ordinal, storageProvider: "picbed",
      objectKey: `synthetic/${id}/result-${ordinal}.png`,
      displayUrl: `https://img.example.com/${id}/result-${ordinal}.png`,
      thumbnailUrl: `https://img.example.com/${id}/result-${ordinal}.png`,
      mimeType: "image/png", width: 1536, height: 1024, sizeBytes: 512,
    })),
    {
      jobId: id, userId, role: "reference", ordinal: 0, storageProvider: "picbed",
      objectKey: `synthetic/${id}/reference.png`, displayUrl: `https://img.example.com/${id}/reference.png`,
      thumbnailUrl: `https://img.example.com/${id}/reference.png`, mimeType: "image/png", width: 512, height: 512, sizeBytes: 128,
    },
  ]).returning();
  if (profileId) {
    await db.insert(generationCharacterReferences).values({
      jobId: id, generationAssetId: assets.find((asset) => asset.role === "reference")!.id, userId,
      profileId, profileImageId: randomUUID(), profileNameSnapshot: "Synthetic model",
      profileVersionSnapshot: 1, viewTypeSnapshot: "portrait", ordinal: 0,
    });
  }
  return { id, profileId, job: await generations.get(userId, id) };
}

async function noteIds(userId: string) {
  return db.select({ id: promptNotes.id }).from(promptNotes).where(eq(promptNotes.userId, userId));
}

afterEach(async () => {
  if (createdUsers.size) await db.delete(user).where(inArray(user.id, [...createdUsers]));
  createdUsers.clear();
});

describe("saving generation results as notes", () => {
  it("rejects unauthenticated requests without constructing a Redis-backed service", async () => {
    const id = randomUUID();
    const response = await saveGenerationNote(request(`${base}/api/v1/generations/${id}/note`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("hides jobs belonging to another user and missing jobs", async () => {
    const owner = await sessionFor();
    const other = await sessionFor();
    const { id } = await seedJob(owner.userId);
    const forbidden = await saveRequest(id, other.cookie);
    const missing = await saveRequest(randomUUID(), owner.cookie);
    expect(forbidden.status).toBe(404);
    expect((await forbidden.json()).error.code).toBe("GENERATION_NOT_FOUND");
    expect(missing.status).toBe(404);
    expect(await noteIds(owner.userId)).toHaveLength(0);
    expect(await noteIds(other.userId)).toHaveLength(0);
  });

  it("rejects a cross-origin save even with a valid session", async () => {
    const owner = await sessionFor();
    const { id } = await seedJob(owner.userId);
    const response = await save(request(`${base}/api/v1/generations/${id}/note`, {
      cookie: owner.cookie, headers: { origin: "https://untrusted.example.com" },
    }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(await noteIds(owner.userId)).toHaveLength(0);
  });

  it.each(["queued", "running", "failed", "cancelled"])("does not save a %s job", async (status) => {
    const owner = await sessionFor();
    const { id } = await seedJob(owner.userId, { status });
    const response = await saveRequest(id, owner.cookie);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("GENERATION_NOT_READY");
    expect(await noteIds(owner.userId)).toHaveLength(0);
  });

  it("persists only result assets and the server-owned generation metadata", async () => {
    const owner = await sessionFor();
    const { id } = await seedJob(owner.userId, { character: true });
    const forged = await saveRequest(id, owner.cookie, { title: "Forged", prompt: "Client replacement" });
    expect(forged.status).toBe(422);
    const response = await saveRequest(id, owner.cookie, { title: "  Observatory study  " });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.meta.replayed).toBe(false);
    expect(body.data).toMatchObject({
      title: "Observatory study", prompt: "Synthetic paper observatory", negativePrompt: "blurry",
      model: "Synthetic image model",
      parameters: {
        generationJobId: id, modelId: "gpt-image-2.5-flare", providerType: "openai_compatible",
        width: 1536, height: 1024, quality: "high",
        request: { output_format: "png", background: "transparent" },
        result: { usage: { total_tokens: 120 } },
        actualImages: [
          { width: 1536, height: 1024, mimeType: "image/png" },
          { width: 1536, height: 1024, mimeType: "image/png" },
        ],
      },
    });
    expect(body.data.images).toHaveLength(2);
    expect(body.data.images.map((image: { objectKey: string }) => image.objectKey)).toEqual([
      `synthetic/${id}/result-0.png`, `synthetic/${id}/result-1.png`,
    ]);
    expect(body.data.tags).toEqual([expect.objectContaining({ name: "AI 生成" })]);
    expect(body.data.characterProfiles).toHaveLength(1);
    const replay = await saveRequest(id, owner.cookie, { title: "Changed title" });
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.id).toBe(body.data.id);
    expect(await noteIds(owner.userId)).toHaveLength(1);
  });

  it("replays an old-version save through the new endpoint after an upgrade", async () => {
    const owner = await sessionFor();
    const { id, job } = await seedJob(owner.userId);
    const legacy = await createNote(request(`${base}/api/v1/notes`, {
      cookie: owner.cookie, headers: { "idempotency-key": `imagehub-note:${id}` },
      body: generationNoteInput(job, { title: "Saved before upgrade" }),
    }));
    const legacyBody = await legacy.json();
    expect(legacy.status).toBe(201);
    const upgraded = await saveRequest(id, owner.cookie, { title: "Changed after upgrade" });
    const body = await upgraded.json();
    expect(upgraded.status).toBe(200);
    expect(body.meta.replayed).toBe(true);
    expect(body.data.id).toBe(legacyBody.data.id);
    expect(body.data.title).toBe("Saved before upgrade");
    expect(await noteIds(owner.userId)).toHaveLength(1);
  });

  it("replays a new-endpoint save through an older browser client", async () => {
    const owner = await sessionFor();
    const { id, job } = await seedJob(owner.userId);
    const initial = await saveRequest(id, owner.cookie);
    const initialBody = await initial.json();
    expect(initial.status).toBe(201);
    const legacy = await createNote(request(`${base}/api/v1/notes`, {
      cookie: owner.cookie, headers: { "idempotency-key": `imagehub-note:${id}` },
      body: generationNoteInput(job, { title: "Old client retry" }),
    }));
    const body = await legacy.json();
    expect(legacy.status).toBe(200);
    expect(body.meta.replayed).toBe(true);
    expect(body.data.id).toBe(initialBody.data.id);
    expect(await noteIds(owner.userId)).toHaveLength(1);
  });

  it("serializes racing old and new clients and lets an in-progress save be retried", async () => {
    const owner = await sessionFor();
    const { id, job } = await seedJob(owner.userId);
    const responses = await Promise.all([
      saveRequest(id, owner.cookie),
      createNote(request(`${base}/api/v1/notes`, {
        cookie: owner.cookie, headers: { "idempotency-key": `imagehub-note:${id}` },
        body: generationNoteInput(job),
      })),
      saveRequest(id, owner.cookie),
    ]);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    for (const response of responses) {
      expect([200, 201, 409]).toContain(response.status);
      if (response.status === 409) expect((await response.json()).error.code).toBe("NOTE_SAVE_IN_PROGRESS");
    }
    const replay = await saveRequest(id, owner.cookie);
    expect(replay.status).toBe(200);
    expect((await replay.json()).meta.replayed).toBe(true);
    expect(await noteIds(owner.userId)).toHaveLength(1);
  });

  it("releases a failed save claim so a deleted character can be explicitly omitted", async () => {
    const owner = await sessionFor();
    const { id, profileId } = await seedJob(owner.userId, { character: true });
    await db.delete(characterProfiles).where(and(eq(characterProfiles.id, profileId!), eq(characterProfiles.userId, owner.userId)));
    const unavailable = await saveRequest(id, owner.cookie, { includeCharacter: true });
    expect(unavailable.status).toBe(404);
    expect((await unavailable.json()).error.code).toBe("CHARACTER_PROFILE_NOT_FOUND");
    expect(await noteIds(owner.userId)).toHaveLength(0);
    const claims = await db.select({ key: idempotencyKeys.key }).from(idempotencyKeys).where(eq(idempotencyKeys.userId, owner.userId));
    expect(claims).toHaveLength(0);
    const withoutCharacter = await saveRequest(id, owner.cookie, { includeCharacter: false });
    const body = await withoutCharacter.json();
    expect(withoutCharacter.status).toBe(201);
    expect(body.data.characterProfiles).toEqual([]);
    expect(body.data.images).toHaveLength(2);
    const replay = await saveRequest(id, owner.cookie, { includeCharacter: true });
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.id).toBe(body.data.id);
    expect(await noteIds(owner.userId)).toHaveLength(1);
  });
});
