import { downloadRemoteImage, inspectImage } from "@/modules/media/image-policy";
import { MediaService } from "@/modules/media/media-service";

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
    return this.media.upload(userId, data, ["generation", jobId, role, String(ordinal)]);
  }

  async read(asset: StoredGenerationAsset) {
    const data = await downloadRemoteImage(asset.displayUrl);
    await inspectImage(data);
    return data;
  }
}
