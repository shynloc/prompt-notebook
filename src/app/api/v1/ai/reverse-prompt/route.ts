import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { inspectImage, MAX_IMAGE_BYTES } from "@/modules/media/image-policy";
import { ReversePromptService } from "@/modules/ai/reverse-prompt-service";
import { secureOutboundFetch } from "@/modules/ai/secure-outbound-fetch";
import { reverseOptionsSchema, type ReversePromptOptions } from "@/modules/ai/reverse-prompt-structure";

const inputSchema = reverseOptionsSchema.extend({ imageUrl: z.url().max(4_000).refine((value) => new URL(value).protocol === "https:", "请使用 HTTPS 图片链接") }).strict();
interface ReverseService {
  reverse(userId: string, image: Buffer, mimeType: "image/jpeg" | "image/png" | "image/webp", signal?: AbortSignal, options?: ReversePromptOptions): Promise<unknown>;
}

async function readBounded(body: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal) {
  if (!body) throw new ApiError(422, "REVERSE_PROMPT_IMAGE_INVALID", "请提供有效的图片内容");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new ApiError(499, "REQUEST_CANCELLED", "本次反推已取消");
      const { done, value } = await reader.read();
      if (signal.aborted) throw new ApiError(499, "REQUEST_CANCELLED", "本次反推已取消");
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new ApiError(413, "REVERSE_PROMPT_INPUT_TOO_LARGE", "图片不能超过 10MB，额外要求不能超过 2,000 字");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "REVERSE_PROMPT_IMAGE_UNAVAILABLE", "无法完整读取图片，请重新选择图片或检查链接。");
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

async function downloadImage(imageUrl: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await secureOutboundFetch(new URL(imageUrl), {
      method: "GET",
      headers: { accept: "image/jpeg,image/png,image/webp" },
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
  } catch {
    throw new ApiError(422, "REVERSE_PROMPT_IMAGE_UNAVAILABLE", "无法安全下载远程图片");
  }
  if (!response.ok || !response.body || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(422, "REVERSE_PROMPT_IMAGE_UNAVAILABLE", "远程图片不可用");
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new ApiError(422, "REVERSE_PROMPT_IMAGE_INVALID", "图片不能超过 10MB");
  }
  return readBounded(response.body, MAX_IMAGE_BYTES, signal);
}

async function sourceImage(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  let image: Buffer;
  let options: ReversePromptOptions;
  if (type.toLowerCase().includes("multipart/form-data")) {
    const raw = await readBounded(request.body, MAX_IMAGE_BYTES + 64_000, request.signal);
    let form: FormData;
    try { form = await new Response(new Uint8Array(raw), { headers: { "content-type": type } }).formData(); }
    catch { throw new ApiError(422, "REVERSE_PROMPT_INPUT_INVALID", "图片上传表单无效，请重新选择图片。"); }
    for (const key of new Set(form.keys())) {
      if (!["image", "additionalRequirements", "language"].includes(key) || form.getAll(key).length !== 1) {
        throw new ApiError(422, "REVERSE_PROMPT_INPUT_INVALID", "图片反推参数无效");
      }
    }
    options = reverseOptionsSchema.parse({
      additionalRequirements: form.get("additionalRequirements") ?? undefined,
      language: form.get("language") ?? undefined,
    });
    const file = form.get("image");
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      throw new ApiError(422, "REVERSE_PROMPT_IMAGE_INVALID", "请选择不超过 10MB 的图片");
    }
    image = Buffer.from(await file.arrayBuffer());
  } else {
    const raw = await readBounded(request.body, 16_000, request.signal);
    const { imageUrl, ...input } = inputSchema.parse(JSON.parse(raw.toString("utf8")));
    options = input;
    image = await downloadImage(imageUrl, request.signal);
  }
  try {
    const metadata = await inspectImage(image);
    return { image, mimeType: metadata.mimeType, options };
  } catch {
    throw new ApiError(422, "REVERSE_PROMPT_IMAGE_INVALID", "图片内容无效或像素尺寸过大，请选择有效的 JPEG、PNG 或 WebP 图片。");
  }
}

const defaultService = new ReversePromptService();

export function createReversePromptHandler(service: ReverseService = defaultService) {
  return async function POST(request: Request) {
    try {
      const session = await requireSession(request);
      const source = await sourceImage(request);
      return dataResponse(await service.reverse(session.user.id, source.image, source.mimeType, request.signal, source.options));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createReversePromptHandler();
