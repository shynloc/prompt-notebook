// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/server";
import { MediaService } from "@/modules/media/media-service";
import { NoteService } from "@/modules/notes/note-service";
import { ExtensionCaptureService } from "@/modules/extension/capture-service";
import { createPkceChallenge } from "@/modules/extension/token-service";
import { POST as authorize } from "@/app/api/v1/extension/authorize/route";
import { POST as capture } from "@/app/api/v1/extension/captures/route";
import { GET as extensionTags } from "@/app/api/v1/extension/tags/route";
import { POST as exchange } from "@/app/api/v1/extension/token/route";

const base = "http://127.0.0.1:3000";

function request(path: string, options: { body?: unknown; cookie?: string; bearer?: string; key?: string; method?: string } = {}) {
  const headers = new Headers();
  if (options.body) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  if (options.key) headers.set("idempotency-key", options.key);
  return new Request(`${base}${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function account() {
  const email = `capture-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  const signUp = await auth.handler(request("/api/auth/sign-up/email", { body: { name: "Capture user", email, password } }));
  const userId = (await signUp.json()).user.id as string;
  const signIn = await auth.handler(request("/api/auth/sign-in/email", { body: { email, password } }));
  const sessionToken = signIn.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!sessionToken) throw new Error("Missing session token");
  const cookie = `better-auth.session_token=${sessionToken}`;
  const verifier = randomBytes(32).toString("base64url");
  const redirectUri = `https://${"b".repeat(32)}.chromiumapp.org/prompt-notebook`;
  const approved = await authorize(request("/api/v1/extension/authorize", {
    cookie,
    body: { codeChallenge: createPkceChallenge(verifier), redirectUri, deviceName: "Capture test" },
  }));
  const code = (await approved.json()).data.code;
  const exchanged = await exchange(request("/api/v1/extension/token", { body: { code, codeVerifier: verifier, redirectUri } }));
  return { userId, cookie, accessToken: (await exchanged.json()).data.accessToken as string };
}

describe("extension prompt capture", () => {
  it("creates a source-bearing prompt once and exposes its tag to the same device", async () => {
    const { accessToken } = await account();
    const key = randomUUID();
    const body = {
      title: "Collected cinematic prompt",
      prompt: "cinematic city at night",
      tags: ["X 收藏", "赛博朋克"],
      sourceUrl: "https://example.com/post/1",
      sourceTitle: "An example post",
      imageUrls: [],
    };
    const first = await capture(request("/api/v1/extension/captures", { bearer: accessToken, key, body }));
    const firstBody = await first.json();
    const replay = await capture(request("/api/v1/extension/captures", { bearer: accessToken, key, body }));
    const replayBody = await replay.json();
    const tags = await extensionTags(request("/api/v1/extension/tags", { bearer: accessToken }));

    expect(first.status).toBe(201);
    expect(firstBody.data.note).toMatchObject({ sourceUrl: body.sourceUrl, sourceTitle: body.sourceTitle, captureMethod: "extension" });
    expect(replay.status).toBe(200);
    expect(replayBody.data.note.id).toBe(firstBody.data.note.id);
    expect(replayBody.data.replayed).toBe(true);
    expect((await tags.json()).data.map((tag: { name: string }) => tag.name)).toEqual(expect.arrayContaining(body.tags));
  });

  it("keeps the text and successful images when another candidate fails", async () => {
    const { userId } = await account();
    const media = {
      async importUrl(_userId: string, url: string) {
        if (url.includes("broken")) throw new Error("remote image blocked");
        return {
          storageProvider: "picbed" as const,
          objectKey: "extension/good.jpg",
          displayUrl: "https://img.example/good.jpg",
          thumbnailUrl: "https://img.example/good.jpg",
          mimeType: "image/jpeg" as const,
          width: 1200,
          height: 800,
          sizeBytes: 42_000,
        };
      },
    } as MediaService;
    const service = new ExtensionCaptureService(new NoteService(), media);
    const result = await service.capture(userId, randomUUID(), {
      title: "Partial image import",
      prompt: "keep the important words",
      tags: [],
      sourceUrl: "https://example.com/source",
      imageUrls: ["https://example.com/good.jpg", "https://example.com/broken.jpg"],
    });

    expect(result.note.prompt).toBe("keep the important words");
    expect(result.note.images).toHaveLength(1);
    expect(result.imageWarnings).toEqual([{ url: "https://example.com/broken.jpg", message: "remote image blocked" }]);
  });

  it("rejects a changed payload that reuses an idempotency key", async () => {
    const { accessToken } = await account();
    const key = randomUUID();
    const original = { title: "Original", prompt: "first", tags: [], sourceUrl: "https://example.com/one", imageUrls: [] };
    await capture(request("/api/v1/extension/captures", { bearer: accessToken, key, body: original }));
    const conflict = await capture(request("/api/v1/extension/captures", { bearer: accessToken, key, body: { ...original, prompt: "changed" } }));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});

