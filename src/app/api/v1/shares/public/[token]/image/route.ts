import { errorResponse } from "@/lib/api/response";
import { ShareService } from "@/modules/sharing/share-service";
import { trustedClientIp } from "@/lib/auth/trusted-client-ip";

export const runtime = "nodejs";
const shares = new ShareService();

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const result = await shares.publicImage(token, trustedClientIp(request.headers));
    return new Response(new Uint8Array(result.data), {
      headers: {
        "content-type": result.metadata.mimeType,
        "content-length": String(result.data.length),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  } catch (error) { return errorResponse(error); }
}
