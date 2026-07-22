import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { updateAiConfigurationSchema } from "@/modules/ai/ai-configuration-schema";
import { AiConfigurationService } from "@/modules/ai/ai-configuration-service";

const service = new AiConfigurationService();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    const id = z.uuid().parse((await context.params).id);
    return dataResponse(await service.update(
      session.user.id,
      id,
      updateAiConfigurationSchema.parse(await request.json()),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    const id = z.uuid().parse((await context.params).id);
    return dataResponse(await service.delete(session.user.id, id));
  } catch (error) {
    return errorResponse(error);
  }
}
