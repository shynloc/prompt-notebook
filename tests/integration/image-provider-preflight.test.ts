// @vitest-environment node

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as configureModel } from "@/app/api/v1/ai/configurations/route";
import { createGenerationHandlers } from "@/app/api/v1/generations/route";
import { db } from "@/db/client";
import { aiGenerationJobs, user } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { GenerationService } from "@/modules/generation/generation-service";

const base = "http://localhost:3000";
const users: string[] = [];

function request(path: string, body: unknown, cookie?: string) {
  return new Request(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function fixture(modelId: string, defaultParameters: Record<string, string> = {}) {
  const email = `image-preflight-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  const signup = await auth.handler(request("/api/auth/sign-up/email", { name: "Image preflight fixture", email, password }));
  expect(signup.ok).toBe(true);
  const signedIn = await auth.handler(request("/api/auth/sign-in/email", { email, password }));
  const token = signedIn.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("No fixture session");
  const cookie = `better-auth.session_token=${token}`;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("No fixture authenticated session");
  users.push(session.user.id);
  const configuration = await configureModel(request("/api/v1/ai/configurations", {
    name: "Synthetic official image configuration", baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-synthetic-preflight-not-a-real-key", modelId, displayName: "Synthetic image model",
    capabilities: ["image_generation"], defaultParameters,
  }, cookie));
  expect(configuration.status).toBe(201);
  return { cookie, userId: session.user.id, modelProfileId: (await configuration.json()).data.modelProfileId };
}

function serviceFixture() {
  const enqueue = vi.fn(async () => undefined);
  const upload = vi.fn(async () => { throw new Error("No media upload is expected"); });
  const service = new GenerationService({ queue: { enqueue, remove: async () => undefined }, media: { upload, read: vi.fn() } });
  return { handlers: createGenerationHandlers(service), enqueue, upload };
}

afterEach(async () => {
  const ids = users.splice(0);
  if (ids.length) await db.delete(user).where(inArray(user.id, ids));
});

describe("official image model validation before task creation", () => {
  it.each(["gpt-6.1-terra", "unknown-image-model", "gpt-image-2.5"])("rejects automatic %s without persisting or enqueueing a job", async (modelId) => {
    const owner = await fixture(modelId);
    const { handlers, enqueue, upload } = serviceFixture();
    const response = await handlers.POST(request("/api/v1/generations", {
      idempotencyKey: randomUUID(), modelProfileId: owner.modelProfileId,
      prompt: "Synthetic paper observatory", width: 1024, height: 1024, quality: "auto", imageCount: 1,
    }, owner.cookie));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({ code: "GENERATION_SETTINGS_INVALID", message: expect.stringContaining("OpenAI") });
    expect(await db.select({ id: aiGenerationJobs.id }).from(aiGenerationJobs).where(eq(aiGenerationJobs.userId, owner.userId))).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each<{ modelId: string; parameters: Record<string, string> }>([
    { modelId: "gpt-image-2.5-sunburst", parameters: {} },
    { modelId: "verified-future-image-model", parameters: { imageModelFamily: "custom" } },
  ])("queues the original model ID for a valid or explicitly declared contract: $modelId", async ({ modelId, parameters }) => {
    const owner = await fixture(modelId, parameters);
    const { handlers, enqueue, upload } = serviceFixture();
    const response = await handlers.POST(request("/api/v1/generations", {
      idempotencyKey: randomUUID(), modelProfileId: owner.modelProfileId,
      prompt: "Synthetic paper observatory", width: 1024, height: 1024, quality: "auto", imageCount: 1,
    }, owner.cookie));
    expect(response.status).toBe(201);
    const result = (await response.json()).data;
    expect(result).toMatchObject({ modelId, status: "queued", modelProfileId: owner.modelProfileId });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });
});
