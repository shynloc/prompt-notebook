import sharp from "sharp";

import {
  resolveRemoteResourceTarget,
  secureRemoteResourceFetch,
} from "@/modules/ai/secure-outbound-fetch";
import type { AddressResolver } from "@/modules/ai/outbound-url-policy";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 20_000;

const signatures = [
  { mime: "image/jpeg", matches: (data: Buffer) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  { mime: "image/png", matches: (data: Buffer) => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: "image/webp", matches: (data: Buffer) => data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP" },
] as const;

export interface RemoteResourceDependencies {
  resolver?: AddressResolver;
  request?: typeof secureRemoteResourceFetch;
}

export async function inspectImage(data: Buffer) {
  if (!data.length) throw new Error("图片内容为空");
  if (data.length > MAX_IMAGE_BYTES) throw new Error("图片不能超过 10MB");
  const signature = signatures.find((entry) => entry.matches(data));
  if (!signature) throw new Error("只支持 JPEG、PNG 和 WebP 图片");
  const metadata = await sharp(data, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("无法读取图片尺寸");
  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new Error("图片像素尺寸过大");
  return { mimeType: signature.mime, width: metadata.width, height: metadata.height, sizeBytes: data.length };
}

function safeRemoteUrlError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("HTTP or HTTPS")) return new Error("只支持 HTTP 或 HTTPS 链接");
  if (message.includes("credentials") || message.includes("custom port")) {
    return new Error("链接不能包含凭据或自定义端口");
  }
  if (message.includes("private or reserved") || message.includes("local hostname")) {
    return new Error("不能导入内网或保留地址");
  }
  if (message.includes("did not resolve")) return new Error("远程图片域名无法解析");
  return new Error("图片链接无效");
}

export async function assertSafeRemoteUrl(value: string, resolver?: AddressResolver) {
  try {
    return (await resolveRemoteResourceTarget(value, resolver)).url;
  } catch (error) {
    throw safeRemoteUrlError(error);
  }
}

async function readLimitedBody(response: Response, limit: number, errorMessage: string) {
  if (!response.body) throw new Error("远程服务器没有返回内容");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    await response.body.cancel();
    throw new Error(errorMessage);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error(errorMessage);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export async function fetchRemoteResource(
  value: string,
  options: {
    accept: string;
    maxBytes: number;
    htmlMaxBytes?: number;
    userAgent?: string;
  } & RemoteResourceDependencies,
) {
  let url = await assertSafeRemoteUrl(value, options.resolver);
  const request = options.request ?? secureRemoteResourceFetch;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await request(url, {
        headers: {
          accept: options.accept,
          "user-agent": options.userAgent ?? "PromptNotebookImageBot/1.0",
        },
        signal: controller.signal,
      }, { resolver: options.resolver });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("远程网页响应超时");
      if (error instanceof Error && (
        error.message.includes("private or reserved") ||
        error.message.includes("local hostname") ||
        error.message.includes("did not resolve")
      )) throw safeRemoteUrlError(error);
      throw new Error("无法连接远程网页");
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("远程地址重定向无效");
      url = await assertSafeRemoteUrl(new URL(location, url).toString(), options.resolver);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`远程服务器拒绝访问 (${response.status})`);
    }
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
    const html = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
    const limit = html && options.htmlMaxBytes ? options.htmlMaxBytes : options.maxBytes;
    const data = await readLimitedBody(response, limit, html ? "网页内容过大，无法安全解析" : "图片不能超过 10MB");
    return { data, contentType, finalUrl: url.toString() };
  }
  throw new Error("远程地址重定向次数过多");
}

export async function downloadRemoteImage(value: string, dependencies: RemoteResourceDependencies = {}) {
  return (await fetchRemoteResource(value, {
    accept: "image/jpeg,image/png,image/webp",
    maxBytes: MAX_IMAGE_BYTES,
    ...dependencies,
  })).data;
}
