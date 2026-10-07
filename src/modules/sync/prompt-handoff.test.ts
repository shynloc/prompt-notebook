import { beforeEach, describe, expect, it, vi } from "vitest";
import { storePromptHandoff, takePromptHandoff } from "./prompt-handoff";

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});
describe("prompt handoffs", () => {
  it("is destination-specific, single-use and keeps content out of the token", () => {
    const id = storePromptHandoff("imagehub", "private prompt", "negative");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(takePromptHandoff(id, "analyze")).toBeNull();
    expect(takePromptHandoff(id, "imagehub")).toMatchObject({
      prompt: "private prompt",
      negativePrompt: "negative",
    });
    expect(takePromptHandoff(id, "imagehub")).toBeNull();
  });
  it("rejects stale and malformed entries and clears them", () => {
    const id = storePromptHandoff("analyze", "private prompt");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_001);
    expect(takePromptHandoff(id, "analyze")).toBeNull();
    expect(sessionStorage.length).toBe(0);
    sessionStorage.setItem(`prompt-notebook:handoff:${id}`, "not json");
    expect(takePromptHandoff(id, "analyze")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
  it("bounds inputs and clears abandoned transfers without touching other drafts", () => {
    sessionStorage.setItem("draft", "preserve me");
    const old = storePromptHandoff("analyze", "old prompt");
    const current = storePromptHandoff("imagehub", "new prompt");
    expect(takePromptHandoff(old, "analyze")).toBeNull();
    expect(takePromptHandoff(current, "imagehub")?.prompt).toBe("new prompt");
    expect(sessionStorage.getItem("draft")).toBe("preserve me");
    expect(() => storePromptHandoff("imagehub", "x".repeat(50_001))).toThrow();
    expect(() =>
      storePromptHandoff("imagehub", "ok", "x".repeat(8_001)),
    ).toThrow();
  });
});
