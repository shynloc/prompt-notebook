import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireExtensionSession } from "@/lib/auth/session";
import { ExtensionTokenService } from "@/modules/extension/token-service";

const tokens = new ExtensionTokenService();

export async function POST(request: Request) {
  try {
    const principal = await requireExtensionSession(request);
    await tokens.revokeCurrent(principal.deviceId);
    return dataResponse({ revoked: true });
  } catch (error) {
    return errorResponse(error);
  }
}

