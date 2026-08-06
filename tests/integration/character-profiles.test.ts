// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/server";
import {
  DELETE as deleteCharacter,
  GET as getCharacter,
  PATCH as patchCharacter,
} from "@/app/api/v1/ai-models/[id]/route";
import { POST as restoreCharacter } from "@/app/api/v1/ai-models/[id]/restore/route";
import {
  GET as listCharacters,
  POST as createCharacter,
} from "@/app/api/v1/ai-models/route";
import {
  GET as getNote,
  PATCH as patchNote,
} from "@/app/api/v1/notes/[id]/route";
import { GET as listNotes, POST as createNote } from "@/app/api/v1/notes/route";

const characterApi = "http://localhost:3000/api/v1/ai-models";
const noteApi = "http://localhost:3000/api/v1/notes";
const authApi = "http://localhost:3000/api/auth";

function request(
  url: string,
  options: { body?: unknown; cookie?: string; method?: string } = {},
) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
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
  await auth.handler(request(`${authApi}/sign-up/email`, {
    body: { name: label, email, password },
  }));
  const response = await auth.handler(request(`${authApi}/sign-in/email`, {
    body: { email, password },
  }));
  const token = (response.headers.get("set-cookie") ?? "")
    .match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("Sign-in did not return a session cookie");
  return `better-auth.session_token=${token}`;
}

function image(label: string, overrides: Record<string, unknown> = {}) {
  const key = `tests/characters/${randomUUID()}-${label}.webp`;
  return {
    storageProvider: "picbed",
    objectKey: key,
    displayUrl: `https://images.example.com/${key}`,
    thumbnailUrl: `https://images.example.com/thumbs/${key}`,
    mimeType: "image/webp",
    width: 1024,
    height: 1536,
    sizeBytes: 24_000,
    viewType: "portrait",
    caption: label,
    ...overrides,
  };
}

