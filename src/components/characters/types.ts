import type { NoteImage } from "@/components/notes/types";

export const CHARACTER_VIEW_OPTIONS = [
  { id: "portrait", label: "正脸" },
  { id: "half_body", label: "半身" },
  { id: "full_body", label: "全身" },
  { id: "left", label: "左侧" },
  { id: "right", label: "右侧" },
  { id: "back", label: "背面" },
  { id: "expression", label: "表情" },
  { id: "outfit", label: "服装" },
  { id: "other", label: "其他" },
] as const;

export type CharacterViewType = (typeof CHARACTER_VIEW_OPTIONS)[number]["id"];

export interface CharacterImageDraft extends Omit<NoteImage, "mimeType"> {
  id?: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  viewType: CharacterViewType;
  caption: string;
  isCover: boolean;
  isPrimary: boolean;
  focusX: number;
  focusY: number;
  metadata: Record<string, string | number | boolean>;
}

export interface CharacterImage extends CharacterImageDraft {
  id: string;
  profileId: string;
  sortOrder: number;
  status: "ready" | "failed";
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  summary: string;
  roleDefinition: string;
  useCases: string[];
  appearance: string;
  promptAnchor: string;
  negativePrompt: string;
  rightsNote: string;
  attributes: Record<string, string | number | boolean | string[]>;
  archivedAt: string | null;
  deletedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  images: CharacterImage[];
  coverImage: CharacterImage | null;
  primaryImage: CharacterImage | null;
  noteCount: number;
  generationCount: number;
}

export type CharacterLibraryView = "active" | "archived" | "trash";

export function characterApiMessage(body: unknown, fallback: string) {
  if (typeof body !== "object" || body === null || !("error" in body)) return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || !("message" in error)) return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : fallback;
}

export function imageInput(image: CharacterImageDraft) {
  return {
    ...(image.id ? { id: image.id } : {}),
    storageProvider: image.storageProvider,
    objectKey: image.objectKey,
    displayUrl: image.displayUrl,
    thumbnailUrl: image.thumbnailUrl,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    sizeBytes: image.sizeBytes,
    viewType: image.viewType,
    caption: image.caption,
    isCover: image.isCover,
    isPrimary: image.isPrimary,
    focusX: image.focusX,
    focusY: image.focusY,
    metadata: image.metadata,
  };
}

export function mediaToCharacterImage(image: NoteImage): CharacterImageDraft | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)) return null;
  const { id: _sourceRecordId, ...media } = image;
  void _sourceRecordId;
  return {
    ...media,
    mimeType: image.mimeType as CharacterImageDraft["mimeType"],
    viewType: "other",
    caption: "",
    isCover: false,
    isPrimary: false,
    focusX: 50,
    focusY: 50,
    metadata: {},
  };
}
