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
    const result = contentType.includes("application/json")
      ? await media.importUrl(session.user.id, importSchema.parse(await request.json()).url)
      : await uploadFile(request, session.user.id);
    return dataResponse(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(error instanceof Error ? new ApiError(422, "IMAGE_REJECTED", error.message) : error);
  }
}

async function uploadFile(request: Request, userId: string) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("请选择图片文件");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 10MB");
  return media.upload(userId, Buffer.from(await file.arrayBuffer()));
}
