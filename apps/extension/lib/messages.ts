export interface ImageCandidate {
  url: string;
  alt: string;
  width: number;
  height: number;
  score: number;
}

export interface CaptureDraft {
  idempotencyKey: string;
  title: string;
  prompt: string;
  tags: string[];
  sourceUrl: string;
  sourceTitle: string;
  images: ImageCandidate[];
  selectedImageUrls: string[];
  updatedAt: number;
}

export interface ExtensionTokens {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  device: { id: string; name: string };
}

export interface CaptureResponse {
  note: { id: string; title: string };
  imageWarnings: Array<{ url: string; message: string }>;
  replayed: boolean;
}

export interface RecentCapture { id: string; title: string; savedAt: number; replayed: boolean }

export const STORAGE_KEYS = {
  draft: "promptNotebook.captureDraft",
  tokens: "promptNotebook.extensionTokens",
  recent: "promptNotebook.recentCaptures",
} as const;
