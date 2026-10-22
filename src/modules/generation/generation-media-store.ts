import { downloadRemoteImage, inspectImage, MAX_GENERATED_IMAGE_BYTES, MAX_IMAGE_BYTES } from "@/modules/media/image-policy";
import { MediaService } from "@/modules/media/media-service";

export type GenerationAssetRole = "reference" | "result" | "mask";

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

export interface ReadableGenerationAsset extends Omit<StoredGenerationAsset, "storageProvider"> {
  storageProvider: "picbed" | "external";
}

export interface GenerationMediaStore {
  upload(
    userId: string,
    jobId: string,
    role: GenerationAssetRole,
    ordinal: number,
    data: Buffer,
  ): Promise<StoredGenerationAsset>;
  read(asset: ReadableGenerationAsset): Promise<Buffer>;
}

export class PicbedGenerationMediaStore implements GenerationMediaStore {
  constructor(private readonly media = new MediaService()) {}

  async upload(userId: string, jobId: string, role: GenerationAssetRole, ordinal: number, data: Buffer) {
    return this.media.upload(userId, data, ["generation", jobId, role, String(ordinal)], role === "result" ? MAX_GENERATED_IMAGE_BYTES : MAX_IMAGE_BYTES);
  }

  async read(asset: StoredGenerationAsset) {
    const data = await downloadRemoteImage(asset.displayUrl, {}, MAX_GENERATED_IMAGE_BYTES);
    await inspectImage(data, MAX_GENERATED_IMAGE_BYTES);
    return data;
  }
}
