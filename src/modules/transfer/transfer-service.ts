import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import {
  characterProfiles,
  customTerms,
  promptNotes,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  CharacterRepository,
  type CharacterProfileView,
} from "@/modules/characters/character-repository";
import type { CreateCharacterProfileInput } from "@/modules/characters/character-schema";
import {
  NoteRepository,
  type PromptNoteView,
} from "@/modules/notes/note-repository";

import type {
  NotebookExport,
  NotebookExportV2,
} from "./transfer-schema";

const LOOKUP_CHUNK_SIZE = 2_000;

type OwnedIds = {
  targets: Map<string, string>;
  existingTargets: Set<string>;
};

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

async function noteOwners(ids: string[]) {
  const owners = new Map<string, string>();
  for (const batch of chunks([...new Set(ids)], LOOKUP_CHUNK_SIZE)) {
    if (!batch.length) continue;
    const rows = await db.select({ id: promptNotes.id, userId: promptNotes.userId })
      .from(promptNotes)
      .where(inArray(promptNotes.id, batch));
    for (const row of rows) owners.set(row.id, row.userId);
  }
  return owners;
}

async function characterOwners(ids: string[]) {
  const owners = new Map<string, string>();
  for (const batch of chunks([...new Set(ids)], LOOKUP_CHUNK_SIZE)) {
    if (!batch.length) continue;
    const rows = await db.select({ id: characterProfiles.id, userId: characterProfiles.userId })
      .from(characterProfiles)
      .where(inArray(characterProfiles.id, batch));
    for (const row of rows) owners.set(row.id, row.userId);
  }
  return owners;
}

