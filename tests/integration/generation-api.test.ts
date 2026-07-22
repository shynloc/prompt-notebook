// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createReversePromptHandler } from "@/app/api/v1/ai/reverse-prompt/route";
import { POST as createConfiguration } from "@/app/api/v1/ai/configurations/route";
import { PATCH as patchPreference } from "@/app/api/v1/ai/preferences/route";
import { createGenerationDetailHandlers } from "@/app/api/v1/generations/[id]/route";
import { createGenerationAssetDownloadHandler } from "@/app/api/v1/generations/[id]/assets/[assetId]/download/route";
import { createGenerationHandlers } from "@/app/api/v1/generations/route";
import { auth } from "@/lib/auth/server";
import { AiProviderRegistry } from "@/modules/ai/provider-registry";
import { ReversePromptService } from "@/modules/ai/reverse-prompt-service";

process.env.AI_CREDENTIAL_ENCRYPTION_KEYS = `test:${randomBytes(32).toString("base64url")}`;
process.env.AI_CREDENTIAL_ACTIVE_KEY_ID = "test";

const base = "http://localhost:3000";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function request(url: string, options: { body?: BodyInit; cookie?: string; method?: string; type?: string } = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.type) headers.set("content-type", options.type);
  return new Request(url, { method: options.method ?? "GET", headers, body: options.body });
}

async function sessionFor() {
  const email = `generation-api-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await auth.handler(new Request(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Generation API", email, password }),
  }));
  const response = await auth.handler(new Request(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));
  const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("no session");
  const cookie = `better-auth.session_token=${token}`;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("no authenticated session");
  return { cookie, userId: session.user.id };
}

async function configureReverseModel(cookie: string) {
  const response = await createConfiguration(new Request(`${base}/api/v1/ai/configurations`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: `Vision ${randomUUID()}`,
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-vision-secret",
      modelId: "vision-model",
      displayName: "Vision Model",
      capabilities: ["reverse_prompt"],
    }),
  }));
  const created = (await response.json()).data;
  await patchPreference(new Request(`${base}/api/v1/ai/preferences`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ purpose: "reverse_prompt", modelProfileId: created.modelProfileId }),
  }));
}

describe("generation API", () => {
  it("requires authentication and scopes history to the signed-in owner", async () => {
    const list = vi.fn(async () => []);
    const handlers = createGenerationHandlers({ create: vi.fn(), list });
    expect((await handlers.GET(request(`${base}/api/v1/generations`))).status).toBe(401);
    const owner = await sessionFor();
    const response = await handlers.GET(request(`${base}/api/v1/generations?limit=12&status=active`, { cookie: owner.cookie }));
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(owner.userId, { limit: 12, status: "active" });
  });

  it("accepts bounded multipart reference images and forwards only server buffers", async () => {
    const owner = await sessionFor();
    const create = vi.fn(async (_userId: string, input: { referenceImages?: Buffer[] }) => ({ id: randomUUID(), count: input.referenceImages?.length }));
    const handlers = createGenerationHandlers({ create, list: vi.fn() });
    const form = new FormData();
    form.set("payload", JSON.stringify({
      idempotencyKey: randomUUID(),
      prompt: "A paper observatory under a red moon",
      width: 3840,
      height: 2160,
      quality: "high",
      imageCount: 1,
    }));
    form.append("references", new File([png], "reference.png", { type: "image/png" }));
    const response = await handlers.POST(request(`${base}/api/v1/generations`, {
      cookie: owner.cookie,
      method: "POST",
      body: form,
    }));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(owner.userId, expect.objectContaining({
      prompt: "A paper observatory under a red moon",
      width: 3840,
      height: 2160,
      referenceImages: [expect.any(Buffer)],
    }));
  });

  it("gets, cancels, and deletes history only for validated job IDs", async () => {
    const owner = await sessionFor();
    const id = randomUUID();
    const get = vi.fn(async () => ({ id, status: "queued" }));
    const cancel = vi.fn(async () => ({ id, status: "cancelled" }));
    const removeHistory = vi.fn(async () => ({ id, deleted: true }));
    const handlers = createGenerationDetailHandlers({ get, cancel, removeHistory });
    expect((await handlers.GET(request(`${base}/api/v1/generations/not-a-uuid`, { cookie: owner.cookie }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    })).status).toBe(422);
    const response = await handlers.DELETE(request(`${base}/api/v1/generations/${id}`, { cookie: owner.cookie, method: "DELETE" }), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith(owner.userId, id);
    const deleted = await handlers.DELETE(request(`${base}/api/v1/generations/${id}?mode=history`, { cookie: owner.cookie, method: "DELETE" }), {
      params: Promise.resolve({ id }),
    });
    expect(deleted.status).toBe(200);
    expect(removeHistory).toHaveBeenCalledWith(owner.userId, id);
  });

  it("downloads an owned generated asset as a file attachment", async () => {
    const owner = await sessionFor();
    const jobId = randomUUID();
    const assetId = randomUUID();
    const downloadAsset = vi.fn(async () => ({ data: png, mimeType: "image/png", filename: "prompt-notebook-result.png" }));
    const handler = createGenerationAssetDownloadHandler({ downloadAsset });
    const response = await handler(request(`${base}/api/v1/generations/${jobId}/assets/${assetId}/download`, { cookie: owner.cookie }), {
      params: Promise.resolve({ id: jobId, assetId }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="prompt-notebook-result.png"');
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(downloadAsset).toHaveBeenCalledWith(owner.userId, jobId, assetId);
  });

  it("validates an uploaded image before calling reverse prompting", async () => {
    const owner = await sessionFor();
    const reverse = vi.fn(async () => ({ prompt: "A luminous miniature landscape", model: { id: "vision", name: "Vision" } }));
    const handler = createReversePromptHandler({ reverse });
    const form = new FormData();
    form.set("image", new File([png], "source.png", { type: "image/png" }));
    const response = await handler(request(`${base}/api/v1/ai/reverse-prompt`, { cookie: owner.cookie, method: "POST", body: form }));
    expect(response.status).toBe(200);
    expect(reverse).toHaveBeenCalledWith(owner.userId, expect.any(Buffer), "image/png", expect.any(AbortSignal));
    expect((await response.json()).data.prompt).toContain("miniature");
  });

  it("uses only the owner's encrypted reverse-prompt model and never returns its secret", async () => {
    const owner = await sessionFor();
    const other = await sessionFor();
    await configureReverseModel(owner.cookie);
    const reversePrompt = vi.fn(async (input: { apiKey: string }) => {
      expect(input.apiKey).toBe("sk-vision-secret");
      return { prompt: "A precise reconstructed image prompt" };
    });
    const service = new ReversePromptService(new AiProviderRegistry([{
      type: "openai_compatible",
      testConnection: vi.fn(),
      reversePrompt,
    }]));
    const result = await service.reverse(owner.userId, png, "image/png");
    expect(result).toMatchObject({ prompt: "A precise reconstructed image prompt", model: { name: "Vision Model" } });
    expect(JSON.stringify(result)).not.toContain("sk-vision-secret");
    await expect(service.reverse(other.userId, png, "image/png"))
      .rejects.toMatchObject({ code: "AI_REVERSE_PROMPT_NOT_CONFIGURED", status: 422 });
  });
});
