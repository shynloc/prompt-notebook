import type { NoteImage } from "@/components/notes/types";

const DATABASE_NAME = "prompt-notebook-local";
const DATABASE_VERSION = 1;
const DRAFT_STORE = "prompt-drafts";
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface PromptDraftPayload {
  title: string;
  prompt: string;
  negativePrompt: string;
  sourceUrl: string;
  sourceTitle: string;
  tags: string[];
  images: NoteImage[];
}

export interface StoredPromptDraft extends PromptDraftPayload {
  key: string;
  schemaVersion: 1;
  updatedAt: number;
  serverUpdatedAt: string | null;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DRAFT_STORE)) {
        request.result.createObjectStore(DRAFT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地草稿数据库"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(DRAFT_STORE, mode);
      const request = operation(transaction.objectStore(DRAFT_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("本地草稿操作失败"));
    });
  } finally {
    database.close();
  }
}

export function hasDraftContent(draft: PromptDraftPayload) {
  return Boolean(
    draft.title.trim()
    || draft.prompt.trim()
    || draft.negativePrompt.trim()
    || draft.sourceUrl.trim()
    || draft.sourceTitle.trim()
    || draft.tags.length
    || draft.images.length,
  );
}

export function isRecoverableDraft(draft: StoredPromptDraft, serverUpdatedAt?: string) {
  if (Date.now() - draft.updatedAt > MAX_DRAFT_AGE_MS) return false;
  if (!hasDraftContent(draft)) return false;
  if (!serverUpdatedAt) return true;
  return draft.updatedAt > Date.parse(serverUpdatedAt);
}

export async function readPromptDraft(key: string) {
  return withStore<StoredPromptDraft | undefined>("readonly", (store) => store.get(key));
}

export async function writePromptDraft(key: string, payload: PromptDraftPayload, serverUpdatedAt?: string) {
  const draft: StoredPromptDraft = {
    ...payload,
    key,
    schemaVersion: 1,
    updatedAt: Date.now(),
    serverUpdatedAt: serverUpdatedAt ?? null,
  };
  await withStore("readwrite", (store) => store.put(draft));
  return draft;
}

export async function removePromptDraft(key: string) {
  await withStore("readwrite", (store) => store.delete(key));
}
