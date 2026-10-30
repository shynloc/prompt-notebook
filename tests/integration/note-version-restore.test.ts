// @vitest-environment node

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { GET as getNote, PATCH as patchNote } from "@/app/api/v1/notes/[id]/route";
import { GET as listVersions } from "@/app/api/v1/notes/[id]/versions/route";
import { POST as restoreVersion } from "@/app/api/v1/notes/[id]/versions/[versionId]/restore/route";
import { GET as duplicates } from "@/app/api/v1/notes/duplicates/route";
import { POST as createNote } from "@/app/api/v1/notes/route";
import { db } from "@/db/client";
import { noteVersions, promptNotes, user } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { promptContentHash } from "@/modules/search/content-hash";

const base = "http://localhost:3000";
const fixtureUserIds: string[] = [];

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
  const created = await auth.handler(request(`${base}/api/auth/sign-up/email`, { body: { name: label, email, password } }));
  expect(created.ok).toBe(true);
  const response = await auth.handler(request(`${base}/api/auth/sign-in/email`, { body: { email, password } }));
  const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("No test session cookie returned");
  const cookie = `better-auth.session_token=${token}`;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("No authenticated test session returned");
  fixtureUserIds.push(session.user.id);
  return { cookie, userId: session.user.id };
}

const noteContext = (id: string) => ({ params: Promise.resolve({ id }) });
const restoreContext = (id: string, versionId: string) => ({ params: Promise.resolve({ id, versionId }) });

