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
import { reverseModelFixture } from "@/test/reverse-fixture";

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

  it("accepts GPT Image 2.5 multipart settings, reference images, and masks and forwards only server buffers", async () => {
    const owner = await sessionFor();
    const create = vi.fn(async (_userId: string, input: { referenceImages?: Buffer[] }) => ({ id: randomUUID(), count: input.referenceImages?.length }));
    const handlers = createGenerationHandlers({ create, list: vi.fn() });
    const form = new FormData();
    form.set("payload", JSON.stringify({
      idempotencyKey: randomUUID(),
      prompt: "A paper observatory under a red moon",
      width: 3840,
      height: 2160,
      quality: "max",
      outputFormat: "webp",
      background: "transparent",
      outputCompression: 68,
      imageCount: 1,
    }));
    form.append("references", new File([png], "reference.png", { type: "image/png" }));
    form.set("mask", new File([png], "mask.png", { type: "image/png" }));
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
      quality: "max",
      outputFormat: "webp",
      background: "transparent",
      outputCompression: 68,
      referenceImages: [png],
      maskImage: png,
    }));
  });

  it("accepts xhigh JSON requests while ignoring client-supplied server buffer fields", async () => {
    const owner = await sessionFor();
    const create = vi.fn(async (_userId: string, input: { quality: string }) => ({ id: randomUUID(), quality: input.quality }));
    const handlers = createGenerationHandlers({ create, list: vi.fn() });
    const response = await handlers.POST(request(`${base}/api/v1/generations`, {
      cookie: owner.cookie, method: "POST", type: "application/json",
      body: JSON.stringify({
        idempotencyKey: randomUUID(), prompt: "An editorial landscape", width: 1024, height: 1024,
        quality: "xhigh", outputFormat: "png", background: "transparent", imageCount: 1,
        referenceImages: ["client-controlled buffer"], maskImage: "client-controlled mask",
      }),
    }));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(owner.userId, expect.objectContaining({
      quality: "xhigh", outputFormat: "png", background: "transparent", referenceImages: [],
    }));
    expect(create.mock.calls[0][1]).not.toHaveProperty("maskImage");
  });

  it("rejects duplicate masks, non-file masks, empty masks, and unrecognized multipart fields before calling the service", async () => {
    const owner = await sessionFor();
    const create = vi.fn(async () => ({ id: randomUUID() }));
    const handlers = createGenerationHandlers({ create, list: vi.fn() });
    for (const scenario of ["duplicate", "text", "empty-file", "unknown"] as const) {
      const form = new FormData();
      form.set("payload", JSON.stringify({ idempotencyKey: randomUUID(), prompt: "Edit this picture", width: 1024, height: 1024, quality: "max", imageCount: 1 }));
      form.append("references", new File([png], "reference.png", { type: "image/png" }));
      if (scenario === "duplicate") {
        form.append("mask", new File([png], "one.png", { type: "image/png" }));
        form.append("mask", new File([png], "two.png", { type: "image/png" }));
      } else if (scenario === "text") form.set("mask", "not a file");
      else if (scenario === "empty-file") form.set("mask", new File([], "empty.png", { type: "image/png" }));
      else form.set("apiKey", "must not be forwarded");
      const response = await handlers.POST(request(`${base}/api/v1/generations`, { cookie: owner.cookie, method: "POST", body: form }));
      expect(response.status, scenario).toBe(422);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("enforces the 44 MiB combined multipart budget for references, mask, and form overhead", async () => {
    const owner = await sessionFor();
    const create = vi.fn(async () => ({ id: randomUUID() }));
    const handlers = createGenerationHandlers({ create, list: vi.fn() });
    const form = new FormData();
    form.set("payload", JSON.stringify({ idempotencyKey: randomUUID(), prompt: "Edit within the total request budget", width: 1024, height: 1024, quality: "xhigh", imageCount: 1 }));
    form.append("references", new File([png], "reference.png", { type: "image/png" }));
    form.set("mask", new File([png], "mask.png", { type: "image/png" }));
    // A declared content length isolates the admission boundary without allocating
    // a 44 MiB fixture. Per-file 10 MiB limits do not override this shared budget.
    const exact = request(`${base}/api/v1/generations`, { cookie: owner.cookie, method: "POST", body: form });
    exact.headers.set("content-length", String(44 * 1024 * 1024));
    expect((await handlers.POST(exact)).status).toBe(201);
    const over = request(`${base}/api/v1/generations`, { cookie: owner.cookie, method: "POST", body: form });
    over.headers.set("content-length", String(44 * 1024 * 1024 + 1));
    const response = await handlers.POST(over);
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("GENERATION_REQUEST_TOO_LARGE");
    expect(create).toHaveBeenCalledOnce();
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
    expect(reverse).toHaveBeenCalledWith(owner.userId, expect.any(Buffer), "image/png", expect.any(AbortSignal), { additionalRequirements: "", language: "zh" });
    expect((await response.json()).data.prompt).toContain("miniature");
  });

  it("uses only the owner's encrypted reverse-prompt model and never returns its secret", async () => {
    const owner = await sessionFor();
    const other = await sessionFor();
    await configureReverseModel(owner.cookie);
    const reversePrompt = vi.fn(async (input: { apiKey: string; userInstruction?: string; systemInstruction?: string }) => {
      expect(input.apiKey).toBe("sk-vision-secret");
      expect(JSON.parse(input.userInstruction!)).toMatchObject({ additionalRequirements: "把衬衫改成蓝色", language: "zh" });
      expect(input.systemInstruction).not.toContain("把衬衫改成蓝色");
      return { prompt: JSON.stringify(reverseModelFixture) };
    });
    const service = new ReversePromptService(new AiProviderRegistry([{
      type: "openai_compatible",
      testConnection: vi.fn(),
      reversePrompt,
    }]));
    const result = await service.reverse(owner.userId, png, "image/png", undefined, { additionalRequirements: "把衬衫改成蓝色", language: "zh" });
    expect(result).toMatchObject({ prompt: expect.stringContaining("蓝色衬衫"), model: { name: "Vision Model" } });
    expect(JSON.stringify(result)).not.toContain("sk-vision-secret");
    await expect(service.reverse(other.userId, png, "image/png"))
      .rejects.toMatchObject({ code: "AI_REVERSE_PROMPT_NOT_CONFIGURED", status: 422 });
  });

  it("authenticates reverse requests and bounds user requirements before invoking the provider", async () => {
    const reverse = vi.fn(async () => ({ prompt: "valid" }));
    const handler = createReversePromptHandler({ reverse });
    const url = `${base}/api/v1/ai/reverse-prompt`;
    expect((await handler(request(url, { method: "POST", type: "application/json", body: "{}" }))).status).toBe(401);
    const owner = await sessionFor();
    for (const requirements of ["把衬衫改成蓝色", "x".repeat(2_001)]) {
      const form = new FormData(); form.set("image", new File([png], "source.png", { type: "image/png" })); form.set("additionalRequirements", requirements);
      const response = await handler(request(url, { method: "POST", cookie: owner.cookie, body: form }));
      expect(response.status).toBe(requirements.length > 2_000 ? 422 : 200);
    }
    expect(reverse).toHaveBeenCalledTimes(1);
    expect(reverse).toHaveBeenCalledWith(owner.userId, expect.any(Buffer), "image/png", expect.any(AbortSignal), { additionalRequirements: "把衬衫改成蓝色", language: "zh" });
    const invalid = new FormData(); invalid.set("image", new File(["not an image"], "fake.png", { type: "image/png" }));
    expect((await handler(request(url, { method: "POST", cookie: owner.cookie, body: invalid }))).status).toBe(422);
    const duplicate = new FormData(); duplicate.set("image", new File([png], "source.png", { type: "image/png" })); duplicate.append("language", "zh"); duplicate.append("language", "en");
    expect((await handler(request(url, { method: "POST", cookie: owner.cookie, body: duplicate }))).status).toBe(422);
    expect((await handler(request(url, { method: "POST", cookie: owner.cookie, type: "application/json", body: JSON.stringify({ imageUrl: "http://127.0.0.1/private.png" }) }))).status).toBe(422);
  });
});
