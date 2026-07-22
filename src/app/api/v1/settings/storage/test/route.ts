import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { MediaStorageConfigurationService } from "@/modules/media/media-storage-configuration-service";

const service = new MediaStorageConfigurationService();

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    return dataResponse(await service.test(session.user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
