import type { CreateNoteInput } from "@/modules/notes/note-schema";

type GenerationNoteAsset = {
  role: string;
  storageProvider: string;
  objectKey: string;
  displayUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
};

export type GenerationNoteSource = {
  id: string;
  prompt: string;
  negativePrompt: string | null;
  modelName: string;
  modelId: string;
  modelProfileId: string | null;
  providerType: string;
  width: number;
  height: number;
  quality: string;
  parameters: Record<string, unknown>;
  resultMetadata: Record<string, unknown> | null;
  assets: GenerationNoteAsset[];
  characterProfile: { id: string } | null;
};

export function generationNoteInput(
  job: GenerationNoteSource,
  options: { title?: string; includeCharacter?: boolean } = {},
): CreateNoteInput {
  const images = job.assets.filter((asset) => asset.role === "result").map((asset) => ({
    storageProvider: asset.storageProvider as CreateNoteInput["images"][number]["storageProvider"],
    objectKey: asset.objectKey,
    displayUrl: asset.displayUrl,
    thumbnailUrl: asset.thumbnailUrl,
    mimeType: asset.mimeType as CreateNoteInput["images"][number]["mimeType"],
    width: asset.width,
    height: asset.height,
    sizeBytes: asset.sizeBytes,
  }));
  return {
    title: options.title?.trim() || job.prompt.slice(0, 60),
    prompt: job.prompt,
    negativePrompt: job.negativePrompt,
    model: job.modelName,
    tags: ["AI 生成"],
    images,
    characterProfiles: options.includeCharacter === false || !job.characterProfile
      ? []
      : [{ id: job.characterProfile.id, role: "primary" as const, sortOrder: 0 }],
    parameters: {
      generationJobId: job.id,
      width: job.width,
      height: job.height,
      quality: job.quality,
      modelId: job.modelId,
      ...(job.modelProfileId ? { modelProfileId: job.modelProfileId } : {}),
      providerType: job.providerType,
      request: job.parameters,
      ...(job.resultMetadata ? { result: job.resultMetadata } : {}),
      actualImages: images.map((image) => ({ width: image.width, height: image.height, mimeType: image.mimeType })),
    },
  };
}
