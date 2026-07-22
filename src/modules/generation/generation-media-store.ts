import { MAX_IMAGE_BYTES, inspectImage } from "@/modules/media/image-policy";
import { MediaService } from "@/modules/media/media-service";
import { secureOutboundFetch } from "@/modules/ai/secure-outbound-fetch";

export type GenerationAssetRole = "reference" | "result";

export interface StoredGenerationAsset {
  storageProvider: "picbed";
  objectKey: string;
  displayUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface GenerationMediaStore {
  upload(
    userId: string,
    jobId: string,
    role: GenerationAssetRole,
    ordinal: number,
    data: Buffer,
  ): Promise<StoredGenerationAsset>;
  read(asset: StoredGenerationAsset): Promise<Buffer>;
}

async function readLimited(response: Response) {
  if (!response.ok || !response.body) throw new Error("Stored generation asset is unavailable");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error("Stored generation asset is too large");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("Stored generation asset is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export class PicbedGenerationMediaStore implements GenerationMediaStore {
  constructor(private readonly media = new MediaService()) {}

  async upload(userId: string, jobId: string, role: GenerationAssetRole, ordinal: number, data: Buffer) {
    return this.media.upload(userId, data, ["generation", jobId, role, String(ordinal)]);
  }

  async read(asset: StoredGenerationAsset) {
    if (asset.storageProvider !== "picbed") throw new Error("Unsupported generation storage provider");
    const response = await secureOutboundFetch(new URL(asset.displayUrl), {
      method: "GET",
      headers: { accept: "image/jpeg,image/png,image/webp" },
      signal: AbortSignal.timeout(20_000),
    });
    const data = await readLimited(response);
    await inspectImage(data);
    return data;
  }
}
