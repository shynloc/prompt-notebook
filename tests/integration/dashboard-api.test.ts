// @vitest-environment node

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GET as getDashboard } from "@/app/api/v1/dashboard/route";
import { GET as listTags } from "@/app/api/v1/tags/route";
import { db } from "@/db/client";
import {
  customTerms,
  noteShares,
  noteTags,
  projects,
  promptNotes,
  tags,
} from "@/db/schema";
import { auth } from "@/lib/auth/server";
import builtInTerms from "@/modules/terms/built-in-terms.json";

const base = "http://localhost:3000";

function request(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${base}${path}`, { headers });
}

async function sessionFor(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await auth.handler(new Request(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: label, email, password }),
  }));
  const response = await auth.handler(new Request(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));
  const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("missing session cookie");
  const cookie = `better-auth.session_token=${token}`;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("missing authenticated session");
  return { cookie, userId: session.user.id };
}

describe("dashboard API", () => {
  it("requires authentication", async () => {
    const response = await getDashboard(request("/api/v1/dashboard"));
    expect(response.status).toBe(401);
  });

  it("returns an owner-scoped snapshot with stable counting rules", async () => {
    const owner = await sessionFor("dashboard-owner");
    const other = await sessionFor("dashboard-other");
    const now = Date.now();

    const [active, archived, trashed] = await db.insert(promptNotes).values([
      { userId: owner.userId, title: "Active", prompt: "abcd", negativePrompt: "ef", favorite: true },
      { userId: owner.userId, title: "Archived", prompt: "xyz", favorite: true, archivedAt: new Date(now - 60_000) },
      { userId: owner.userId, title: "Trash", prompt: "do not count", deletedAt: new Date(now - 30_000) },
    ]).returning();
    const [otherNote] = await db.insert(promptNotes).values({
      userId: other.userId,
      title: "Other owner",
      prompt: "private",
      favorite: true,
    }).returning();

    const [portrait, trashOnly, empty] = await db.insert(tags).values([
      { userId: owner.userId, name: "人像" },
      { userId: owner.userId, name: "仅回收站" },
      { userId: owner.userId, name: "空标签" },
    ]).returning();
    const [otherTag] = await db.insert(tags).values({ userId: other.userId, name: "不可见" }).returning();
    await db.insert(noteTags).values([
      { userId: owner.userId, noteId: active.id, tagId: portrait.id },
      { userId: owner.userId, noteId: archived.id, tagId: portrait.id },
      { userId: owner.userId, noteId: trashed.id, tagId: trashOnly.id },
      { userId: other.userId, noteId: otherNote.id, tagId: otherTag.id },
    ]);

    await db.insert(projects).values([
      { userId: owner.userId, name: "Owner project" },
      { userId: other.userId, name: "Other project" },
    ]);
    await db.insert(customTerms).values([
      { userId: owner.userId, category: "lighting", label: "轮廓光", value: "rim lighting" },
      { userId: other.userId, category: "lighting", label: "隐藏词", value: "hidden" },
    ]);

    await db.insert(noteShares).values([
      { noteId: active.id, userId: owner.userId, tokenHash: randomUUID(), expiresAt: new Date(now + 86_400_000) },
      { noteId: active.id, userId: owner.userId, tokenHash: randomUUID(), expiresAt: new Date(now + 172_800_000) },
      { noteId: archived.id, userId: owner.userId, tokenHash: randomUUID(), expiresAt: new Date(now - 1) },
      { noteId: archived.id, userId: owner.userId, tokenHash: randomUUID(), expiresAt: new Date(now + 86_400_000), revokedAt: new Date(now) },
      { noteId: otherNote.id, userId: other.userId, tokenHash: randomUUID(), expiresAt: new Date(now + 86_400_000) },
    ]);

    const response = await getDashboard(request("/api/v1/dashboard", owner.cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();

    expect(body.data.summary).toEqual({
      totalNotes: 2,
      activeSharedNotes: 1,
      totalTags: 3,
      totalTerms: builtInTerms.length + 1,
      totalFavorites: 1,
      totalProjects: 1,
      trashNotes: 1,
      totalPromptCharacters: 9,
    });
    expect(body.data.tags).toEqual([
      { id: portrait.id, name: "人像", noteCount: 1 },
      { id: trashOnly.id, name: "仅回收站", noteCount: 0 },
      { id: empty.id, name: "空标签", noteCount: 0 },
    ]);
    expect(JSON.stringify(body)).not.toContain("不可见");

    const tagsResponse = await listTags(request("/api/v1/tags", owner.cookie));
    const tagRows = (await tagsResponse.json()).data;
    expect(tagRows.find((tag: { id: string }) => tag.id === portrait.id).count).toBe(1);
    expect(tagRows.find((tag: { id: string }) => tag.id === trashOnly.id).count).toBe(0);
  });
});
