import type { AiProviderType } from "@/modules/ai/types";

export const REFERENCE_IMAGE_IDENTITY_STRATEGY = "reference_image_v1";

export interface CharacterIdentityAdapterInput {
  userId: string;
  profileId: string;
  profileVersion: number;
  imageIds: string[];
  prompt: string;
  negativePrompt: string | null;
  providerType: AiProviderType;
  modelId: string;
}

export interface CharacterIdentityAdapterResult {
  prompt?: string;
  negativePrompt?: string | null;
  referenceImages?: Buffer[];
  providerParameters?: Record<string, string | number | boolean>;
}

/**
 * Extension boundary for a future identity engine (for example LoRA, FaceID or
 * a provider-native character token). The current release deliberately uses
 * ordinary snapshotted reference images and does not register an adapter.
 */
export interface CharacterIdentityAdapter {
  readonly id: string;
  supports(input: Pick<CharacterIdentityAdapterInput, "providerType" | "modelId">): boolean;
  prepare(input: CharacterIdentityAdapterInput): Promise<CharacterIdentityAdapterResult>;
}
