import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { MAX_IMAGE_BYTES } from "@/modules/media/image-policy";
import { MediaService } from "@/modules/media/media-service";

const media = new MediaService();
const importSchema = z.object({ url: z.url().max(4000) });

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const contentType = request.headers.get("content-type") ?? "";
    const json = contentType.toLowerCase().includes("application/json");
    const bytes = await boundedInput(request, json ? 16_000 : MAX_IMAGE_BYTES + 64_000);
    const result = json
      ? await media.importUrl(session.user.id, importSchema.parse(JSON.parse(bytes.toString("utf8"))).url)
      : await uploadFile(bytes, contentType, session.user.id);
    return dataResponse(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(error instanceof Error ? new ApiError(422, "IMAGE_REJECTED", error.message) : error);
  }
}

async function boundedInput(request: Request, maximum: number) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maximum) throw new ApiError(413, "IMAGE_UPLOAD_TOO_LARGE", "图片不能超过 10MB");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (reader) {
      if (request.signal.aborted) throw new ApiError(499, "REQUEST_CANCELLED", "上传已取消");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new ApiError(413, "IMAGE_UPLOAD_TOO_LARGE", "图片不能超过 10MB"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { reader?.releaseLock(); }
}

async function uploadFile(bytes: Buffer, contentType: string, userId: string) {
  const form = await new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } }).formData();
  if (form.getAll("file").length !== 1 || [...form.keys()].some((name) => name !== "file")) throw new Error("图片上传表单无效");
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("请选择图片文件");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 10MB");
  return media.upload(userId, Buffer.from(await file.arrayBuffer()));
}
