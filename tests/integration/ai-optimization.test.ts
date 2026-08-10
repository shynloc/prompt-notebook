// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { POST as createConfiguration } from "@/app/api/v1/ai/configurations/route";
import { PATCH as patchPreference } from "@/app/api/v1/ai/preferences/route";
import { createOptimizeHandler } from "@/app/api/v1/ai/optimize/route";
import { auth } from "@/lib/auth/server";
import { PromptOptimizer } from "@/modules/ai/prompt-optimizer";
import { AiProviderRegistry } from "@/modules/ai/provider-registry";

process.env.AI_CREDENTIAL_ENCRYPTION_KEYS = `test:${randomBytes(32).toString("base64url")}`;
process.env.AI_CREDENTIAL_ACTIVE_KEY_ID = "test";

const base = "http://localhost:3000";

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

async function configureOptimizer(cookie: string) {
  const response = await createConfiguration(request(`${base}/api/v1/ai/configurations`, {
    cookie,
    body: {
      name: "Optimizer",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-server-only",
      modelId: "writer-model",
      displayName: "Writer Model",
      capabilities: ["prompt_optimization"],
      defaultParameters: { temperature: 0.35 },
    },
  }));
  const created = (await response.json()).data;
  await patchPreference(request(`${base}/api/v1/ai/preferences`, {
    cookie,
    method: "PATCH",
    body: { purpose: "prompt_optimization", modelProfileId: created.modelProfileId },
  }));
  return created;
}

function structuredGeneral(content: string) {
  return JSON.stringify({
    version: 1,
    context: "general",
    artifactLabel: "general prompt",
    intents: { purposes: ["instructional"], media: ["unspecified"], subjects: ["other"] },
    selectedModules: ["general"],
    capabilities: [],
    sections: [{ module: "general", content }],
    warnings: [],
  });
}