async function createProfile(
  cookie: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await createCharacter(request(characterApi, {
    cookie,
    body: {
      name: "Astra",
      summary: "Editorial virtual model",
      roleDefinition: "A composed futuristic fashion model",
      useCases: ["fashion", "editorial"],
      appearance: "Silver hair and calm expression",
      promptAnchor: "Astra, silver hair, editorial portrait",
      images: [image("main")],
      ...overrides,
    },
  }));
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

describe("AI Model character profile API", () => {
  it("requires authentication and creates a hydrated role card with stable image roles", async () => {
    const unauthenticated = await listCharacters(request(characterApi));
    expect(unauthenticated.status).toBe(401);

    const cookie = await sessionFor("character-create");
    const profile = await createProfile(cookie, {
      name: "Nova",
      images: [
        image("front", { isCover: true, isPrimary: false }),
        image("full", { viewType: "full_body", isPrimary: true }),
      ],
    });

    expect(profile).toMatchObject({
      name: "Nova",
      version: 1,
      noteCount: 0,
      generationCount: 0,
    });
    expect(profile.images).toHaveLength(2);
    expect(profile.coverImage.caption).toBe("front");
    expect(profile.primaryImage.caption).toBe("full");

    const listed = await listCharacters(request(
      `${characterApi}?q=nov&useCase=fashion&limit=1`,
      { cookie },
    ));
    const body = await listed.json();
    expect(listed.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(profile.id);
  });

  it("uses optimistic versions and preserves the winning server state on conflict", async () => {
    const cookie = await sessionFor("character-conflict");
    const profile = await createProfile(cookie);

    const winner = await patchCharacter(request(`${characterApi}/${profile.id}`, {
      cookie,
      method: "PATCH",
      body: { version: profile.version, summary: "Winner" },
    }), routeContext(profile.id));
    const conflict = await patchCharacter(request(`${characterApi}/${profile.id}`, {
      cookie,
      method: "PATCH",
      body: { version: profile.version, summary: "Stale overwrite" },
    }), routeContext(profile.id));

    expect(winner.status).toBe(200);
    expect((await winner.json()).data.version).toBe(profile.version + 1);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toMatchObject({
      code: "CHARACTER_PROFILE_VERSION_CONFLICT",
      details: { current: { summary: "Winner" } },
    });
  });

  it("soft deletes, hides, lists in trash, and restores a profile", async () => {
    const cookie = await sessionFor("character-restore");
    const profile = await createProfile(cookie);

    const removed = await deleteCharacter(request(`${characterApi}/${profile.id}`, {
      cookie,
      method: "DELETE",
      body: { version: profile.version },
    }), routeContext(profile.id));
    const removedProfile = (await removed.json()).data;
    expect(removed.status).toBe(200);
    expect(removedProfile.deletedAt).not.toBeNull();

    const hidden = await getCharacter(
      request(`${characterApi}/${profile.id}`, { cookie }),
      routeContext(profile.id),
    );
    const trash = await listCharacters(request(`${characterApi}?view=trash`, { cookie }));
    expect(hidden.status).toBe(404);
    expect((await trash.json()).data.map((item: { id: string }) => item.id)).toContain(profile.id);

    const restored = await restoreCharacter(request(`${characterApi}/${profile.id}/restore`, {
      cookie,
      body: { version: removedProfile.version },
    }), routeContext(profile.id));
    expect(restored.status).toBe(200);
    expect((await restored.json()).data.deletedAt).toBeNull();
  });

  it("guards permanent deletion behind trash and keeps linked notes", async () => {
    const cookie = await sessionFor("character-permanent-delete");
    const profile = await createProfile(cookie);
    const createdNote = await createNote(request(noteApi, {
      cookie,
      body: {
        title: "Keep this prompt",
        prompt: "The note survives character cleanup",
        characterProfiles: [{ id: profile.id, role: "primary", sortOrder: 0 }],
      },
    }));
    const note = (await createdNote.json()).data;

    const beforeTrash = await deleteCharacter(request(`${characterApi}/${profile.id}?mode=permanent`, {
      cookie,
      method: "DELETE",
      body: { version: profile.version },
    }), routeContext(profile.id));
    expect(beforeTrash.status).toBe(409);
    expect((await beforeTrash.json()).error.code).toBe("CHARACTER_PROFILE_NOT_IN_TRASH");

    const trashed = await deleteCharacter(request(`${characterApi}/${profile.id}`, {
      cookie,
      method: "DELETE",
      body: { version: profile.version },
    }), routeContext(profile.id));
    const trashedProfile = (await trashed.json()).data;
    const purged = await deleteCharacter(request(`${characterApi}/${profile.id}?mode=permanent`, {
      cookie,
      method: "DELETE",
      body: { version: trashedProfile.version },
    }), routeContext(profile.id));
    expect(purged.status).toBe(200);
    expect((await purged.json()).data).toEqual({ id: profile.id, deleted: true, permanent: true });

    const profileAfter = await getCharacter(
      request(`${characterApi}/${profile.id}?includeDeleted=true`, { cookie }),
      routeContext(profile.id),
    );
    const noteAfter = await getNote(request(`${noteApi}/${note.id}`, { cookie }), routeContext(note.id));
    expect(profileAfter.status).toBe(404);
    expect(noteAfter.status).toBe(200);
    expect((await noteAfter.json()).data).toMatchObject({ id: note.id, characterProfiles: [] });
  });

  it("never reads, updates, deletes, or restores another user's profile", async () => {
    const owner = await sessionFor("character-owner");
    const attacker = await sessionFor("character-attacker");
    const profile = await createProfile(owner);

    const read = await getCharacter(
      request(`${characterApi}/${profile.id}?includeDeleted=true`, { cookie: attacker }),
      routeContext(profile.id),
    );
    const update = await patchCharacter(request(`${characterApi}/${profile.id}`, {
      cookie: attacker,
      method: "PATCH",
      body: { version: profile.version, name: "Stolen" },
    }), routeContext(profile.id));
    const remove = await deleteCharacter(request(`${characterApi}/${profile.id}`, {
      cookie: attacker,
      method: "DELETE",
      body: { version: profile.version },
    }), routeContext(profile.id));
    const restore = await restoreCharacter(request(`${characterApi}/${profile.id}/restore`, {
      cookie: attacker,
      body: { version: profile.version },
    }), routeContext(profile.id));

    expect(read.status).toBe(404);
    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);
    expect(restore.status).toBe(404);
  });

  it("binds owned profiles to notes and filters the note gallery by profile", async () => {
    const cookie = await sessionFor("character-note-binding");
    const primary = await createProfile(cookie, { name: "Primary model" });
    const supporting = await createProfile(cookie, { name: "Supporting model" });
    const created = await createNote(request(noteApi, {
      cookie,
      body: {
        title: "Two-character editorial",
        prompt: "Two models in a studio",
        characterProfiles: [
          { id: primary.id, role: "primary", sortOrder: 0 },
          { id: supporting.id, role: "supporting", sortOrder: 1 },
        ],
      },
    }));
    const note = (await created.json()).data;

    expect(created.status).toBe(201);
    expect(note.characterProfiles).toEqual([
      expect.objectContaining({ id: primary.id, role: "primary", sortOrder: 0 }),
      expect.objectContaining({ id: supporting.id, role: "supporting", sortOrder: 1 }),
    ]);

    const detail = await getNote(
      request(`${noteApi}/${note.id}`, { cookie }),
      routeContext(note.id),
    );
    const filtered = await listNotes(request(
      `${noteApi}?characterProfileId=${supporting.id}`,
      { cookie },
    ));
    expect((await detail.json()).data.characterProfiles).toHaveLength(2);
    expect((await filtered.json()).data.map((item: { id: string }) => item.id)).toEqual([note.id]);
  });

  it("rejects cross-owner and unavailable profile bindings without creating a note", async () => {
    const owner = await sessionFor("character-binding-owner");
    const other = await sessionFor("character-binding-other");
    const foreignProfile = await createProfile(owner);

    const crossOwner = await createNote(request(noteApi, {
      cookie: other,
      body: {
        title: "Forbidden association",
        prompt: "Must not save",
        characterProfiles: [{ id: foreignProfile.id, role: "primary", sortOrder: 0 }],
      },
    }));
    expect(crossOwner.status).toBe(404);
    expect((await crossOwner.json()).error.code).toBe("CHARACTER_PROFILE_NOT_FOUND");

    const deletedProfile = await createProfile(other, { name: "Deleted model" });
    await deleteCharacter(request(`${characterApi}/${deletedProfile.id}`, {
      cookie: other,
      method: "DELETE",
      body: { version: deletedProfile.version },
    }), routeContext(deletedProfile.id));
    const deletedBinding = await createNote(request(noteApi, {
      cookie: other,
      body: {
        title: "Deleted association",
        prompt: "Must not save either",
        characterProfiles: [{ id: deletedProfile.id, role: "primary", sortOrder: 0 }],
      },
    }));
    expect(deletedBinding.status).toBe(404);

    const notes = await listNotes(request(noteApi, { cookie: other }));
    expect((await notes.json()).data).toHaveLength(0);
  });

  it("retains an existing deleted-model link during edits but never permits a new unavailable link", async () => {
    const owner = await sessionFor("character-retained-binding");
    const other = await sessionFor("character-retained-foreign");
    const profile = await createProfile(owner, { name: "Eventually deleted" });
    const created = await createNote(request(noteApi, {
      cookie: owner,
      body: {
        title: "Durable association",
        prompt: "Original prompt",
        characterProfiles: [{ id: profile.id, role: "primary", sortOrder: 0 }],
      },
    }));
    const note = (await created.json()).data;
    await deleteCharacter(request(`${characterApi}/${profile.id}`, {
      cookie: owner,
      method: "DELETE",
      body: { version: profile.version },
    }), routeContext(profile.id));

    const retained = await patchNote(request(`${noteApi}/${note.id}`, {
      cookie: owner,
      method: "PATCH",
      body: {
        version: note.version,
        prompt: "Edited while preserving historical model context",
        characterProfiles: [{ id: profile.id, role: "primary", sortOrder: 0 }],
      },
    }), routeContext(note.id));
    expect(retained.status).toBe(200);
    const retainedNote = (await retained.json()).data;
    expect(retainedNote.characterProfiles).toEqual([
      expect.objectContaining({ id: profile.id, role: "primary" }),
    ]);

    const unlinked = await patchNote(request(`${noteApi}/${note.id}`, {
      cookie: owner,
      method: "PATCH",
      body: { version: retainedNote.version, characterProfiles: [] },
    }), routeContext(note.id));
    expect(unlinked.status).toBe(200);
    const unlinkedNote = (await unlinked.json()).data;
    expect(unlinkedNote.characterProfiles).toEqual([]);

    const readdDeleted = await patchNote(request(`${noteApi}/${note.id}`, {
      cookie: owner,
      method: "PATCH",
      body: {
        version: unlinkedNote.version,
        characterProfiles: [{ id: profile.id, role: "primary", sortOrder: 0 }],
      },
    }), routeContext(note.id));
    expect(readdDeleted.status).toBe(404);
    expect((await readdDeleted.json()).error.code).toBe("CHARACTER_PROFILE_NOT_FOUND");

    const foreignProfile = await createProfile(other, { name: "Other owner's model" });
    const bindForeign = await patchNote(request(`${noteApi}/${note.id}`, {
      cookie: owner,
      method: "PATCH",
      body: {
        version: unlinkedNote.version,
        characterProfiles: [{ id: foreignProfile.id, role: "primary", sortOrder: 0 }],
      },
    }), routeContext(note.id));
    expect(bindForeign.status).toBe(404);
    expect((await bindForeign.json()).error.code).toBe("CHARACTER_PROFILE_NOT_FOUND");

    const detail = await getNote(
      request(`${noteApi}/${note.id}`, { cookie: owner }),
      routeContext(note.id),
    );
    expect((await detail.json()).data).toMatchObject({
      prompt: "Edited while preserving historical model context",
      characterProfiles: [],
      version: unlinkedNote.version,
    });
  });
});