function portableEntityId(userId: string, kind: "note" | "character", sourceId: string) {
  const hex = createHash("sha256")
    // Preserve the v1 note mapping so previously imported backups remain idempotent.
    .update(kind === "note" ? `${userId}:${sourceId}` : `${userId}:character:${sourceId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

async function resolveOwnedIds(
  userId: string,
  kind: "note" | "character",
  sourceIds: string[],
): Promise<OwnedIds> {
  const loadOwners = kind === "note" ? noteOwners : characterOwners;
  const sourceOwners = await loadOwners(sourceIds);
  const targets = new Map<string, string>();
  for (const sourceId of sourceIds) {
    const sourceOwner = sourceOwners.get(sourceId);
    targets.set(
      sourceId,
      sourceOwner && sourceOwner !== userId
        ? portableEntityId(userId, kind, sourceId)
        : sourceId,
    );
  }

  const targetOwners = await loadOwners([...targets.values()]);
  const existingTargets = new Set<string>();
  for (const targetId of targets.values()) {
    const owner = targetOwners.get(targetId);
    if (owner === userId) existingTargets.add(targetId);
    if (owner && owner !== userId) {
      throw new ApiError(
        409,
        "IMPORT_ID_COLLISION",
        `A portable ${kind} identifier collides with an existing resource`,
      );
    }
  }
  return { targets, existingTargets };
}

function exportNote(note: PromptNoteView): NotebookExportV2["notes"][number] {
  return {
    id: note.id,
    title: note.title,
    prompt: note.prompt,
    negativePrompt: note.negativePrompt,
    model: note.model,
    sourceUrl: note.sourceUrl,
    sourceTitle: note.sourceTitle,
    capturedAt: note.capturedAt,
    captureMethod: note.captureMethod as "web" | "extension" | "import" | null,
    parameters: note.parameters,
    favorite: note.favorite,
    archivedAt: note.archivedAt,
    deletedAt: note.deletedAt,
    tags: note.tags.map((tag) => tag.name),
    characterProfiles: note.characterProfiles.map((profile) => ({
      id: profile.id,
      role: profile.role,
      sortOrder: profile.sortOrder,
    })),
    images: note.images.map((image) => ({
      storageProvider: image.storageProvider as "picbed" | "external",
      objectKey: image.objectKey,
      displayUrl: image.displayUrl,
      thumbnailUrl: image.thumbnailUrl,
      mimeType: image.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
      width: image.width,
      height: image.height,
      sizeBytes: image.sizeBytes,
    })),
  };
}

function exportCharacter(
  profile: CharacterProfileView,
): NotebookExportV2["characterProfiles"][number] {
  return {
    id: profile.id,
    name: profile.name,
    summary: profile.summary,
    roleDefinition: profile.roleDefinition,
    useCases: profile.useCases,
    appearance: profile.appearance,
    promptAnchor: profile.promptAnchor,
    negativePrompt: profile.negativePrompt,
    rightsNote: profile.rightsNote,
    attributes: profile.attributes,
    archivedAt: profile.archivedAt,
    deletedAt: profile.deletedAt,
    images: profile.images.map((image) => ({
      id: image.id,
      storageProvider: image.storageProvider as "picbed" | "external",
      objectKey: image.objectKey,
      displayUrl: image.displayUrl,
      thumbnailUrl: image.thumbnailUrl,
      mimeType: image.mimeType as "image/jpeg" | "image/png" | "image/webp",
      width: image.width,
      height: image.height,
      sizeBytes: image.sizeBytes,
      viewType: image.viewType as NotebookExportV2["characterProfiles"][number]["images"][number]["viewType"],
      caption: image.caption,
      isCover: image.isCover,
      isPrimary: image.isPrimary,
      focusX: image.focusX,
      focusY: image.focusY,
      metadata: image.metadata,
    })),
  };
}

function importCharacter(
  source: NotebookExportV2["characterProfiles"][number],
): CreateCharacterProfileInput {
  return {
    name: source.name,
    summary: source.summary,
    roleDefinition: source.roleDefinition,
    useCases: source.useCases,
    appearance: source.appearance,
    promptAnchor: source.promptAnchor,
    negativePrompt: source.negativePrompt,
    rightsNote: source.rightsNote,
    attributes: source.attributes,
    images: source.images.map((image) => ({
      storageProvider: image.storageProvider,
      objectKey: image.objectKey,
      displayUrl: image.displayUrl,
      thumbnailUrl: image.thumbnailUrl,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      sizeBytes: image.sizeBytes,
      viewType: image.viewType,
      caption: image.caption,
      isCover: image.isCover,
      isPrimary: image.isPrimary,
      focusX: image.focusX,
      focusY: image.focusY,
      metadata: image.metadata,
    })),
  };
}

export class NotebookTransferService {
  constructor(
    private readonly notes = new NoteRepository(),
    private readonly characters = new CharacterRepository(),
  ) {}

  async export(userId: string): Promise<NotebookExportV2> {
    const notes: PromptNoteView[] = [];
    for (const view of ["active", "archived", "trash"] as const) {
      let cursor: string | undefined;
      do {
        const page = await this.notes.list(userId, { limit: 100, cursor, view });
        notes.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }

    const profiles: CharacterProfileView[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.characters.list(userId, { limit: 100, cursor, view: "all" });
      profiles.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const terms = await db.select({
      category: customTerms.category,
      label: customTerms.label,
      value: customTerms.value,
    }).from(customTerms).where(eq(customTerms.userId, userId));

    return {
      format: "prompt-notebook-export",
      version: 2,
      exportedAt: new Date().toISOString(),
      characterProfiles: profiles.map(exportCharacter),
      notes: notes.map(exportNote),
      customTerms: terms,
    };
  }

  async preview(userId: string, document: NotebookExport) {
    const sourceNoteIds = document.notes.flatMap((note) => note.id ? [note.id] : []);
    const noteIds = await resolveOwnedIds(userId, "note", sourceNoteIds);
    const sourceProfiles = document.version === 2 ? document.characterProfiles : [];
    const profileIds = await resolveOwnedIds(
      userId,
      "character",
      sourceProfiles.map((profile) => profile.id),
    );
    const existingNotes = sourceNoteIds.filter((id) => {
      const target = noteIds.targets.get(id);
      return target ? noteIds.existingTargets.has(target) : false;
    }).length;
    const existingProfiles = sourceProfiles.filter((profile) => {
      const target = profileIds.targets.get(profile.id);
      return target ? profileIds.existingTargets.has(target) : false;
    }).length;
    const associations = document.version === 2
      ? document.notes.reduce((sum, note) => sum + note.characterProfiles.length, 0)
      : 0;

    return {
      notes: document.notes.length,
      newNotes: document.notes.length - existingNotes,
      existingNotes,
      characterProfiles: sourceProfiles.length,
      newCharacterProfiles: sourceProfiles.length - existingProfiles,
      existingCharacterProfiles: existingProfiles,
      characterAssociations: associations,
      customTerms: document.customTerms.length,
      fingerprint: fingerprint(document),
    };
  }

  async import(userId: string, document: NotebookExport) {
    const sourceProfiles = document.version === 2 ? document.characterProfiles : [];
    const profileIds = await resolveOwnedIds(
      userId,
      "character",
      sourceProfiles.map((profile) => profile.id),
    );
    let importedProfiles = 0;
    let skippedProfiles = 0;

    for (const source of sourceProfiles) {
      const targetId = profileIds.targets.get(source.id)!;
      if (profileIds.existingTargets.has(targetId)) {
        skippedProfiles += 1;
        continue;
      }
      const created = await this.characters.createImported(
        userId,
        targetId,
        importCharacter(source),
      );
      if (created.id !== targetId) {
        throw new ApiError(409, "IMPORT_ID_MISMATCH", "The imported AI Model ID could not be preserved");
      }
      importedProfiles += 1;
    }

    const sourceNoteIds = document.notes.flatMap((note) => note.id ? [note.id] : []);
    const noteIds = await resolveOwnedIds(userId, "note", sourceNoteIds);
    let imported = 0;
    let skipped = 0;
    for (const source of document.notes) {
      const targetId = source.id ? noteIds.targets.get(source.id) : undefined;
      if (targetId && noteIds.existingTargets.has(targetId)) {
        skipped += 1;
        continue;
      }
      const { deletedAt, ...portable } = source;
      const sourceAssociations = "characterProfiles" in portable
        ? portable.characterProfiles
        : [];
      const characterAssociations = sourceAssociations.map((association) => ({
        ...association,
        id: profileIds.targets.get(association.id)!,
      }));
      const input = document.version === 2
        ? { ...portable, id: targetId, characterProfiles: characterAssociations }
        : { ...portable, id: targetId, characterProfiles: [] };
      const created = await this.notes.create(userId, {
        ...input,
        captureMethod: input.captureMethod ?? "import",
      });
      if (deletedAt) {
        await this.notes.setDeleted(userId, created.id, created.version, true);
      }
      imported += 1;
    }

    // Lifecycle is the commit marker for imported profiles. Applying it only after
    // every note succeeds keeps deleted/archived profiles bindable on a retry.
    await this.applyCharacterLifecycle(userId, sourceProfiles, profileIds.targets);

    for (const term of document.customTerms) {
      const exists = await db.select({ id: customTerms.id }).from(customTerms).where(and(
        eq(customTerms.userId, userId),
        eq(customTerms.category, term.category),
        eq(customTerms.label, term.label),
      )).limit(1);
      if (!exists.length) await db.insert(customTerms).values({ userId, ...term });
    }

    return {
      imported,
      skipped,
      importedCharacterProfiles: importedProfiles,
      skippedCharacterProfiles: skippedProfiles,
      characterAssociations: document.version === 2
        ? document.notes.reduce((sum, note) => sum + note.characterProfiles.length, 0)
        : 0,
      customTerms: document.customTerms.length,
      fingerprint: fingerprint(document),
    };
  }

  private async applyCharacterLifecycle(
    userId: string,
    sources: NotebookExportV2["characterProfiles"],
    targets: Map<string, string>,
  ) {
    for (const source of sources) {
      if (!source.deletedAt && !source.archivedAt) continue;
      const targetId = targets.get(source.id)!;
      const current = await this.characters.findById(userId, targetId, true);
      if (!current) {
        throw new ApiError(409, "IMPORT_PROFILE_MISSING", "An imported AI Model disappeared before lifecycle finalization");
      }
      if (source.deletedAt) {
        if (current.deletedAt) continue;
        const removed = await this.characters.setDeleted(userId, targetId, current.version, true);
        if (!removed) {
          throw new ApiError(409, "IMPORT_PROFILE_CONFLICT", "An imported AI Model changed during lifecycle finalization");
        }
        continue;
      }
      if (current.deletedAt || current.archivedAt) continue;
      const archived = await this.characters.update(userId, targetId, {
        version: current.version,
        archivedAt: source.archivedAt,
      });
      if (!archived) {
        throw new ApiError(409, "IMPORT_PROFILE_CONFLICT", "An imported AI Model changed during lifecycle finalization");
      }
    }
  }
}

function fingerprint(document: NotebookExport) {
  return createHash("sha256")
    .update(JSON.stringify(document))
    .digest("hex")
    .slice(0, 16);
}
