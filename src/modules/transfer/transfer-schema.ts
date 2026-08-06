import { z } from "zod";

import {
  createCharacterProfileSchema,
  noteCharacterAssociationSchema,
} from "@/modules/characters/character-schema";
import { createNoteSchema } from "@/modules/notes/note-schema";

const MAX_TRANSFER_ITEMS = 10_000;

const customTermSchema = z.object({
  category: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  value: z.string().min(1).max(2_000),
});

const portableNoteV1Schema = createNoteSchema
  .omit({ characterProfiles: true })
  .extend({ deletedAt: z.coerce.date().nullable().optional() });

const portableNoteV2Schema = portableNoteV1Schema.extend({
  id: z.uuid(),
  characterProfiles: z.array(noteCharacterAssociationSchema).max(8).default([]),
});

const portableCharacterProfileSchema = createCharacterProfileSchema.safeExtend({
  id: z.uuid(),
  archivedAt: z.coerce.date().nullable().optional(),
  deletedAt: z.coerce.date().nullable().optional(),
});

export const notebookExportV1Schema = z.object({
  format: z.literal("prompt-notebook-export"),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  notes: z.array(portableNoteV1Schema).max(MAX_TRANSFER_ITEMS),
  customTerms: z.array(customTermSchema).max(MAX_TRANSFER_ITEMS),
});

export const notebookExportV2Schema = z.object({
  format: z.literal("prompt-notebook-export"),
  version: z.literal(2),
  exportedAt: z.iso.datetime(),
  characterProfiles: z.array(portableCharacterProfileSchema).max(MAX_TRANSFER_ITEMS),
  notes: z.array(portableNoteV2Schema).max(MAX_TRANSFER_ITEMS),
  customTerms: z.array(customTermSchema).max(MAX_TRANSFER_ITEMS),
});

export const notebookExportSchema = z
  .discriminatedUnion("version", [notebookExportV1Schema, notebookExportV2Schema])
  .superRefine((document, context) => {
    const seenNoteIds = new Set<string>();
    for (const [index, note] of document.notes.entries()) {
      if (!note.id) continue;
      if (seenNoteIds.has(note.id)) {
        context.addIssue({
          code: "custom",
          path: ["notes", index, "id"],
          message: "Note IDs must be unique within an export",
        });
      }
      seenNoteIds.add(note.id);
    }
    if (document.version !== 2) return;
    const profileIds = new Set(document.characterProfiles.map((profile) => profile.id));
    const seenProfileIds = new Set<string>();
    for (const [index, profile] of document.characterProfiles.entries()) {
      if (seenProfileIds.has(profile.id)) {
        context.addIssue({
          code: "custom",
          path: ["characterProfiles", index, "id"],
          message: "Character profile IDs must be unique within an export",
        });
      }
      seenProfileIds.add(profile.id);
    }
    for (const [noteIndex, note] of document.notes.entries()) {
      for (const [associationIndex, association] of note.characterProfiles.entries()) {
        if (!profileIds.has(association.id)) {
          context.addIssue({
            code: "custom",
            path: ["notes", noteIndex, "characterProfiles", associationIndex, "id"],
            message: "A note references a character profile that is not included in the export",
          });
        }
      }
    }
  });

export type NotebookExportV1 = z.infer<typeof notebookExportV1Schema>;
export type NotebookExportV2 = z.infer<typeof notebookExportV2Schema>;
export type NotebookExport = z.infer<typeof notebookExportSchema>;
