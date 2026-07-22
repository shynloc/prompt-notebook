import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { AiConfigurationService } from "@/modules/ai/ai-configuration-service";

const service = new AiConfigurationService();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    const id = z.uuid().parse((await context.params).id);
    return dataResponse(await service.test(session.user.id, id));
  } catch (error) {
    return errorResponse(error);
  }
}
