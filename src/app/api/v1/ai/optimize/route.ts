import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { PromptOptimizer } from "@/modules/ai/prompt-optimizer";
import {
  MAX_OPTIMIZED_PROMPT_LENGTH,
  PROMPT_MODULES,
  PROMPT_OPTIMIZATION_ASPECT_RATIOS,
  PROMPT_OPTIMIZATION_CONTEXTS,
} from "@/modules/ai/prompt-structure-contract";

const optimizePromptSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_OPTIMIZED_PROMPT_LENGTH),
  context: z.enum(PROMPT_OPTIMIZATION_CONTEXTS).default("auto"),
  requestedModules: z.array(z.enum(PROMPT_MODULES))
    .max(PROMPT_MODULES.length)
    .refine((modules) => new Set(modules).size === modules.length, "Requested modules must be unique")
    .default([]),
  hints: z.object({
    hasAiModel: z.boolean().optional(),
    referenceImageCount: z.number().int().min(0).max(4).optional(),
    aspectRatio: z.enum(PROMPT_OPTIMIZATION_ASPECT_RATIOS).optional(),
  }).strict().default({}),
}).strict().superRefine((value, context) => {
  const hasGeneral = value.requestedModules.includes("general");
  const hasVisual = value.requestedModules.some((moduleId) => moduleId !== "general");
  if (hasGeneral && hasVisual) {
    context.addIssue({
      code: "custom",
      message: "The general module cannot be combined with visual modules",
      path: ["requestedModules"],
    });
  }
  if (value.context === "image_generation" && hasGeneral) {
    context.addIssue({
      code: "custom",
      message: "The general module cannot be requested for image generation",
      path: ["requestedModules"],
    });
  }
  if (value.context === "general" && hasVisual) {
    context.addIssue({
      code: "custom",
      message: "Visual modules cannot be requested for a general optimization",
      path: ["requestedModules"],
    });
  }
});

const defaultOptimizer = new PromptOptimizer();

export function createOptimizeHandler(optimizer = defaultOptimizer) {
  return async function optimize(request: Request) {
    try {
      const session = await requireSession(request);
      const input = optimizePromptSchema.parse(await request.json());
      return dataResponse(await optimizer.optimize(
        session.user.id,
        input.prompt,
        request.signal,
        input.context,
        input.requestedModules,
        input.hints,
      ));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createOptimizeHandler();
