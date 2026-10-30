import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { GenerationService } from "@/modules/generation/generation-service";

const bodySchema = z.object({
  title: z.string().trim().max(200).optional(),
  includeCharacter: z.boolean().optional(),
}).strict();

type Context = { params: Promise<{ id: string }> };
let defaultService: GenerationService | undefined;

export function createGenerationNoteHandler(service?: Pick<GenerationService, "saveAsNote">) {
  return async (request: Request, context: Context) => {
    try {
      const session = await requireSession(request);
      const id = z.uuid().parse((await context.params).id);
      const body = bodySchema.parse(await request.json());
      const generations = service ?? (defaultService ??= new GenerationService());
      const result = await generations.saveAsNote(session.user.id, id, body);
      return dataResponse(result.note, { status: result.replayed ? 200 : 201 }, { replayed: result.replayed });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createGenerationNoteHandler();
