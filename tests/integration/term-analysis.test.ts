// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { POST as createConfiguration } from "@/app/api/v1/ai/configurations/route";
import { PATCH as patchPreference } from "@/app/api/v1/ai/preferences/route";
import { createAnalyzeTermsHandler } from "@/app/api/v1/terms/analyze/route";
import { auth } from "@/lib/auth/server";
import { AiProviderRegistry } from "@/modules/ai/provider-registry";
import { TermAnalyzer } from "@/modules/terms/term-analyzer";

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
  return { cookie: `better-auth.session_token=${token}` };
}

async function configureTextModel(cookie: string) {
  const response = await createConfiguration(request(`${base}/api/v1/ai/configurations`, {
    cookie,
    body: {
      name: "Term curator",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-term-server-only",
      modelId: "curator-model",
      displayName: "Curator Model",
      capabilities: ["prompt_optimization"],
      defaultParameters: { temperature: 0.2 },
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

describe("AI term analysis", () => {
  it("inherits the optimization model, decrypts only on the server and marks built-in duplicates", async () => {
    const owner = await sessionFor("term-analyzer-owner");
    await configureTextModel(owner.cookie);
    const optimizePrompt = vi.fn(async (input: { apiKey: string; modelId: string; prompt: string; systemInstruction: string }) => {
      expect(input.apiKey).toBe("sk-term-server-only");
      expect(input.modelId).toBe("curator-model");
      expect(input.prompt).toContain("volumetric lighting");
      expect(input.systemInstruction).toContain("exact contiguous excerpt");
      return { optimizedPrompt: JSON.stringify({ candidates: [
        { category: "光线", label: "体积光", value: "volumetric lighting", confidence: "high" },
        { category: "人物", label: "银发人物", value: "silver-haired subject", confidence: "medium" },
        { category: "风格", label: "模型虚构内容", value: "not in original prompt", confidence: "low" },
      ] }) };
    });
    const analyzer = new TermAnalyzer(new AiProviderRegistry([{
      type: "openai_compatible",
      testConnection: vi.fn(),
      optimizePrompt,
    }]), { consume: () => true });
    const response = await createAnalyzeTermsHandler(analyzer)(request(`${base}/api/v1/terms/analyze`, {
      cookie: owner.cookie,
      body: { prompt: "A silver-haired subject under volumetric lighting in a quiet studio" },
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.model).toEqual({ id: "curator-model", name: "Curator Model", inherited: true });
    expect(body.data.candidates).toHaveLength(2);
    expect(body.data.candidates[0].duplicate).toMatchObject({ kind: "exact", builtIn: true });
    expect(body.data.candidates[1].duplicate).toBeNull();
    expect(JSON.stringify(body)).not.toContain("sk-term-server-only");
    expect(optimizePrompt).toHaveBeenCalledOnce();
  });

  it("requires authentication and a configured text model", async () => {
    const unauthenticated = await createAnalyzeTermsHandler()(request(`${base}/api/v1/terms/analyze`, {
      body: { prompt: "cinematic portrait lighting" },
    }));
    expect(unauthenticated.status).toBe(401);

    const owner = await sessionFor("term-analyzer-unconfigured");
    const unconfigured = await createAnalyzeTermsHandler()(request(`${base}/api/v1/terms/analyze`, {
      cookie: owner.cookie,
      body: { prompt: "cinematic portrait lighting" },
    }));
    expect(unconfigured.status).toBe(422);
    expect((await unconfigured.json()).error.code).toBe("AI_TERM_ANALYZER_NOT_CONFIGURED");
  });
});
