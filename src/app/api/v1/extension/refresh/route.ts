import { dataResponse, errorResponse } from "@/lib/api/response";
import { refreshExtensionTokenSchema } from "@/modules/extension/extension-schema";
import { ExtensionTokenService } from "@/modules/extension/token-service";

const tokens = new ExtensionTokenService();

export async function POST(request: Request) {
  try {
    const { refreshToken } = refreshExtensionTokenSchema.parse(await request.json());
    return dataResponse(await tokens.refresh(refreshToken));
  } catch (error) {
    return errorResponse(error);
  }
}

