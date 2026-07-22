export interface StoredImage {
  storageProvider: "picbed";
  objectKey: string;
  displayUrl: string;
  thumbnailUrl: string;
}

export interface StorageProvider {
  upload(input: { data: Buffer; filename: string; mimeType: string; path: string }): Promise<StoredImage>;
}
