// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { GET as exportNotebook } from "@/app/api/v1/account/export/route";
import { POST as importNotebook } from "@/app/api/v1/account/import/commit/route";
import { POST as previewNotebook } from "@/app/api/v1/account/import/preview/route";
import {
  DELETE as deleteCharacter,
  PATCH as patchCharacter,
} from "@/app/api/v1/ai-models/[id]/route";
import {
  GET as listCharacters,
  POST as createCharacter,
} from "@/app/api/v1/ai-models/route";
import { GET as listNotes, POST as createNote } from "@/app/api/v1/notes/route";
import { requireSession } from "@/lib/auth/session";
import { auth } from "@/lib/auth/server";
import { CharacterRepository } from "@/modules/characters/character-repository";
import { NoteRepository } from "@/modules/notes/note-repository";
import type { CreateNoteInput } from "@/modules/notes/note-schema";
import { notebookExportSchema } from "@/modules/transfer/transfer-schema";
import { NotebookTransferService } from "@/modules/transfer/transfer-service";

const apiBase = "http://localhost:3000/api/v1";

function request(
  url: string,
  options: { body?: string | object; cookie?: string; method?: string } = {},
) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: typeof options.body === "string"
      ? options.body
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  });
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function sessionFor(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await auth.handler(request(`${apiBase.replace("/api/v1", "/api/auth")}/sign-up/email`, {
    body: { name: label, email, password },
  }));
  const response = await auth.handler(request(
    `${apiBase.replace("/api/v1", "/api/auth")}/sign-in/email`,
    { body: { email, password } },
  ));
  const token = (response.headers.get("set-cookie") ?? "")
    .match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("Sign-in did not return a session cookie");
  return `better-auth.session_token=${token}`;
}

function characterImage(label: string, overrides: Record<string, unknown> = {}) {
  const objectKey = `tests/transfer/${randomUUID()}-${label}.webp`;
  return {
    storageProvider: "picbed",
    objectKey,
    displayUrl: `https://images.example.com/${objectKey}`,
    thumbnailUrl: `https://images.example.com/thumbs/${objectKey}`,
    mimeType: "image/webp",
    width: 1024,
    height: 1536,
    sizeBytes: 32_000,
    viewType: "portrait",
    caption: label,
    ...overrides,
  };
}

class FailFirstNoteCreateRepository extends NoteRepository {
  private shouldFail = true;

  override create(userId: string, input: CreateNoteInput) {
    if (this.shouldFail) {
      this.shouldFail = false;
      return Promise.reject(new Error("simulated note import interruption"));
    }
    return super.create(userId, input);
  }
}

