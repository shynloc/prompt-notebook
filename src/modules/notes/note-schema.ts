import { z } from "zod";

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, "标签不能为空")
  .max(40, "标签最多 40 个字符")
  .transform((value) => value.normalize("NFKC"));

export const imageInputSchema = z.object({
  storageProvider: z.enum(["picbed", "external"]),
  objectKey: z.string().trim().min(1).max(1000),
  displayUrl: z.url().max(4000),
  thumbnailUrl: z.url().max(4000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  sizeBytes: z.number().int().min(0).max(20 * 1024 * 1024),
});

const noteFields = {
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(100_000),
  negativePrompt: z.string().max(100_000).nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  sourceUrl: z.url().max(4000).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "来源链接必须使用 HTTP 或 HTTPS").nullable().optional(),
  sourceTitle: z.string().trim().max(500).nullable().optional(),
  capturedAt: z.coerce.date().nullable().optional(),
  captureMethod: z.enum(["web", "extension", "import"]).nullable().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  favorite: z.boolean().optional(),
  archivedAt: z.coerce.date().nullable().optional(),
  tags: z.array(tagNameSchema).max(20).default([]),
  images: z.array(imageInputSchema).max(8).default([]),
};

export const createNoteSchema = z.object({
  id: z.uuid().optional(),
  ...noteFields,
});

export const updateNoteSchema = z
  .object({
    version: z.number().int().positive(),
    title: noteFields.title.optional(),
    prompt: noteFields.prompt.optional(),
    negativePrompt: noteFields.negativePrompt.optional(),
    model: noteFields.model.optional(),
    sourceUrl: noteFields.sourceUrl.optional(),
    sourceTitle: noteFields.sourceTitle.optional(),
    capturedAt: noteFields.capturedAt.optional(),
    captureMethod: noteFields.captureMethod.optional(),
    parameters: noteFields.parameters.optional(),
    favorite: noteFields.favorite.optional(),
    archivedAt: noteFields.archivedAt.optional(),
    tags: noteFields.tags.optional(),
    images: noteFields.images.optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "version"), {
    message: "At least one note field is required",
  });

export const versionSchema = z.object({ version: z.number().int().positive() });

export const listNotesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(500).optional(),
  q: z.string().trim().max(200).optional(),
  tagId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  sourceHost: z.string().trim().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  field: z.enum(["all", "title", "prompt"]).default("all"),
  favorite: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  view: z.enum(["active", "archived", "trash"]).default("active"),
  hasImage: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sort: z.enum(["updated", "title"]).default("updated"),
});

export type NoteImageInput = z.infer<typeof imageInputSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
