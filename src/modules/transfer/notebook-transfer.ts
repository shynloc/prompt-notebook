import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { customTerms, promptNotes } from "@/db/schema";
import { createNoteSchema } from "@/modules/notes/note-schema";
import { NoteRepository } from "@/modules/notes/note-repository";

const exportNoteSchema = createNoteSchema.extend({ deletedAt: z.coerce.date().nullable().optional() });
export const notebookExportSchema = z.object({
  format: z.literal("prompt-notebook-export"),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  notes: z.array(exportNoteSchema).max(10_000),
  customTerms: z.array(z.object({ category: z.string().min(1).max(100), label: z.string().min(1).max(200), value: z.string().min(1).max(2_000) })).max(10_000),
});

export type NotebookExport = z.infer<typeof notebookExportSchema>;

export class NotebookTransferService {
  constructor(private readonly notes = new NoteRepository()) {}

  async export(userId: string): Promise<NotebookExport> {
    const items = [];
    for (const view of ["active", "archived", "trash"] as const) {
      let cursor: string | undefined;
      do {
        const page = await this.notes.list(userId, { limit: 100, cursor, view });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    const terms = await db.select({ category: customTerms.category, label: customTerms.label, value: customTerms.value }).from(customTerms).where(eq(customTerms.userId, userId));
    return {
      format: "prompt-notebook-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      notes: items.map((note) => ({
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
        images: note.images.map(({ storageProvider, objectKey, displayUrl, thumbnailUrl, mimeType, width, height, sizeBytes }) => ({ storageProvider: storageProvider as "picbed" | "external", objectKey, displayUrl, thumbnailUrl, mimeType: mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", width, height, sizeBytes })),
      })),
      customTerms: terms,
    };
  }

  async preview(userId: string, document: NotebookExport) {
    let existing = 0;
    for (const note of document.notes) {
      if (!note.id) continue;
      const targetId = await targetNoteId(userId, note.id);
      if (await this.notes.findById(userId, targetId, true)) existing += 1;
    }
    return { notes: document.notes.length, newNotes: document.notes.length - existing, existingNotes: existing, customTerms: document.customTerms.length, fingerprint: fingerprint(document) };
  }

  async import(userId: string, document: NotebookExport) {
    let imported = 0; let skipped = 0;
    for (const source of document.notes) {
      let targetId = source.id;
      if (source.id) {
        targetId = await targetNoteId(userId, source.id);
        if (targetId && await this.notes.findById(userId, targetId, true)) { skipped += 1; continue; }
      }
      const { deletedAt, ...input } = source;
      const created = await this.notes.create(userId, { ...input, id: targetId, captureMethod: input.captureMethod ?? "import" });
      if (deletedAt) await this.notes.setDeleted(userId, created.id, created.version, true);
      imported += 1;
    }
    for (const term of document.customTerms) {
      const exists = await db.select({ id: customTerms.id }).from(customTerms).where(and(eq(customTerms.userId, userId), eq(customTerms.category, term.category), eq(customTerms.label, term.label))).limit(1);
      if (!exists.length) await db.insert(customTerms).values({ userId, ...term });
    }
    return { imported, skipped, customTerms: document.customTerms.length, fingerprint: fingerprint(document) };
  }
}

function fingerprint(document: NotebookExport) {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex").slice(0, 16);
}

function portableNoteId(userId: string, sourceId: string) {
  const hex = createHash("sha256").update(`${userId}:${sourceId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

async function targetNoteId(userId: string, sourceId: string) {
  const [owner] = await db.select({ userId: promptNotes.userId }).from(promptNotes).where(eq(promptNotes.id, sourceId)).limit(1);
  return owner && owner.userId !== userId ? portableNoteId(userId, sourceId) : sourceId;
}
