import { createHash, randomUUID } from "node:crypto";

import { inspectImage } from "./image-policy";
import { MediaStorageConfigurationService } from "./media-storage-configuration-service";
import type { StorageProvider } from "./storage-provider";
import { resolveWebImage } from "./web-image-resolver";

function extension(mimeType: string) {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}

export class MediaService {
  constructor(
    private readonly provider?: StorageProvider,
    private readonly settings = new MediaStorageConfigurationService(),
  ) {}

  async upload(userId: string, data: Buffer, pathSegments: string[] = []) {
    const metadata = await inspectImage(data);
    const filename = `${randomUUID()}.${extension(metadata.mimeType)}`;
    const owner = createHash("sha256").update(userId).digest("hex").slice(0, 16);
    const safeSegments = pathSegments.map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)).filter(Boolean);
    const provider = this.provider ?? await this.settings.providerFor(userId);
    const stored = await provider.upload({
      data,
      filename,
      mimeType: metadata.mimeType,
      path: ["prompt-notebook", owner, ...safeSegments, filename].join("/"),
    });
    return { ...stored, ...metadata };
  }

  async importUrl(userId: string, url: string) {
    return this.upload(userId, await resolveWebImage(url));
  }
}
