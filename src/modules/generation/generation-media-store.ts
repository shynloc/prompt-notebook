import { downloadRemoteImage, inspectImage, MAX_GENERATED_IMAGE_BYTES, MAX_IMAGE_BYTES } from "@/modules/media/image-policy";
import { MediaService } from "@/modules/media/media-service";
import { LocalMediaStore, localMediaIdFromObjectKey } from "@/modules/media/local-media-store";
import { ApiError } from "@/lib/api/errors";

export type GenerationAssetRole = "reference" | "result" | "mask";

export interface StoredGenerationAsset {
  storageProvider: "picbed" | "local";
  objectKey: string;
  displayUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface ReadableGenerationAsset extends Omit<StoredGenerationAsset, "storageProvider"> {
  storageProvider: "picbed" | "external" | "local";
}

export interface GenerationMediaStore {
  upload(
    userId: string,
    jobId: string,
    role: GenerationAssetRole,
    ordinal: number,
    data: Buffer,
  ): Promise<StoredGenerationAsset>;
  read(asset: ReadableGenerationAsset, userId?: string): Promise<Buffer>;
}

export class PicbedGenerationMediaStore implements GenerationMediaStore {
  constructor(private readonly media = new MediaService()) {}

  async upload(userId: string, jobId: string, role: GenerationAssetRole, ordinal: number, data: Buffer) {
    return this.media.upload(userId, data, ["generation", jobId, role, String(ordinal)], role === "result" ? MAX_GENERATED_IMAGE_BYTES : MAX_IMAGE_BYTES);
  }

  async read(asset: ReadableGenerationAsset, userId?: string) {
    if (asset.storageProvider === "local") {
      const id = userId ? localMediaIdFromObjectKey(userId, asset.objectKey) : null;
      if (!userId || !id) throw new ApiError(404, "LOCAL_MEDIA_NOT_FOUND", "图片不存在或不可访问");
      const result = await new LocalMediaStore(userId).read(id);
      if (result.metadata.objectKey !== asset.objectKey) throw new ApiError(404, "LOCAL_MEDIA_NOT_FOUND", "图片不存在或不可访问");
      return result.data;
    }
    const data = await downloadRemoteImage(asset.displayUrl, {}, MAX_GENERATED_IMAGE_BYTES);
    await inspectImage(data, MAX_GENERATED_IMAGE_BYTES);
    return data;
  }
}
