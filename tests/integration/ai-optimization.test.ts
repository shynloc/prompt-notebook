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

describe("AI prompt optimization", () => {
  it("uses the signed-in user's selected encrypted model without returning credentials", async () => {
    const owner = await sessionFor("optimizer-owner");
    await configureOptimizer(owner.cookie);
    const optimizePrompt = vi.fn(async (input: { apiKey: string; modelId: string; prompt: string }) => {
      expect(input.apiKey).toBe("sk-server-only");
      expect(input.modelId).toBe("writer-model");
      expect(input.prompt).toBe("make this better");
      return { optimizedPrompt: "A precise, production-ready prompt" };
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
    });
    expect(JSON.stringify(body)).not.toContain("sk-server-only");
    expect(optimizePrompt).toHaveBeenCalledOnce();
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
  });
});
