import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireExtensionSession } from "@/lib/auth/session";
import { extensionCaptureSchema, idempotencyKeySchema } from "@/modules/extension/capture-schema";
import { ExtensionCaptureService } from "@/modules/extension/capture-service";

const captures = new ExtensionCaptureService();

export async function POST(request: Request) {
  try {
    const principal = await requireExtensionSession(request);
    const key = idempotencyKeySchema.parse(request.headers.get("idempotency-key"));
    const result = await captures.capture(principal.userId, key, extensionCaptureSchema.parse(await request.json()));
    return dataResponse(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

