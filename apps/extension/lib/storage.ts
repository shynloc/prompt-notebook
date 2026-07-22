import { STORAGE_KEYS, type CaptureDraft, type ExtensionTokens, type RecentCapture } from "./messages";

export async function loadDraft() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.draft);
  return (result[STORAGE_KEYS.draft] as CaptureDraft | undefined) ?? null;
}

export function saveDraft(draft: CaptureDraft) {
  return chrome.storage.local.set({ [STORAGE_KEYS.draft]: draft });
}

export function clearDraft() {
  return chrome.storage.local.remove(STORAGE_KEYS.draft);
}

export async function loadTokens() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.tokens);
  return (result[STORAGE_KEYS.tokens] as ExtensionTokens | undefined) ?? null;
}

export function saveTokens(tokens: ExtensionTokens) {
  return chrome.storage.local.set({ [STORAGE_KEYS.tokens]: tokens });
}

export function clearTokens() {
  return chrome.storage.local.remove(STORAGE_KEYS.tokens);
}

export async function loadRecent() { const result = await chrome.storage.local.get(STORAGE_KEYS.recent); return (result[STORAGE_KEYS.recent] as RecentCapture[] | undefined) ?? []; }
export async function addRecent(item: RecentCapture) { const recent = await loadRecent(); await chrome.storage.local.set({ [STORAGE_KEYS.recent]: [item, ...recent.filter((entry) => entry.id !== item.id)].slice(0, 10) }); }
