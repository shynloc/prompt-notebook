import { z } from "zod";

import { tagNameSchema } from "@/modules/notes/note-schema";

const publicUrl = z.url().max(4000).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "链接必须使用 HTTP 或 HTTPS");

export const extensionCaptureSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(100_000),
  tags: z.array(tagNameSchema).max(20).default([]),
  sourceUrl: publicUrl,
  sourceTitle: z.string().trim().max(500).nullable().optional(),
  imageUrls: z.array(publicUrl).max(8).default([]),
});

export const idempotencyKeySchema = z.uuid();

export type ExtensionCaptureInput = z.infer<typeof extensionCaptureSchema>;

