import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { MAX_IMAGE_BYTES } from "@/modules/media/image-policy";
import { GenerationService } from "@/modules/generation/generation-service";
import { createGenerationSchema, listGenerationsSchema } from "@/modules/generation/generation-schema";

const MAX_MULTIPART_BYTES = 4 * MAX_IMAGE_BYTES + 4 * 1024 * 1024;

interface GenerationApiService {
  create(userId: string, input: z.infer<typeof createGenerationSchema> & { referenceImages?: Buffer[]; maskImage?: Buffer }): Promise<unknown>;
  list(userId: string, input: z.infer<typeof listGenerationsSchema>): Promise<unknown>;
}

async function parseCreateRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const multipart = contentType.toLowerCase().includes("multipart/form-data");
  const maximum = multipart ? MAX_MULTIPART_BYTES : 256_000;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maximum) throw new ApiError(413, "GENERATION_REQUEST_TOO_LARGE", "请求体过大，请减少参考图片或蒙版文件大小");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (reader) {
      if (request.signal.aborted) throw new ApiError(499, "REQUEST_CANCELLED", "请求已取消");
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new ApiError(413, "GENERATION_REQUEST_TOO_LARGE", "请求体过大，请减少参考图片或蒙版文件大小"); }
      chunks.push(value);
    }
  } finally { reader?.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return { ...createGenerationSchema.parse(JSON.parse(bytes.toString("utf8"))), referenceImages: [] };
  }
  let form: FormData;
  try { form = await new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } }).formData(); }
  catch { throw new ApiError(422, "GENERATION_PAYLOAD_INVALID", "生图表单无效"); }
  for (const key of new Set(form.keys())) {
    if (!["payload", "references", "mask"].includes(key) || (key !== "references" && form.getAll(key).length !== 1)) throw new ApiError(422, "GENERATION_PAYLOAD_INVALID", "生图表单包含重复或无效字段");
  }
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
  const mask = form.get("mask");
  if (form.has("mask") && (!(mask instanceof File) || mask.size <= 0 || mask.size > MAX_IMAGE_BYTES)) throw new ApiError(422, "GENERATION_MASK_INVALID", "请选择不超过 10MB 的 PNG 蒙版");
  return { ...createGenerationSchema.parse(payload), referenceImages, ...(mask instanceof File ? { maskImage: Buffer.from(await mask.arrayBuffer()) } : {}) };
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
