import { requireSession } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/response";
import { LocalMediaStore } from "@/modules/media/local-media-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(request);
    const { id } = await context.params;
    const { data, metadata } = await new LocalMediaStore(session.user.id).read(id);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": metadata.mimeType,
        "content-length": String(data.length),
        "content-disposition": `inline; filename="${metadata.id}.${metadata.mimeType === "image/jpeg" ? "jpg" : metadata.mimeType.split("/")[1]}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  } catch (error) { return errorResponse(error); }
}
