export interface NoteImage {
  id?: string;
  storageProvider: "picbed" | "external";
  objectKey: string;
  displayUrl: string;
  thumbnailUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  width: number;
  height: number;
  sizeBytes: number;
}

export interface NoteTag { id: string; name: string }

export interface NoteCharacterProfile {
  id: string;
  name: string;
  summary: string;
  archivedAt: string | null;
  deletedAt?: string | null;
  role: "primary" | "supporting" | "reference";
  sortOrder: number;
  avatar: {
    id: string;
    thumbnailUrl: string;
    displayUrl: string;
    focusX: number;
    focusY: number;
  } | null;
}

export interface NoteView {
  id: string;
  title: string;
  prompt: string;
  negativePrompt: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  capturedAt?: string | null;
  captureMethod?: "web" | "extension" | "import" | null;
  favorite: boolean;
  archivedAt?: string | null;
  deletedAt?: string | null;
  version: number;
  updatedAt: string;
  tags: NoteTag[];
  images: NoteImage[];
  coverImage: NoteImage | null;
  characterProfiles: NoteCharacterProfile[];
}
