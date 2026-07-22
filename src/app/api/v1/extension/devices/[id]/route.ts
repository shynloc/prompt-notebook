import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { ExtensionTokenService } from "@/modules/extension/token-service";

const tokens = new ExtensionTokenService();

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request);
    const { id } = await context.params;
    return dataResponse(await tokens.revokeDevice(session.user.id, id));
  } catch (error) {
    return errorResponse(error);
  }
}

