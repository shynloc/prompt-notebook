// @vitest-environment node

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/server";
import { GET as listNotes, POST as createNote } from "@/app/api/v1/notes/route";
import { GET as listTags } from "@/app/api/v1/tags/route";
import { GET as listTerms, POST as createTerm } from "@/app/api/v1/terms/route";
import { POST as uploadImage } from "@/app/api/v1/uploads/route";

function request(url: string, options: { body?: unknown; cookie?: string } = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, { method: options.body === undefined ? "GET" : "POST", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}

async function session(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await auth.handler(request("http://localhost:3000/api/auth/sign-up/email", { body: { name: label, email, password } }));
  const response = await auth.handler(request("http://localhost:3000/api/auth/sign-in/email", { body: { email, password } }));
  const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("missing session");
  return `better-auth.session_token=${token}`;
}

describe("visual notebook features", () => {
  it("requires authentication before processing an upload", async () => {
    const form = new FormData();
    form.append("file", new Blob(["not-an-image"]), "test.png");
    const response = await uploadImage(new Request("http://localhost:3000/api/v1/uploads", { method: "POST", body: form }));
    expect(response.status).toBe(401);
  });

  it("stores tags and images and searches across title, prompt and tags", async () => {
    const cookie = await session("visual-library");
    const objectKey = `test/${randomUUID()}.png`;
    const created = await createNote(request("http://localhost:3000/api/v1/notes", { cookie, body: {
      title: "雨夜电影场景",
      prompt: "a reflective city street",
      tags: ["电影感", "夜景"],
      images: [{ storageProvider: "picbed", objectKey, displayUrl: `https://images.example.com/${objectKey}`, thumbnailUrl: `https://images.example.com/${objectKey}`, mimeType: "image/png", width: 512, height: 512, sizeBytes: 1024 }],
    } }));
    expect(created.status).toBe(201);
    const note = (await created.json()).data;
    expect(note.tags.map((tag: { name: string }) => tag.name).sort()).toEqual(["电影感", "夜景"].sort());
    expect(note.coverImage.displayUrl).toContain(objectKey);

    const byTagText = await listNotes(request("http://localhost:3000/api/v1/notes?q=电影感", { cookie }));
    const tags = await listTags(request("http://localhost:3000/api/v1/tags", { cookie }));
    const tagRows = (await tags.json()).data;
    const tag = tagRows.find((row: { name: string }) => row.name === "电影感");
    const byTagId = await listNotes(request(`http://localhost:3000/api/v1/notes?tagId=${tag.id}`, { cookie }));

    expect((await byTagText.json()).data).toHaveLength(1);
    expect((await byTagId.json()).data[0].id).toBe(note.id);
    expect(tag.count).toBe(1);
  });

  it("serves a large built-in vocabulary and isolates custom terms", async () => {
    const owner = await session("term-owner");
    const other = await session("term-other");
    const created = await createTerm(request("http://localhost:3000/api/v1/terms", { cookie: owner, body: { category: "我的风格", label: "柔光肖像", value: "soft luminous portrait" } }));
    expect(created.status).toBe(201);
    const ownerBody = await (await listTerms(request("http://localhost:3000/api/v1/terms", { cookie: owner }))).json();
    const otherBody = await (await listTerms(request("http://localhost:3000/api/v1/terms", { cookie: other }))).json();
    expect(ownerBody.data.builtIn.length).toBeGreaterThanOrEqual(120);
    expect(ownerBody.data.custom).toHaveLength(1);
    expect(otherBody.data.custom).toHaveLength(0);
  });
});