describe("AI prompt optimization", () => {
  it("uses the signed-in user's selected encrypted model without returning credentials", async () => {
    const owner = await sessionFor("optimizer-owner");
    await configureOptimizer(owner.cookie);
    const optimizePrompt = vi.fn(async (input: { apiKey: string; modelId: string; prompt: string; systemInstruction: string }) => {
      expect(input.apiKey).toBe("sk-server-only");
      expect(input.modelId).toBe("writer-model");
      expect(JSON.parse(input.prompt)).toMatchObject({
        contextHint: "auto",
        requestedModules: [],
        prompt: "make this better",
      });
      expect(input.systemInstruction).not.toContain("make this better");
      return { optimizedPrompt: structuredGeneral("A precise, production-ready prompt") };
    });
    const optimizer = new PromptOptimizer(new AiProviderRegistry([{
      type: "openai_compatible",
      testConnection: vi.fn(),
      optimizePrompt,
    }]), { consume: () => true });
    const response = await createOptimizeHandler(optimizer)(request(`${base}/api/v1/ai/optimize`, {
      cookie: owner.cookie,
      body: { prompt: "make this better" },
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      optimizedPrompt: "A precise, production-ready prompt",
      model: { id: "writer-model", name: "Writer Model" },
      structure: {
        version: 1,
        format: "structured",
        context: "general",
        selectedModules: ["general"],
      },
    });
    expect(JSON.stringify(body)).not.toContain("sk-server-only");
    expect(optimizePrompt).toHaveBeenCalledOnce();
  });

  it("classifies and renders a mixed image prompt in one provider call", async () => {
    const owner = await sessionFor("optimizer-image");
    await configureOptimizer(owner.cookie);
    const optimizePrompt = vi.fn(async (input: { prompt: string }) => {
      expect(JSON.parse(input.prompt)).toMatchObject({
        contextHint: "image_generation",
        requestedModules: ["content", "information"],
        hints: { hasAiModel: true, referenceImageCount: 2, aspectRatio: "9:16" },
        lockedLiterals: expect.arrayContaining([
          { kind: "quoted_text", value: "立即体验" },
          { kind: "numeric_literal", value: "9:16" },
        ]),
      });
      return { optimizedPrompt: JSON.stringify({
        version: 1,
        context: "image_generation",
        artifactLabel: "人物与产品商业海报",
        intents: {
          purposes: ["promotional"],
          media: ["photography", "graphic_design"],
          subjects: ["people", "product", "typography"],
        },
        selectedModules: ["information", "content", "organization", "constraints_output"],
        capabilities: ["identity_reference", "product_integrity", "typography_copy", "brand_layout"],
        sections: [
          { module: "information", content: "准确显示“立即体验”。" },
          { module: "constraints_output", content: "采用 9:16 竖版。" },
          { module: "organization", content: "建立清晰的标题与产品层级。" },
          { module: "content", content: "人物展示产品，保持人物身份和包装外观。" },
        ],
        warnings: [],
      }) };
    });
    const optimizer = new PromptOptimizer(new AiProviderRegistry([{
      type: "openai_compatible",
      testConnection: vi.fn(),
      optimizePrompt,
    }]), { consume: () => true });

    const response = await createOptimizeHandler(optimizer)(request(`${base}/api/v1/ai/optimize`, {
      cookie: owner.cookie,
      body: {
        prompt: "生成一张人物产品海报，文案“立即体验”，9:16",
        context: "image_generation",
        requestedModules: ["content", "information"],
        hints: { hasAiModel: true, referenceImageCount: 2, aspectRatio: "9:16" },
      },
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.optimizedPrompt.indexOf("【主体与内容】")).toBeLessThan(body.data.optimizedPrompt.indexOf("【构图与组织】"));
    expect(body.data.structure).toMatchObject({
      format: "structured",
      context: "image_generation",
      artifactLabel: "人物与产品商业海报",
      requestedModules: ["content", "information"],
      lockedFacts: expect.arrayContaining([
        { kind: "quoted_text", value: "立即体验", preserved: true },
        { kind: "numeric_literal", value: "9:16", preserved: true },
      ]),
    });
    expect(optimizePrompt).toHaveBeenCalledOnce();
  });

  it("returns a blocking warning when prompt and ImageHub aspect ratios conflict", async () => {
    const owner = await sessionFor("optimizer-aspect-conflict");
    await configureOptimizer(owner.cookie);
    const optimizePrompt = vi.fn(async () => ({ optimizedPrompt: JSON.stringify({
      version: 1,
      context: "image_generation",
      artifactLabel: "product poster",
      intents: { purposes: ["promotional"], media: ["graphic_design"], subjects: ["product"] },
      selectedModules: ["content", "constraints_output"],
      capabilities: ["brand_layout"],
      sections: [
        { module: "content", content: "A centered product." },
        { module: "constraints_output", content: "Use the requested 16:9 layout." },
      ],
      warnings: [],
    }) }));
    const optimizer = new PromptOptimizer(new AiProviderRegistry([{
      type: "openai_compatible",
      testConnection: vi.fn(),
      optimizePrompt,
    }]), { consume: () => true });
    const response = await createOptimizeHandler(optimizer)(request(`${base}/api/v1/ai/optimize`, {
      cookie: owner.cookie,
      body: {
        prompt: "Create a 16:9 product poster.",
        context: "image_generation",
        hints: { aspectRatio: "9:16" },
      },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.structure.warnings).toContainEqual(expect.objectContaining({
      code: "aspect_ratio_conflict",
      blocking: true,
    }));
  });

  it("keeps a clearly natural-language provider response as a compatible plain fallback", async () => {
    const owner = await sessionFor("optimizer-plain");
    await configureOptimizer(owner.cookie);
    const optimizePrompt = vi.fn(async () => ({ optimizedPrompt: "A concise production-ready prompt." }));
    const optimizer = new PromptOptimizer(new AiProviderRegistry([{
      type: "openai_compatible",
      testConnection: vi.fn(),
      optimizePrompt,
    }]), { consume: () => true });
    const response = await createOptimizeHandler(optimizer)(request(`${base}/api/v1/ai/optimize`, {
      cookie: owner.cookie,
      body: { prompt: "make this better" },
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      optimizedPrompt: "A concise production-ready prompt.",
      structure: {
        format: "plain_fallback",
        context: "general",
        warnings: [expect.objectContaining({ code: "plain_text_fallback", blocking: false })],
      },
    });
    expect(optimizePrompt).toHaveBeenCalledOnce();
  });

  it("rejects malformed JSON-like provider output without a second call or broken-text fallback", async () => {
    const owner = await sessionFor("optimizer-malformed");
    await configureOptimizer(owner.cookie);
    const sensitivePrompt = "private-campaign-brief-ACME-42";
    const sensitiveProviderOutput = '{"version":1,"sections":["private-provider-fragment"';
    const optimizePrompt = vi.fn(async () => ({ optimizedPrompt: sensitiveProviderOutput }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const optimizer = new PromptOptimizer(new AiProviderRegistry([{
      type: "openai_compatible",
      testConnection: vi.fn(),
      optimizePrompt,
    }]), { consume: () => true });
    const response = await createOptimizeHandler(optimizer)(request(`${base}/api/v1/ai/optimize`, {
      cookie: owner.cookie,
      body: { prompt: sensitivePrompt },
    }));
    expect(response.status).toBe(502);
    const responseBody = await response.json();
    expect(responseBody.error.code).toBe("AI_OPTIMIZATION_INVALID");
    expect(JSON.stringify(responseBody)).not.toContain(sensitivePrompt);
    expect(JSON.stringify(responseBody)).not.toContain("private-provider-fragment");
    expect(consoleError).not.toHaveBeenCalled();
    expect(optimizePrompt).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("requires authentication and an explicitly selected optimization model", async () => {
    const unauthenticated = await createOptimizeHandler()(request(`${base}/api/v1/ai/optimize`, {
      body: { prompt: "hello" },
    }));
    expect(unauthenticated.status).toBe(401);

    const owner = await sessionFor("optimizer-missing");
    const response = await createOptimizeHandler()(request(`${base}/api/v1/ai/optimize`, {
      cookie: owner.cookie,
      body: { prompt: "hello" },
    }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("AI_OPTIMIZER_NOT_CONFIGURED");
  });

  it("rejects oversized input before calling a provider", async () => {
    const owner = await sessionFor("optimizer-bounds");
    const response = await createOptimizeHandler()(request(`${base}/api/v1/ai/optimize`, {
      cookie: owner.cookie,
      body: { prompt: "x".repeat(50_001) },
    }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");

    const invalidHints = await createOptimizeHandler()(request(`${base}/api/v1/ai/optimize`, {
      cookie: owner.cookie,
      body: { prompt: "valid", hints: { referenceImageCount: 5 } },
    }));
    expect(invalidHints.status).toBe(422);

    const duplicateModules = await createOptimizeHandler()(request(`${base}/api/v1/ai/optimize`, {
      cookie: owner.cookie,
      body: { prompt: "valid", requestedModules: ["content", "content"] },
    }));
    expect(duplicateModules.status).toBe(422);

    for (const body of [
      { prompt: "valid", context: "image_generation", requestedModules: ["general"] },
      { prompt: "valid", context: "general", requestedModules: ["content"] },
      { prompt: "valid", context: "auto", requestedModules: ["general", "content"] },
    ]) {
      const contradictory = await createOptimizeHandler()(request(`${base}/api/v1/ai/optimize`, {
        cookie: owner.cookie,
        body,
      }));
      expect(contradictory.status).toBe(422);
      expect((await contradictory.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });
});
