// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/server";
import {
  DELETE as deleteNote,
  GET as getNote,
  PATCH as patchNote,
} from "@/app/api/v1/notes/[id]/route";
import { POST as restoreNote } from "@/app/api/v1/notes/[id]/restore/route";
import { GET as listNotes, POST as createNote } from "@/app/api/v1/notes/route";

const apiBase = "http://localhost:3000/api/v1/notes";
const authBase = "http://localhost:3000/api/auth";

function request(
  url: string,
  options: { body?: unknown; cookie?: string; headers?: Record<string, string>; method?: string } = {},
) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(url, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function sessionFor(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await auth.handler(
    request(`${authBase}/sign-up/email`, {
      body: { name: label, email, password },
    }),
  );
  const response = await auth.handler(
    request(`${authBase}/sign-in/email`, { body: { email, password } }),
  );
  const setCookie = response.headers.get("set-cookie") ?? "";
  const token = setCookie.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("Sign-in did not return a session cookie");
  return { cookie: `better-auth.session_token=${token}`, email };
}

async function create(cookie: string, overrides: Record<string, unknown> = {}) {
  const response = await createNote(
    request(apiBase, {
      cookie,
      body: { title: "Portrait", prompt: "soft studio light", ...overrides },
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

describe("user-scoped notes API", () => {
  it("creates, reads, and cursor-paginates notes", async () => {
    const { cookie } = await sessionFor("pagination");
    const first = await create(cookie, { title: "First" });
    await create(cookie, { title: "Second" });
    await create(cookie, { title: "Third" });

    const detail = await getNote(request(`${apiBase}/${first.id}`, { cookie }), routeContext(first.id));
    const pageOne = await listNotes(request(`${apiBase}?limit=2`, { cookie }));
    const firstBody = await pageOne.json();
    const pageTwo = await listNotes(
      request(`${apiBase}?limit=2&cursor=${encodeURIComponent(firstBody.meta.nextCursor)}`, {
        cookie,
      }),
    );
    const secondBody = await pageTwo.json();

    expect(detail.status).toBe(200);
    expect((await detail.json()).data.title).toBe("First");
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.meta.nextCursor).toEqual(expect.any(String));
    expect(secondBody.data).toHaveLength(1);
  });

  it("replays an idempotent note save without creating a duplicate", async () => {
    const { cookie } = await sessionFor("idempotent-note");
    const key = `imagehub-note:${randomUUID()}`;
    const body = { title: "Generated portrait", prompt: "soft cinematic light" };
    const first = await createNote(request(apiBase, { cookie, body, headers: { "idempotency-key": key } }));
    const replay = await createNote(request(apiBase, { cookie, body, headers: { "idempotency-key": key } }));
    const changed = await createNote(request(apiBase, {
      cookie,
      body: { ...body, title: "Changed title" },
      headers: { "idempotency-key": key },
    }));
    const firstBody = await first.json();
    const replayBody = await replay.json();

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replayBody.data.id).toBe(firstBody.data.id);
    expect(replayBody.meta.replayed).toBe(true);
    expect(changed.status).toBe(200);
    expect((await changed.json()).data.id).toBe(firstBody.data.id);
  });

  it("updates atomically and returns the server note on version conflict", async () => {
    const { cookie } = await sessionFor("conflict");
    const note = await create(cookie);
    const firstUpdate = await patchNote(
      request(`${apiBase}/${note.id}`, {
        cookie,
        method: "PATCH",
        body: { title: "Client A", version: note.version },
      }),
      routeContext(note.id),
    );
    const conflict = await patchNote(
      request(`${apiBase}/${note.id}`, {
        cookie,
        method: "PATCH",
        body: { title: "Client B", version: note.version },
      }),
      routeContext(note.id),
    );
    const conflictBody = await conflict.json();

    expect(firstUpdate.status).toBe(200);
    expect((await firstUpdate.json()).data.version).toBe(note.version + 1);
    expect(conflict.status).toBe(409);
    expect(conflictBody.error.details.current.title).toBe("Client A");
  });

  it("preserves tags and cover images during a favorite-only update", async () => {
    const { cookie } = await sessionFor("favorite-relations");
    const objectKey = `tests/${randomUUID()}.png`;
    const note = await create(cookie, {
      tags: ["电影感"],
      images: [{
        storageProvider: "picbed",
        objectKey,
        displayUrl: `https://images.example.com/${objectKey}`,
        thumbnailUrl: `https://images.example.com/${objectKey}`,
        mimeType: "image/png",
        width: 512,
        height: 512,
        sizeBytes: 1024,
      }],
    });

    const response = await patchNote(
      request(`${apiBase}/${note.id}`, {
        cookie,
        method: "PATCH",
        body: { favorite: true, version: note.version },
      }),
      routeContext(note.id),
    );
    const updated = (await response.json()).data;

    expect(response.status).toBe(200);
    expect(updated.favorite).toBe(true);
    expect(updated.tags).toEqual(expect.arrayContaining([expect.objectContaining({ name: "电影感" })]));
    expect(updated.images).toHaveLength(1);
    expect(updated.coverImage.objectKey).toBe(objectKey);
  });

  it("soft deletes and restores a note", async () => {
    const { cookie } = await sessionFor("restore");
    const note = await create(cookie);
    const deleted = await deleteNote(
      request(`${apiBase}/${note.id}`, {
        cookie,
        method: "DELETE",
        body: { version: note.version },
      }),
      routeContext(note.id),
    );
    const deletedBody = await deleted.json();
    const hidden = await getNote(
      request(`${apiBase}/${note.id}`, { cookie }),
      routeContext(note.id),
    );
    const restored = await restoreNote(
      request(`${apiBase}/${note.id}/restore`, {
        cookie,
        body: { version: deletedBody.data.version },
      }),
      routeContext(note.id),
    );

    expect(deleted.status).toBe(200);
    expect(deletedBody.data.deletedAt).not.toBeNull();
    expect(hidden.status).toBe(404);
    expect(restored.status).toBe(200);
    expect((await restored.json()).data.deletedAt).toBeNull();
  });

  it("separates favorites, archives, active notes, and trash", async () => {
    const { cookie } = await sessionFor("views");
    await create(cookie, { title: "Favorite", favorite: true });
    await create(cookie, { title: "Zulu" });
    const archived = await create(cookie, { title: "Archived" });
    const removed = await create(cookie, { title: "Removed" });
    await patchNote(request(`${apiBase}/${archived.id}`, { cookie, method: "PATCH", body: { archivedAt: new Date().toISOString(), version: archived.version } }), routeContext(archived.id));
    await deleteNote(request(`${apiBase}/${removed.id}`, { cookie, method: "DELETE", body: { version: removed.version } }), routeContext(removed.id));

    const active = await (await listNotes(request(`${apiBase}?view=active`, { cookie }))).json();
    const favorites = await (await listNotes(request(`${apiBase}?favorite=true`, { cookie }))).json();
    const archives = await (await listNotes(request(`${apiBase}?view=archived`, { cookie }))).json();
    const trash = await (await listNotes(request(`${apiBase}?view=trash`, { cookie }))).json();
    const titleSorted = await (await listNotes(request(`${apiBase}?sort=title`, { cookie }))).json();

    expect(active.data.map((note: { title: string }) => note.title)).toContain("Favorite");
    expect(active.data.map((note: { title: string }) => note.title)).not.toContain("Archived");
    expect(favorites.data.map((note: { title: string }) => note.title)).toEqual(["Favorite"]);
    expect(archives.data.map((note: { title: string }) => note.title)).toEqual(["Archived"]);
    expect(trash.data.map((note: { title: string }) => note.title)).toEqual(["Removed"]);
    expect(titleSorted.data.map((note: { title: string }) => note.title)).toEqual(["Favorite", "Zulu"]);
  });

  it("rejects invalid and unauthenticated requests", async () => {
    const { cookie } = await sessionFor("validation");
    const invalid = await createNote(
      request(apiBase, { cookie, body: { title: "", prompt: "" } }),
    );
    const unauthenticated = await listNotes(request(apiBase));

    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe("VALIDATION_ERROR");
    expect(unauthenticated.status).toBe(401);
  });

  it("never reveals or mutates another user's note", async () => {
    const owner = await sessionFor("owner");
    const attacker = await sessionFor("attacker");
    const note = await create(owner.cookie, { title: "Private" });

    const read = await getNote(
      request(`${apiBase}/${note.id}`, { cookie: attacker.cookie }),
      routeContext(note.id),
    );
    const update = await patchNote(
      request(`${apiBase}/${note.id}`, {
        cookie: attacker.cookie,
        method: "PATCH",
        body: { title: "Stolen", version: note.version },
      }),
      routeContext(note.id),
    );
    const remove = await deleteNote(
      request(`${apiBase}/${note.id}`, {
        cookie: attacker.cookie,
        method: "DELETE",
        body: { version: note.version },
      }),
      routeContext(note.id),
    );

    expect(read.status).toBe(404);
    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);
  });
});
