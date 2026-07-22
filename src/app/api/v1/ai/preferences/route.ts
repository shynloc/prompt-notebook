import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { updateAiPreferenceSchema } from "@/modules/ai/ai-configuration-schema";
import { AiConfigurationService } from "@/modules/ai/ai-configuration-service";

const service = new AiConfigurationService();

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return dataResponse(await service.listPreferences(session.user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const session = await requireSession(request);
    return dataResponse(await service.updatePreference(
      session.user.id,
      updateAiPreferenceSchema.parse(await request.json()),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
