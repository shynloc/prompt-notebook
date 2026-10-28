export interface GenerationAsset {
  id: string;
  jobId: string;
  role: "reference" | "result" | "mask";
  storageProvider: "local" | "picbed";
  objectKey: string;
  displayUrl: string;
  thumbnailUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  sizeBytes: number;
  ordinal: number;
}

export type GenerationStatus = "preparing" | "queued" | "running" | "cancel_requested" | "cancelled" | "succeeded" | "failed";

export interface GenerationJob {
  id: string;
  status: GenerationStatus;
  prompt: string;
  negativePrompt: string | null;
  modelName: string;
  width: number;
  height: number;
  quality: "auto" | "low" | "medium" | "high" | "xhigh" | "max";
  modelProfileId?: string | null;
  modelId?: string;
  providerType?: string;
  parameters?: Record<string, unknown>;
  resultMetadata?: Record<string, unknown>;
  imageCount: number;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  assets: GenerationAsset[];
  characterProfile?: {
    id: string;
    name: string;
    version: number;
    imageIds: string[];
    available: boolean;
  } | null;
}

export const activeStatuses: GenerationStatus[] = ["preparing", "queued", "running", "cancel_requested"];
