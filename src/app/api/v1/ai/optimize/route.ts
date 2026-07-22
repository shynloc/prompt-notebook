import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { PromptOptimizer } from "@/modules/ai/prompt-optimizer";

const optimizePromptSchema = z.object({
  prompt: z.string().trim().min(1).max(50_000),
  context: z.enum(["general", "image_generation"]).default("general"),
});

const defaultOptimizer = new PromptOptimizer();

export function createOptimizeHandler(optimizer = defaultOptimizer) {
  return async function optimize(request: Request) {
    try {
      const session = await requireSession(request);
      const input = optimizePromptSchema.parse(await request.json());
      return dataResponse(await optimizer.optimize(session.user.id, input.prompt, request.signal, input.context));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createOptimizeHandler();
