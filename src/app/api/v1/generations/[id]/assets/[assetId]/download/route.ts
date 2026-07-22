import { z } from "zod";

import { errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { GenerationService } from "@/modules/generation/generation-service";

interface GenerationAssetDownloadService {
  downloadAsset(userId: string, jobId: string, assetId: string): Promise<{
    data: Uint8Array;
    mimeType: string;
    filename: string;
  }>;
}

let defaultService: GenerationService | undefined;
function generationService(service?: GenerationAssetDownloadService) {
  return service ?? (defaultService ??= new GenerationService());
}

export function createGenerationAssetDownloadHandler(service?: GenerationAssetDownloadService) {
  return async function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
    try {
      const session = await requireSession(request);
      const { id, assetId } = z.object({ id: z.uuid(), assetId: z.uuid() }).parse(await context.params);
      const asset = await generationService(service).downloadAsset(session.user.id, id, assetId);
      return new Response(new Uint8Array(asset.data), {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="${asset.filename}"`,
          "content-length": String(asset.data.byteLength),
          "content-type": asset.mimeType,
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const GET = createGenerationAssetDownloadHandler();
