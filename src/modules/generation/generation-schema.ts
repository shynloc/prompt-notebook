import { z } from "zod";

export const createGenerationSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  modelProfileId: z.uuid().optional(),
  prompt: z.string().trim().min(1).max(50_000),
  negativePrompt: z.string().trim().max(20_000).nullable().optional(),
  width: z.number().int().min(256).max(2_048),
  height: z.number().int().min(256).max(2_048),
  quality: z.enum(["standard", "high"]),
  imageCount: z.number().int().min(1).max(4),
});

export type CreateGenerationFields = z.infer<typeof createGenerationSchema>;
export type CreateGenerationInput = CreateGenerationFields & { referenceImages?: Buffer[] };

export const listGenerationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z.enum(["all", "active", "succeeded", "failed", "cancelled"]).default("all"),
});
