import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { inspectImage, MAX_IMAGE_BYTES } from "@/modules/media/image-policy";
import { ReversePromptService } from "@/modules/ai/reverse-prompt-service";
import { secureOutboundFetch } from "@/modules/ai/secure-outbound-fetch";

const inputSchema = z.object({ imageUrl: z.url().max(4_000) });
interface ReverseService {
  reverse(userId: string, image: Buffer, mimeType: "image/jpeg" | "image/png" | "image/webp", signal?: AbortSignal): Promise<unknown>;
}

async function downloadImage(imageUrl: string) {
  let response: Response;
  try {
    response = await secureOutboundFetch(new URL(imageUrl), {
      method: "GET",
      headers: { accept: "image/jpeg,image/png,image/webp" },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(422, "REVERSE_PROMPT_IMAGE_UNAVAILABLE", "无法安全下载远程图片");
  }
  if (!response.ok || !response.body || (response.status >= 300 && response.status < 400)) {
    throw new ApiError(422, "REVERSE_PROMPT_IMAGE_UNAVAILABLE", "远程图片不可用");
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new ApiError(422, "REVERSE_PROMPT_IMAGE_INVALID", "图片不能超过 10MB");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new ApiError(422, "REVERSE_PROMPT_IMAGE_INVALID", "图片不能超过 10MB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function sourceImage(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  let image: Buffer;
  if (type.toLowerCase().includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      throw new ApiError(422, "REVERSE_PROMPT_IMAGE_INVALID", "请选择不超过 10MB 的图片");
    }
    image = Buffer.from(await file.arrayBuffer());
  } else {
    const { imageUrl } = inputSchema.parse(await request.json());
    image = await downloadImage(imageUrl);
  }
  const metadata = await inspectImage(image);
  return { image, mimeType: metadata.mimeType };
}

const defaultService = new ReversePromptService();

export function createReversePromptHandler(service: ReverseService = defaultService) {
  return async function POST(request: Request) {
    try {
      const session = await requireSession(request);
      const source = await sourceImage(request);
      return dataResponse(await service.reverse(session.user.id, source.image, source.mimeType, request.signal));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createReversePromptHandler();
