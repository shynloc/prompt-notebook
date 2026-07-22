// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { DELETE as deleteConfiguration, PATCH as patchConfiguration } from "@/app/api/v1/ai/configurations/[id]/route";
import { GET as listConfigurations, POST as createConfiguration } from "@/app/api/v1/ai/configurations/route";
import { GET as listPreferences, PATCH as patchPreference } from "@/app/api/v1/ai/preferences/route";
import { db } from "@/db/client";
import { aiModelPreferences, aiProviderConnections } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { AiConfigurationService } from "@/modules/ai/ai-configuration-service";
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

const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe("AI configuration API", () => {
  it("encrypts credentials, masks responses, and isolates owners", async () => {
    const owner = await sessionFor("ai-owner");
    const other = await sessionFor("ai-other");
    const apiKey = `sk-${randomUUID()}`;
    const createdResponse = await createConfiguration(request(`${base}/api/v1/ai/configurations`, {
      cookie: owner.cookie,
      body: {
        name: "Primary writer",
        providerType: "openai_compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey,
        modelId: "writer-model",
        displayName: "Writer Model",
        capabilities: ["prompt_optimization", "reverse_prompt"],
      },
    }));
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).data;
    expect(created.secretHint).toBe(`••••${apiKey.slice(-4)}`);
    expect(JSON.stringify(created)).not.toContain(apiKey);
    expect(JSON.stringify(created)).not.toContain("encryptedSecret");

    const [stored] = await db.select().from(aiProviderConnections).where(and(
      eq(aiProviderConnections.id, created.id),
      eq(aiProviderConnections.userId, owner.userId),
    ));
    expect(stored.encryptedSecret).not.toContain(apiKey);
    expect(stored.secretAuthTag).toBeTruthy();

    const otherList = await listConfigurations(request(`${base}/api/v1/ai/configurations`, { cookie: other.cookie }));
    expect((await otherList.json()).data).toHaveLength(0);
    const crossUserPatch = await patchConfiguration(request(`${base}/api/v1/ai/configurations/${created.id}`, {
      cookie: other.cookie,
      method: "PATCH",
      body: { name: "Stolen" },
    }), context(created.id));
    expect(crossUserPatch.status).toBe(404);
  });

  it("assigns only enabled models with the required capability", async () => {
    const owner = await sessionFor("ai-preference");
    const createdResponse = await createConfiguration(request(`${base}/api/v1/ai/configurations`, {
      cookie: owner.cookie,
      body: {
        name: "Optimizer only",
        providerType: "openai_compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-optimizer",
        modelId: "optimizer-model",
        displayName: "Optimizer",
        capabilities: ["prompt_optimization"],
      },
    }));
    const created = (await createdResponse.json()).data;

    const mismatch = await patchPreference(request(`${base}/api/v1/ai/preferences`, {
      cookie: owner.cookie,
      method: "PATCH",
      body: { purpose: "image_generation", modelProfileId: created.modelProfileId },
    }));
    expect(mismatch.status).toBe(422);
    expect((await mismatch.json()).error.code).toBe("AI_MODEL_CAPABILITY_MISMATCH");

    const assigned = await patchPreference(request(`${base}/api/v1/ai/preferences`, {
      cookie: owner.cookie,
      method: "PATCH",
      body: { purpose: "prompt_optimization", modelProfileId: created.modelProfileId },
    }));
    expect(assigned.status).toBe(200);
    const listed = await listPreferences(request(`${base}/api/v1/ai/preferences`, { cookie: owner.cookie }));
    expect((await listed.json()).data).toEqual([
      { purpose: "prompt_optimization", modelProfileId: created.modelProfileId },
    ]);

    await patchConfiguration(request(`${base}/api/v1/ai/configurations/${created.id}`, {
      cookie: owner.cookie,
      method: "PATCH",
      body: { enabled: false },
    }), context(created.id));
    const disabled = await patchPreference(request(`${base}/api/v1/ai/preferences`, {
      cookie: owner.cookie,
      method: "PATCH",
      body: { purpose: "prompt_optimization", modelProfileId: created.modelProfileId },
    }));
    expect(disabled.status).toBe(422);
    const preferencesAfterDisable = await listPreferences(request(`${base}/api/v1/ai/preferences`, { cookie: owner.cookie }));
    expect((await preferencesAfterDisable.json()).data).toHaveLength(0);
  });

  it("updates secrets without returning them and cascades preferences on delete", async () => {
    const owner = await sessionFor("ai-update");
    const createdResponse = await createConfiguration(request(`${base}/api/v1/ai/configurations`, {
      cookie: owner.cookie,
      body: {
        name: "Mutable",
        baseUrl: "https://api.example.com/v1",
        apiKey: "old-secret",
        modelId: "model-a",
        displayName: "Model A",
        capabilities: ["prompt_optimization"],
      },
    }));
    const created = (await createdResponse.json()).data;
    await patchPreference(request(`${base}/api/v1/ai/preferences`, {
      cookie: owner.cookie,
      method: "PATCH",
      body: { purpose: "prompt_optimization", modelProfileId: created.modelProfileId },
    }));

    const updatedResponse = await patchConfiguration(request(`${base}/api/v1/ai/configurations/${created.id}`, {
      cookie: owner.cookie,
      method: "PATCH",
      body: { apiKey: "new-secret", displayName: "Model A2" },
    }), context(created.id));
    const updated = (await updatedResponse.json()).data;
    expect(updated.secretHint).toBe("••••cret");
    expect(updated.displayName).toBe("Model A2");
    expect(JSON.stringify(updated)).not.toContain("new-secret");

    const deleted = await deleteConfiguration(request(`${base}/api/v1/ai/configurations/${created.id}`, {
      cookie: owner.cookie,
      method: "DELETE",
    }), context(created.id));
    expect(deleted.status).toBe(200);
    expect(await db.select().from(aiModelPreferences).where(eq(aiModelPreferences.userId, owner.userId))).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const response = await listConfigurations(request(`${base}/api/v1/ai/configurations`));
    expect(response.status).toBe(401);
  });

  it("decrypts a secret only for a bounded server-side connection test", async () => {
    const owner = await sessionFor("ai-test");
    const createdResponse = await createConfiguration(request(`${base}/api/v1/ai/configurations`, {
      cookie: owner.cookie,
      body: {
        name: "Testable",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-server-only",
        modelId: "model-test",
        displayName: "Model Test",
        capabilities: ["prompt_optimization"],
      },
    }));
    const created = (await createdResponse.json()).data;
    const testConnection = vi.fn(async (input: { baseUrl: string; apiKey: string }) => {
      expect(input.apiKey).toBe("sk-server-only");
      return { ok: true as const, latencyMs: 7, availableModelIds: ["model-test"] };
    });
    const service = new AiConfigurationService(new AiProviderRegistry([{
      type: "openai_compatible",
      testConnection,
    }]));
    expect(await service.test(owner.userId, created.id)).toEqual({
      ok: true,
      latencyMs: 7,
      availableModelIds: ["model-test"],
    });
    await expect(service.test(owner.userId, created.id)).rejects.toMatchObject({
      code: "AI_CONNECTION_TEST_RATE_LIMITED",
      status: 429,
    });
    expect(testConnection).toHaveBeenCalledTimes(1);
  });
});
