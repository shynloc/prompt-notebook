import { z } from "zod";

export const termInputSchema = z.object({
  category: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(500),
});
export const termIdSchema = z.uuid();
