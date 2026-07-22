// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { DELETE, GET, PUT } from "@/app/api/v1/settings/storage/route";
import { db } from "@/db/client";
import { mediaStorageSettings } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { MediaStorageConfigurationService } from "@/modules/media/media-storage-configuration-service";

process.env.CREDENTIAL_ENCRYPTION_KEYS = `test:${randomBytes(32).toString("base64url")}`;
process.env.CREDENTIAL_ACTIVE_KEY_ID = "test";

const base = "http://localhost:3000";

function request(url: string, options: { body?: unknown; cookie?: string; method?: string } = {}) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "PUT"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function sessionFor(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await auth.handler(request(`${base}/api/auth/sign-up/email`, { method: "POST", body: { name: label, email, password } }));
  const response = await auth.handler(request(`${base}/api/auth/sign-in/email`, { method: "POST", body: { email, password } }));
  const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("no session");
  const cookie = `better-auth.session_token=${token}`;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("no authenticated session");
  return { cookie, userId: session.user.id };
}

describe("media storage configuration API", () => {
  it("encrypts tokens, returns only a hint, preserves omitted tokens, and isolates owners", async () => {
    const owner = await sessionFor("storage-owner");
    const other = await sessionFor("storage-other");
    const token = `image-${randomUUID()}`;
    const createdResponse = await PUT(request(`${base}/api/v1/settings/storage`, {
      cookie: owner.cookie,
      body: { endpoint: "https://images.example.com/upload", token, enabled: true },
    }));
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()).data;
    expect(created.tokenHint).toBe(`••••${token.slice(-4)}`);
    expect(JSON.stringify(created)).not.toContain(token);
    expect(JSON.stringify(created)).not.toContain("encryptedSecret");

    const [stored] = await db.select().from(mediaStorageSettings)
      .where(eq(mediaStorageSettings.userId, owner.userId));
    expect(stored.encryptedSecret).not.toContain(token);
    expect(stored.secretAuthTag).toBeTruthy();

    const otherResponse = await GET(request(`${base}/api/v1/settings/storage`, { cookie: other.cookie }));
    expect((await otherResponse.json()).data).toBeNull();

    const updatedResponse = await PUT(request(`${base}/api/v1/settings/storage`, {
      cookie: owner.cookie,
      body: { endpoint: "https://cdn.example.com/picbed", enabled: true },
    }));
    expect(updatedResponse.status).toBe(200);
    const [updated] = await db.select().from(mediaStorageSettings)
      .where(eq(mediaStorageSettings.userId, owner.userId));
    expect(updated.encryptedSecret).toBe(stored.encryptedSecret);
    expect(updated.endpoint).toBe("https://cdn.example.com/picbed");

    const providerFactory = vi.fn(() => ({ upload: vi.fn() }));
    await new MediaStorageConfigurationService(providerFactory).providerFor(owner.userId);
    expect(providerFactory).toHaveBeenCalledWith("https://cdn.example.com/picbed", token);
  });

  it("requires authentication and a token for the first configuration", async () => {
    expect((await GET(request(`${base}/api/v1/settings/storage`))).status).toBe(401);
    const owner = await sessionFor("storage-required");
    const response = await PUT(request(`${base}/api/v1/settings/storage`, {
      cookie: owner.cookie,
      body: { endpoint: "https://images.example.com/upload", enabled: true },
    }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("IMAGE_STORAGE_TOKEN_REQUIRED");
  });

  it("deletes only the signed-in user's setting", async () => {
    const owner = await sessionFor("storage-delete");
    await PUT(request(`${base}/api/v1/settings/storage`, {
      cookie: owner.cookie,
      body: { endpoint: "https://images.example.com/upload", token: "delete-me", enabled: true },
    }));
    expect((await DELETE(request(`${base}/api/v1/settings/storage`, { cookie: owner.cookie, method: "DELETE" }))).status).toBe(200);
    expect(await db.select().from(mediaStorageSettings).where(eq(mediaStorageSettings.userId, owner.userId))).toHaveLength(0);
  });
});