async function create(cookie: string, fields: { title?: string; prompt: string; negativePrompt?: string | null }) {
  const response = await createNote(request(`${base}/api/v1/notes`, {
    cookie, body: { title: "Version fixture", ...fields },
  }));
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

async function versions(cookie: string, noteId: string) {
  const response = await listVersions(request(`${base}/api/v1/notes/${noteId}/versions`, { cookie }), noteContext(noteId));
  expect(response.status).toBe(200);
  return (await response.json()).data as Array<{ id: string; version: number; snapshot: Record<string, unknown> }>;
}

afterEach(async () => {
  const ids = fixtureUserIds.splice(0);
  if (ids.length) await db.delete(user).where(inArray(user.id, ids));
});

describe("persisted note version restoration", () => {
  it("restores positive and negative prompts and keeps duplicate detection consistent with persisted content", async () => {
    const owner = await sessionFor("version-content");
    const original = { prompt: "soft studio light on a blue ceramic bowl", negativePrompt: "blur, text" };
    const first = await create(owner.cookie, { title: "Original", ...original });
    const duplicate = await create(owner.cookie, { title: "Matching original", ...original });
    const changedResponse = await patchNote(request(`${base}/api/v1/notes/${first.id}`, {
      cookie: owner.cookie, method: "PATCH", body: { version: first.version, prompt: "a mountain at sunset", negativePrompt: "fog" },
    }), noteContext(first.id));
    expect(changedResponse.status).toBe(200);
    const changed = (await changedResponse.json()).data;
    const beforeRestore = await duplicates(request(`${base}/api/v1/notes/duplicates`, { cookie: owner.cookie }));
    expect((await beforeRestore.json()).data.groups).toHaveLength(0);
    const history = await versions(owner.cookie, first.id);
    const restoredResponse = await restoreVersion(request(`${base}/api/v1/notes/${first.id}/versions/${history[0].id}/restore`, {
      cookie: owner.cookie, body: { version: changed.version },
    }), restoreContext(first.id, history[0].id));
    expect(restoredResponse.status).toBe(200);
    const restored = (await restoredResponse.json()).data;
    expect(restored).toMatchObject({ ...original, title: "Original", version: changed.version + 1 });
    const [persisted] = await db.select().from(promptNotes).where(and(eq(promptNotes.id, first.id), eq(promptNotes.userId, owner.userId)));
    expect(persisted.prompt).toBe(original.prompt);
    expect(persisted.negativePrompt).toBe(original.negativePrompt);
    expect(persisted.contentHash).toBe(promptContentHash(original.prompt, original.negativePrompt));
    expect(persisted.contentHash).not.toBe(promptContentHash(changed.prompt, changed.negativePrompt));
    const duplicateResponse = await duplicates(request(`${base}/api/v1/notes/duplicates`, { cookie: owner.cookie }));
    const groups = (await duplicateResponse.json()).data.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].notes.map((note: { id: string }) => note.id).sort()).toEqual([first.id, duplicate.id].sort());
    const snapshots = await versions(owner.cookie, first.id);
    expect(snapshots.find((snapshot) => snapshot.version === changed.version)?.snapshot).toMatchObject({ prompt: changed.prompt, negativePrompt: changed.negativePrompt });
  });

  it("retains at most fifty snapshots after restores and later edits", async () => {
    const owner = await sessionFor("version-retention");
    const note = await create(owner.cookie, { prompt: "current version fifty one", negativePrompt: null });
    await db.update(promptNotes).set({ version: 51 }).where(and(eq(promptNotes.id, note.id), eq(promptNotes.userId, owner.userId)));
    const snapshots = await db.insert(noteVersions).values(Array.from({ length: 50 }, (_, index) => ({
      noteId: note.id,
      userId: owner.userId,
      version: index + 1,
      snapshot: { ...note, version: index + 1, prompt: `historical version ${index + 1}` },
      createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)),
    }))).returning({ id: noteVersions.id, version: noteVersions.version });
    const oldest = snapshots.find((snapshot) => snapshot.version === 1)!;
    const restoredResponse = await restoreVersion(request(`${base}/api/v1/notes/${note.id}/versions/${oldest.id}/restore`, {
      cookie: owner.cookie, body: { version: 51 },
    }), restoreContext(note.id, oldest.id));
    expect(restoredResponse.status).toBe(200);
    const restored = (await restoredResponse.json()).data;
    expect(restored.prompt).toBe("historical version 1");
    let retained = await versions(owner.cookie, note.id);
    expect(retained).toHaveLength(50);
    expect(retained.some((snapshot) => snapshot.version === 1)).toBe(false);
    expect(retained.some((snapshot) => snapshot.version === 51)).toBe(true);
    const editedResponse = await patchNote(request(`${base}/api/v1/notes/${note.id}`, {
      cookie: owner.cookie, method: "PATCH", body: { version: restored.version, title: "Edited after restore" },
    }), noteContext(note.id));
    expect(editedResponse.status).toBe(200);
    retained = await versions(owner.cookie, note.id);
    expect(retained).toHaveLength(50);
    expect(retained.some((snapshot) => snapshot.version === 2)).toBe(false);
    expect(retained.some((snapshot) => snapshot.version === restored.version)).toBe(true);
    const persistedCount = await db.select({ id: noteVersions.id }).from(noteVersions).where(and(eq(noteVersions.noteId, note.id), eq(noteVersions.userId, owner.userId)));
    expect(persistedCount).toHaveLength(50);
  });

  it("rejects unauthenticated, cross-user and cross-note restores without changing the note", async () => {
    const owner = await sessionFor("version-owner");
    const other = await sessionFor("version-other");
    const note = await create(owner.cookie, { prompt: "private original" });
    const second = await create(owner.cookie, { prompt: "another private note" });
    const editedResponse = await patchNote(request(`${base}/api/v1/notes/${note.id}`, {
      cookie: owner.cookie, method: "PATCH", body: { version: note.version, prompt: "private current" },
    }), noteContext(note.id));
    const edited = (await editedResponse.json()).data;
    const [historical] = await versions(owner.cookie, note.id);
    for (const [cookie, targetId, expectedStatus] of [
      [undefined, note.id, 401], [other.cookie, note.id, 404], [owner.cookie, second.id, 404],
    ] as const) {
      const response = await restoreVersion(request(`${base}/api/v1/notes/${targetId}/versions/${historical.id}/restore`, {
        cookie, body: { version: edited.version },
      }), restoreContext(targetId, historical.id));
      expect(response.status).toBe(expectedStatus);
    }
    const currentResponse = await getNote(request(`${base}/api/v1/notes/${note.id}`, { cookie: owner.cookie }), noteContext(note.id));
    expect((await currentResponse.json()).data).toMatchObject({ prompt: "private current", version: edited.version });
    expect(await versions(owner.cookie, note.id)).toHaveLength(1);
  });

  it("rejects a stale expected version without changing current content, hash or history", async () => {
    const owner = await sessionFor("version-conflict");
    const note = await create(owner.cookie, { prompt: "before", negativePrompt: "original negative" });
    const editedResponse = await patchNote(request(`${base}/api/v1/notes/${note.id}`, {
      cookie: owner.cookie, method: "PATCH", body: { version: note.version, prompt: "after", negativePrompt: "new negative" },
    }), noteContext(note.id));
    const edited = (await editedResponse.json()).data;
    const [historical] = await versions(owner.cookie, note.id);
    const conflict = await restoreVersion(request(`${base}/api/v1/notes/${note.id}/versions/${historical.id}/restore`, {
      cookie: owner.cookie, body: { version: note.version },
    }), restoreContext(note.id, historical.id));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("VERSION_CONFLICT");
    const [persisted] = await db.select().from(promptNotes).where(and(eq(promptNotes.id, note.id), eq(promptNotes.userId, owner.userId)));
    expect(persisted).toMatchObject({ prompt: edited.prompt, negativePrompt: edited.negativePrompt, version: edited.version });
    expect(persisted.contentHash).toBe(promptContentHash(edited.prompt, edited.negativePrompt));
    expect(await versions(owner.cookie, note.id)).toHaveLength(1);
  });
});
