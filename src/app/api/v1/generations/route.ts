import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { MAX_IMAGE_BYTES } from "@/modules/media/image-policy";
import { GenerationService } from "@/modules/generation/generation-service";
import { createGenerationSchema, listGenerationsSchema } from "@/modules/generation/generation-schema";

const MAX_MULTIPART_BYTES = 4 * MAX_IMAGE_BYTES + 256_000;

interface GenerationApiService {
  create(userId: string, input: z.infer<typeof createGenerationSchema> & { referenceImages?: Buffer[] }): Promise<unknown>;
  list(userId: string, input: z.infer<typeof listGenerationsSchema>): Promise<unknown>;
}

async function parseCreateRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return { ...createGenerationSchema.parse(await request.json()), referenceImages: [] };
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
    throw new ApiError(413, "GENERATION_REQUEST_TOO_LARGE", "The generation request is too large");
  }
  const form = await request.formData();
  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string") throw new ApiError(422, "GENERATION_PAYLOAD_REQUIRED", "Generation settings are required");
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Generation settings are not valid JSON");
  }
  const files = form.getAll("references");
  if (files.length > 4) throw new ApiError(422, "GENERATION_REFERENCE_LIMIT", "At most 4 reference images are allowed");
  const referenceImages: Buffer[] = [];
  for (const candidate of files) {
    if (!(candidate instanceof File)) throw new ApiError(422, "GENERATION_REFERENCE_INVALID", "Reference images must be files");
    if (candidate.size <= 0 || candidate.size > MAX_IMAGE_BYTES) {
      throw new ApiError(422, "GENERATION_REFERENCE_INVALID", "Each reference image must be no larger than 10MB");
    }
    referenceImages.push(Buffer.from(await candidate.arrayBuffer()));
  }
  return { ...createGenerationSchema.parse(payload), referenceImages };
}

let defaultService: GenerationService | undefined;
function generationService(service?: GenerationApiService) {
  return service ?? (defaultService ??= new GenerationService());
}

export function createGenerationHandlers(service?: GenerationApiService) {
  return {
    GET: async (request: Request) => {
      try {
        const session = await requireSession(request);
        const url = new URL(request.url);
        const query = listGenerationsSchema.parse({
          limit: url.searchParams.get("limit") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
        });
        return dataResponse(await generationService(service).list(session.user.id, query));
      } catch (error) {
        return errorResponse(error);
      }
    },
    POST: async (request: Request) => {
      try {
        const session = await requireSession(request);
        return dataResponse(await generationService(service).create(session.user.id, await parseCreateRequest(request)), { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const handlers = createGenerationHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
