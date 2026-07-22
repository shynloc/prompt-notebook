import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 20_000;

const signatures = [
  { mime: "image/jpeg", matches: (data: Buffer) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  { mime: "image/png", matches: (data: Buffer) => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: "image/webp", matches: (data: Buffer) => data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP" },
] as const;

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

function isPrivateAddress(address: string) {
  const normalized = address.toLocaleLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (normalized.includes(":")) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") ||
      normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff");
  }
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19);
}

export async function assertSafeRemoteUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("只支持 HTTP 或 HTTPS 链接");
  if (url.username || url.password || url.port) throw new Error("链接不能包含凭据或自定义端口");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("不能导入内网地址");
  return url;
}

async function readLimitedBody(response: Response, limit: number, errorMessage: string) {
  if (!response.body) throw new Error("远程服务器没有返回内容");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw new Error(errorMessage);
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
  options: { accept: string; maxBytes: number; htmlMaxBytes?: number; userAgent?: string },
) {
  let url = await assertSafeRemoteUrl(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        headers: {
          accept: options.accept,
          "user-agent": options.userAgent ?? "PromptNotebookImageBot/1.0",
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("远程网页响应超时");
      throw new Error("无法连接远程网页");
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("远程地址重定向无效");
      url = await assertSafeRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`远程服务器拒绝访问 (${response.status})`);
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
    const html = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
    const limit = html && options.htmlMaxBytes ? options.htmlMaxBytes : options.maxBytes;
    const data = await readLimitedBody(response, limit, html ? "网页内容过大，无法安全解析" : "图片不能超过 10MB");
    return { data, contentType, finalUrl: url.toString() };
  }
  throw new Error("远程地址重定向次数过多");
}

export async function downloadRemoteImage(value: string) {
  return (await fetchRemoteResource(value, {
    accept: "image/jpeg,image/png,image/webp",
    maxBytes: MAX_IMAGE_BYTES,
  })).data;
}
