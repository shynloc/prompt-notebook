import { refreshAccessToken, validTokens } from "./auth";
import { getAppUrl } from "./settings";
import { loadTokens } from "./storage";
import type { CaptureDraft, CaptureResponse } from "./messages";

async function apiRequest(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const tokens = await validTokens();
  const appUrl = await getAppUrl();
  if (!tokens) throw new Error("请先连接提示词笔记本账户");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${tokens.accessToken}`);
  const response = await fetch(`${appUrl}${path}`, { ...init, headers });
  if (response.status === 401 && retry) {
    const current = await loadTokens();
    if (!current) return response;
    await refreshAccessToken(current);
    return apiRequest(path, init, false);
  }
  return response;
}

export async function fetchTags() {
  const response = await apiRequest("/api/v1/extension/tags");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "无法读取标签");
  return body.data as Array<{ id: string; name: string; count: number }>;
}

export async function saveCapture(draft: CaptureDraft) {
  const response = await apiRequest("/api/v1/extension/captures", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": draft.idempotencyKey },
    body: JSON.stringify({
      title: draft.title,
      prompt: draft.prompt,
      tags: draft.tags,
      sourceUrl: draft.sourceUrl,
      sourceTitle: draft.sourceTitle || null,
      imageUrls: draft.selectedImageUrls,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "提示词保存失败");
  return body.data as CaptureResponse;
}
