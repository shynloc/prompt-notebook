import { describe, expect, it, vi } from "vitest";

import { hasDraftContent, isRecoverableDraft, type StoredPromptDraft } from "./local-drafts";

const empty = { title: "", prompt: "", negativePrompt: "", sourceUrl: "", sourceTitle: "", tags: [], images: [] };

describe("local prompt drafts", () => {
  it("recognizes meaningful local content", () => {
    expect(hasDraftContent(empty)).toBe(false);
    expect(hasDraftContent({ ...empty, tags: ["电影感"] })).toBe(true);
    expect(hasDraftContent({ ...empty, prompt: "  cinematic scene  " })).toBe(true);
  });

  it("recovers only a fresh draft newer than the server copy", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00Z"));
    const draft: StoredPromptDraft = { ...empty, prompt: "local work", key: "user:new", schemaVersion: 1, updatedAt: Date.now() - 1_000, serverUpdatedAt: null };
    expect(isRecoverableDraft(draft)).toBe(true);
    expect(isRecoverableDraft(draft, "2026-07-19T23:00:00Z")).toBe(true);
    expect(isRecoverableDraft(draft, "2026-07-20T00:00:00Z")).toBe(false);
    expect(isRecoverableDraft({ ...draft, updatedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })).toBe(false);
    vi.useRealTimers();
  });
});
