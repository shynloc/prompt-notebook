import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { GenerationService } from "@/modules/generation/generation-service";

interface GenerationDetailService {
  get(userId: string, id: string): Promise<unknown>;
  cancel(userId: string, id: string): Promise<unknown>;
}

let defaultService: GenerationService | undefined;
function generationService(service?: GenerationDetailService) {
  return service ?? (defaultService ??= new GenerationService());
}

export function createGenerationDetailHandlers(service?: GenerationDetailService) {
  async function withJob(request: Request, context: { params: Promise<{ id: string }> }, action: "get" | "cancel") {
    try {
      const session = await requireSession(request);
      const id = z.uuid().parse((await context.params).id);
      return dataResponse(await generationService(service)[action](session.user.id, id));
    } catch (error) {
      return errorResponse(error);
    }
  }
  return {
    GET: (request: Request, context: { params: Promise<{ id: string }> }) => withJob(request, context, "get"),
    DELETE: (request: Request, context: { params: Promise<{ id: string }> }) => withJob(request, context, "cancel"),
  };
}

const handlers = createGenerationDetailHandlers();
export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