async function createProfile(cookie: string) {
  const response = await createCharacter(request(`${apiBase}/ai-models`, {
    cookie,
    body: {
      name: "Portable Astra",
      summary: "A role card included in account backups",
      roleDefinition: "Editorial AI model",
      useCases: ["editorial", "fashion"],
      appearance: "Silver hair",
      promptAnchor: "Astra, editorial portrait",
      negativePrompt: "identity drift",
      rightsNote: "User-owned reference photography",
      attributes: { palette: ["silver", "white"] },
      images: [
        characterImage("cover", { isCover: true }),
        characterImage("primary", { isPrimary: true, viewType: "full_body" }),
      ],
    },
  }));
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

describe("notebook transfer API", () => {
  it("exports v2 character assets and note bindings, safely remaps IDs, and repeats idempotently", async () => {
    const sourceCookie = await sessionFor("export-v2-source");
    const profile = await createProfile(sourceCookie);
    const noteResponse = await createNote(request(`${apiBase}/notes`, {
      cookie: sourceCookie,
      body: {
        title: "Portable character prompt",
        prompt: "Astra in a minimal editorial studio",
        tags: ["backup"],
        characterProfiles: [{ id: profile.id, role: "primary", sortOrder: 0 }],
      },
    }));
    expect(noteResponse.status).toBe(201);
    await patchCharacter(request(`${apiBase}/ai-models/${profile.id}`, {
      cookie: sourceCookie,
      method: "PATCH",
      body: { version: profile.version, archivedAt: new Date().toISOString() },
    }), routeContext(profile.id));

    const exported = await exportNotebook(request(`${apiBase}/account/export`, {
      cookie: sourceCookie,
    }));
    const documentText = await exported.text();
    const document = notebookExportSchema.parse(JSON.parse(documentText));
    expect(exported.headers.get("content-disposition")).toContain("prompt-notebook-");
    expect(document.version).toBe(2);
    if (document.version !== 2) throw new Error("Expected a v2 export");
    expect(document.characterProfiles).toEqual([
      expect.objectContaining({
        id: profile.id,
        name: "Portable Astra",
        images: expect.arrayContaining([
          expect.objectContaining({ caption: "cover", isCover: true }),
          expect.objectContaining({ caption: "primary", isPrimary: true }),
        ]),
      }),
    ]);
    expect(document.notes[0].characterProfiles).toEqual([
      { id: profile.id, role: "primary", sortOrder: 0 },
    ]);

    const targetCookie = await sessionFor("import-v2-target");
    const preview = await previewNotebook(request(`${apiBase}/account/import/preview`, {
      cookie: targetCookie,
      body: documentText,
    }));
    expect((await preview.json()).data).toMatchObject({
      newNotes: 1,
      newCharacterProfiles: 1,
      characterAssociations: 1,
    });

    const first = await importNotebook(request(`${apiBase}/account/import/commit`, {
      cookie: targetCookie,
      body: documentText,
    }));
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({
      imported: 1,
      skipped: 0,
      importedCharacterProfiles: 1,
      skippedCharacterProfiles: 0,
      characterAssociations: 1,
    });

    const importedProfiles = await listCharacters(request(
      `${apiBase}/ai-models?view=archived`,
      { cookie: targetCookie },
    ));
    const targetProfiles = (await importedProfiles.json()).data;
    expect(targetProfiles).toHaveLength(1);
    expect(targetProfiles[0].id).not.toBe(profile.id);
    expect(targetProfiles[0].images).toHaveLength(2);
    expect(targetProfiles[0]).toMatchObject({
      name: "Portable Astra",
      archivedAt: expect.any(String),
    });

    const importedNotes = await listNotes(request(`${apiBase}/notes`, {
      cookie: targetCookie,
    }));
    const targetNotes = (await importedNotes.json()).data;
    expect(targetNotes).toHaveLength(1);
    expect(targetNotes[0].characterProfiles).toEqual([
      expect.objectContaining({
        id: targetProfiles[0].id,
        role: "primary",
      }),
    ]);

    const second = await importNotebook(request(`${apiBase}/account/import/commit`, {
      cookie: targetCookie,
      body: documentText,
    }));
    expect((await second.json()).data).toMatchObject({
      imported: 0,
      skipped: 1,
      importedCharacterProfiles: 0,
      skippedCharacterProfiles: 1,
    });
  });

  it("continues to preview and import legacy v1 backups", async () => {
    const targetCookie = await sessionFor("import-v1-target");
    const noteId = randomUUID();
    const legacy = {
      format: "prompt-notebook-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      notes: [{
        id: noteId,
        title: "Legacy portable note",
        prompt: "A prompt from a v1 backup",
        tags: ["legacy"],
        images: [],
      }],
      customTerms: [],
    };
    expect(notebookExportSchema.parse(legacy).version).toBe(1);

    const preview = await previewNotebook(request(`${apiBase}/account/import/preview`, {
      cookie: targetCookie,
      body: legacy,
    }));
    expect((await preview.json()).data).toMatchObject({
      newNotes: 1,
      newCharacterProfiles: 0,
      characterAssociations: 0,
    });

    const imported = await importNotebook(request(`${apiBase}/account/import/commit`, {
      cookie: targetCookie,
      body: legacy,
    }));
    expect(imported.status).toBe(200);
    expect((await imported.json()).data).toMatchObject({
      imported: 1,
      importedCharacterProfiles: 0,
    });
    const notes = await listNotes(request(`${apiBase}/notes`, { cookie: targetCookie }));
    expect((await notes.json()).data[0]).toMatchObject({
      id: noteId,
      title: "Legacy portable note",
      characterProfiles: [],
    });
  });

  it("restores a deleted profile and its note association into the target trash view", async () => {
    const sourceCookie = await sessionFor("deleted-profile-source");
    const profile = await createProfile(sourceCookie);
    await createNote(request(`${apiBase}/notes`, {
      cookie: sourceCookie,
      body: {
        title: "Historical model association",
        prompt: "Keep the role link even while the model is in trash",
        characterProfiles: [{ id: profile.id, role: "primary", sortOrder: 0 }],
      },
    }));
    const removed = await deleteCharacter(request(`${apiBase}/ai-models/${profile.id}`, {
      cookie: sourceCookie,
      method: "DELETE",
      body: { version: profile.version },
    }), routeContext(profile.id));
    expect(removed.status).toBe(200);

    const exported = await exportNotebook(request(`${apiBase}/account/export`, {
      cookie: sourceCookie,
    }));
    const targetCookie = await sessionFor("deleted-profile-target");
    const imported = await importNotebook(request(`${apiBase}/account/import/commit`, {
      cookie: targetCookie,
      body: await exported.text(),
    }));
    expect(imported.status).toBe(200);

    const trash = await listCharacters(request(`${apiBase}/ai-models?view=trash`, {
      cookie: targetCookie,
    }));
    const targetProfiles = (await trash.json()).data;
    expect(targetProfiles).toHaveLength(1);
    expect(targetProfiles[0]).toMatchObject({
      name: "Portable Astra",
      deletedAt: expect.any(String),
    });
    const notes = await listNotes(request(`${apiBase}/notes`, { cookie: targetCookie }));
    expect((await notes.json()).data[0].characterProfiles).toEqual([
      expect.objectContaining({ id: targetProfiles[0].id, role: "primary" }),
    ]);
  });

  it("keeps imported profiles active after an interrupted note phase and applies lifecycle on retry", async () => {
    const sourceCookie = await sessionFor("retry-source");
    const profile = await createProfile(sourceCookie);
    await createNote(request(`${apiBase}/notes`, {
      cookie: sourceCookie,
      body: {
        title: "Retry-safe association",
        prompt: "The second import attempt must be able to bind this model",
        characterProfiles: [{ id: profile.id, role: "primary", sortOrder: 0 }],
      },
    }));
    await deleteCharacter(request(`${apiBase}/ai-models/${profile.id}`, {
      cookie: sourceCookie,
      method: "DELETE",
      body: { version: profile.version },
    }), routeContext(profile.id));
    const exported = await exportNotebook(request(`${apiBase}/account/export`, {
      cookie: sourceCookie,
    }));
    const document = notebookExportSchema.parse(JSON.parse(await exported.text()));

    const targetCookie = await sessionFor("retry-target");
    const targetSession = await requireSession(request("http://localhost:3000", {
      cookie: targetCookie,
    }));
    const characters = new CharacterRepository();
    const transfer = new NotebookTransferService(
      new FailFirstNoteCreateRepository(),
      characters,
    );

    await expect(transfer.import(targetSession.user.id, document))
      .rejects.toThrow("simulated note import interruption");
    const afterFailure = await characters.list(targetSession.user.id, {
      limit: 10,
      view: "all",
    });
    expect(afterFailure.items).toHaveLength(1);
    expect(afterFailure.items[0].deletedAt).toBeNull();

    const retry = await transfer.import(targetSession.user.id, document);
    expect(retry).toMatchObject({ imported: 1, importedCharacterProfiles: 0 });
    const trash = await characters.list(targetSession.user.id, {
      limit: 10,
      view: "trash",
    });
    expect(trash.items).toHaveLength(1);
    expect(trash.items[0].deletedAt).not.toBeNull();
    const notes = await new NoteRepository().list(targetSession.user.id, {
      limit: 10,
      view: "active",
    });
    expect(notes.items[0].characterProfiles).toEqual([
      expect.objectContaining({ id: trash.items[0].id, role: "primary" }),
    ]);
  });

  it("rejects a v2 document whose note references an omitted character profile", async () => {
    const sourceCookie = await sessionFor("invalid-transfer-source");
    const profile = await createProfile(sourceCookie);
    await createNote(request(`${apiBase}/notes`, {
      cookie: sourceCookie,
      body: {
        title: "Invalid after tampering",
        prompt: "Do not import partial relationships",
        characterProfiles: [{ id: profile.id, role: "primary", sortOrder: 0 }],
      },
    }));
    const exported = await exportNotebook(request(`${apiBase}/account/export`, {
      cookie: sourceCookie,
    }));
    const tampered = JSON.parse(await exported.text());
    tampered.characterProfiles = [];

    const targetCookie = await sessionFor("invalid-transfer-target");
    const preview = await previewNotebook(request(`${apiBase}/account/import/preview`, {
      cookie: targetCookie,
      body: tampered,
    }));
    expect(preview.status).toBe(422);
    expect((await preview.json()).error.code).toBe("INVALID_IMPORT");
  });

  it("rejects duplicate note identifiers in v1 and v2 before importing anything", async () => {
    const sourceCookie = await sessionFor("duplicate-transfer-source");
    await createNote(request(`${apiBase}/notes`, {
      cookie: sourceCookie,
      body: { title: "Only once", prompt: "Duplicate IDs must be rejected" },
    }));
    const exported = await exportNotebook(request(`${apiBase}/account/export`, { cookie: sourceCookie }));
    const v2 = JSON.parse(await exported.text());
    v2.notes.push(structuredClone(v2.notes[0]));
    const v1 = {
      format: v2.format,
      version: 1,
      exportedAt: v2.exportedAt,
      notes: v2.notes.map(({ characterProfiles: _characters, ...note }: { characterProfiles: unknown }) => {
        void _characters;
        return note;
      }),
      customTerms: v2.customTerms,
    };
    const targetCookie = await sessionFor("duplicate-transfer-target");

    for (const document of [v2, v1]) {
      const preview = await previewNotebook(request(`${apiBase}/account/import/preview`, {
        cookie: targetCookie,
        body: document,
      }));
      expect(preview.status).toBe(422);
      expect((await preview.json()).error.code).toBe("INVALID_IMPORT");
    }
    const notes = await listNotes(request(`${apiBase}/notes`, { cookie: targetCookie }));
    expect((await notes.json()).data).toHaveLength(0);
  });
});
