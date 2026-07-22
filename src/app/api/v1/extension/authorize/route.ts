import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { authorizeExtensionSchema } from "@/modules/extension/extension-schema";
import { ExtensionTokenService } from "@/modules/extension/token-service";

const tokens = new ExtensionTokenService();

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const result = await tokens.authorize(session.user.id, authorizeExtensionSchema.parse(await request.json()));
    return dataResponse(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

