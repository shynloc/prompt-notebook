import {
  downloadRemoteImage,
  fetchRemoteResource,
  inspectImage,
  MAX_IMAGE_BYTES,
  type RemoteResourceDependencies,
} from "./image-policy";

export const MAX_HTML_BYTES = 1024 * 1024;
const MAX_CANDIDATES = 8;
const IMAGE_META_KEYS = new Set(["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"]);

function decodeHtmlEntities(value: string) {
  const character = (encoded: string, radix: number) => {
    const point = Number.parseInt(encoded, radix);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  };
  return value
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => character(hex, 16))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => character(decimal, 10));
}

function attributes(tag: string) {
  const result = new Map<string, string>();
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) result.set(match[1].toLocaleLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}

function addCandidate(result: string[], value: string | undefined, baseUrl: string) {
  if (!value) return;
  try {
    const resolved = new URL(decodeHtmlEntities(value.trim()), baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) return;
    const normalized = resolved.toString();
    if (!result.includes(normalized)) result.push(normalized);
  } catch {
    // Ignore malformed page metadata and keep looking for another candidate.
  }
}

export function extractPageImageCandidates(html: string, baseUrl: string) {
  const result: string[] = [];
  for (const match of html.matchAll(/<(?:meta|link)\b[^>]{0,4096}>/gi)) {
    const values = attributes(match[0]);
    const key = (values.get("property") ?? values.get("name") ?? "").toLocaleLowerCase();
    if (IMAGE_META_KEYS.has(key)) addCandidate(result, values.get("content"), baseUrl);
    const rel = values.get("rel")?.toLocaleLowerCase().split(/\s+/) ?? [];
    if (rel.includes("image_src")) addCandidate(result, values.get("href"), baseUrl);
    if (result.length >= MAX_CANDIDATES) break;
  }

  const hostname = new URL(baseUrl).hostname.toLocaleLowerCase();
  if ((hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com")) && result.length < MAX_CANDIDATES) {
    for (const match of html.matchAll(/https:\/\/pbs\.twimg\.com\/media\/[^"'\\<>\s]+/gi)) {
      addCandidate(result, match[0], baseUrl);
      if (result.length >= MAX_CANDIDATES) break;
    }
  }
  return result.slice(0, MAX_CANDIDATES);
}

function pageUserAgent(value: string) {
  const hostname = new URL(value).hostname.toLocaleLowerCase();
  return hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com")
    ? "Twitterbot/1.0"
    : "Mozilla/5.0 (compatible; PromptNotebookImageBot/1.0)";
}

async function validImage(data: Buffer) {
  try {
    await inspectImage(data);
    return true;
  } catch {
    return false;
  }
}

export async function resolveWebImage(
  value: string,
  dependencies: RemoteResourceDependencies = {},
) {
  const resource = await fetchRemoteResource(value, {
    accept: "image/jpeg,image/png,image/webp,text/html,application/xhtml+xml",
    maxBytes: MAX_IMAGE_BYTES,
    htmlMaxBytes: MAX_HTML_BYTES,
    userAgent: pageUserAgent(value),
    ...dependencies,
  });
  if (await validImage(resource.data)) return resource.data;

  const looksLikeHtml = resource.contentType.includes("html") || /^\s*(?:<!doctype\s+html|<html|<head|<meta)/i.test(resource.data.subarray(0, 512).toString("utf8"));
  if (!looksLikeHtml) throw new Error("该链接不是有效的 JPEG、PNG 或 WebP 图片");

  const candidates = extractPageImageCandidates(resource.data.toString("utf8"), resource.finalUrl);
  if (!candidates.length) throw new Error("这个网页没有提供可导入的预览图片，请改用图片直链");

  for (const candidate of candidates) {
    try {
      const data = await downloadRemoteImage(candidate, dependencies);
      if (await validImage(data)) return data;
    } catch {
      // Candidate URLs are untrusted. Continue to the next declared preview.
    }
  }
  throw new Error("找到了网页预览图，但无法下载有效的 JPEG、PNG 或 WebP 图片");
}
