import { z } from "zod";

import { IMAGE_GENERATION_QUALITIES } from "@/modules/ai/types";

const generationQualitySchema = z
  .union([z.enum(IMAGE_GENERATION_QUALITIES), z.literal("standard")])
  .transform((quality) => quality === "standard" ? "medium" as const : quality);

export const createGenerationSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  modelProfileId: z.uuid().optional(),
  prompt: z.string().trim().min(1).max(50_000),
  negativePrompt: z.string().trim().max(20_000).nullable().optional(),
  width: z.number().int().min(256).max(3_840),
  height: z.number().int().min(256).max(3_840),
  quality: generationQualitySchema,
  imageCount: z.number().int().min(1).max(4),
});

export type CreateGenerationFields = z.infer<typeof createGenerationSchema>;
export type CreateGenerationInput = CreateGenerationFields & { referenceImages?: Buffer[] };

export const listGenerationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z.enum(["all", "active", "succeeded", "failed", "cancelled"]).default("all"),
});
