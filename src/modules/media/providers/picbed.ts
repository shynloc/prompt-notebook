import { randomBytes } from "node:crypto";

import { parseOutboundBaseUrl } from "@/modules/ai/outbound-url-policy";
import { secureOutboundFetch } from "@/modules/ai/secure-outbound-fetch";

import type { StorageProvider, StoredImage } from "../storage-provider";

type PicbedPayload = Record<string, unknown> & { data?: Record<string, unknown> };

const MAX_RESPONSE_BYTES = 256 * 1024;

function values(payload: PicbedPayload): string[] {
  const result: string[] = [];
  for (const key of ["url", "publicUrl", "public_url", "href", "location", "key", "path"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) result.push(value.trim());
  }
  if (payload.data && typeof payload.data === "object") result.push(...values(payload.data));
  return result;
}

async function boundedText(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Image storage returned an oversized response");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Image storage returned an oversized response");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function multipart(input: { data: Buffer; filename: string; mimeType: string; path: string }) {
  const boundary = `----prompt-notebook-${randomBytes(16).toString("hex")}`;
  const filename = input.filename.replace(/["\r\n]/g, "_");
  const path = input.path.replace(/[\r\n]/g, "");
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
  );
  const middle = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\n${path}\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([prefix, input.data, middle]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export class PicbedProvider implements StorageProvider {
  constructor(
    private readonly endpoint: string,
    private readonly token = "",
    private readonly request: typeof secureOutboundFetch = secureOutboundFetch,
  ) {}

  async upload(input: { data: Buffer; filename: string; mimeType: string; path: string }): Promise<StoredImage> {
    if (!this.token.trim()) throw new Error("Image storage is not configured");
    const endpoint = parseOutboundBaseUrl(this.endpoint);
    const form = multipart(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.request(endpoint, {
        method: "POST",
        headers: {
          "content-type": form.contentType,
          "content-length": String(form.body.byteLength),
          "x-auth-token": this.token,
        },
        body: form.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Image storage rejected the upload (${response.status})`);
      }
      let payload: PicbedPayload;
      try {
        payload = JSON.parse(await boundedText(response)) as PicbedPayload;
      } catch (error) {
        if (error instanceof Error && error.message.includes("oversized")) throw error;
        throw new Error("Image storage returned an invalid JSON response");
      }
      const candidate = values(payload).find((value) => /^https?:\/\//i.test(value)) ?? values(payload)[0];
      if (!candidate) throw new Error("Image storage returned an invalid response");
      const displayUrl = parseOutboundBaseUrl(new URL(candidate, `${endpoint.toString().replace(/\/$/, "")}/`).toString());
      const readable = await this.request(displayUrl, { method: "HEAD", signal: controller.signal });
      const headOkay = readable.ok;
      await readable.body?.cancel();
      if (!headOkay) {
        const fallback = await this.request(displayUrl, {
          headers: { range: "bytes=0-0" },
          signal: controller.signal,
        });
        const fallbackOkay = fallback.ok;
        await fallback.body?.cancel();
        if (!fallbackOkay) throw new Error("Image storage returned an inaccessible object");
      }
      return {
        storageProvider: "picbed",
        objectKey: displayUrl.pathname.replace(/^\/+/, ""),
        displayUrl: displayUrl.toString(),
        thumbnailUrl: displayUrl.toString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
