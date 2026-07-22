import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { MediaStorageConfigurationService } from "@/modules/media/media-storage-configuration-service";
import { upsertMediaStorageSchema } from "@/modules/media/media-storage-schema";

const service = new MediaStorageConfigurationService();

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return dataResponse(await service.get(session.user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSession(request);
    const input = upsertMediaStorageSchema.parse(await request.json());
    return dataResponse(await service.upsert(session.user.id, input));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireSession(request);
    return dataResponse(await service.delete(session.user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
