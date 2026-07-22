import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { createAiConfigurationSchema } from "@/modules/ai/ai-configuration-schema";
import { AiConfigurationService } from "@/modules/ai/ai-configuration-service";

const service = new AiConfigurationService();

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return dataResponse(await service.list(session.user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = createAiConfigurationSchema.parse(await request.json());
    return dataResponse(await service.create(session.user.id, input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
