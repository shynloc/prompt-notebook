import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const draft = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  title: "Neon city prompt",
  prompt: "cinematic neon city",
  tags: ["cinematic"],
  sourceUrl: "https://example.com/post/1",
  sourceTitle: "Example post",
  images: [{ url: "https://images.example/cover.jpg", alt: "cover", width: 1200, height: 800, score: 90 }],
  selectedImageUrls: ["https://images.example/cover.jpg"],
  updatedAt: 1,
};

const mocks = vi.hoisted(() => ({
  loadDraft: vi.fn(), loadTokens: vi.fn(), saveDraft: vi.fn(), clearDraft: vi.fn(), clearTokens: vi.fn(), loadRecent: vi.fn(), addRecent: vi.fn(), getAppUrl: vi.fn(), saveAppUrl: vi.fn(),
  connect: vi.fn(), disconnect: vi.fn(), validTokens: vi.fn(), fetchTags: vi.fn(), saveCapture: vi.fn(),
}));

vi.mock("../../lib/storage", () => ({ loadDraft: mocks.loadDraft, loadTokens: mocks.loadTokens, saveDraft: mocks.saveDraft, clearDraft: mocks.clearDraft, clearTokens: mocks.clearTokens, loadRecent: mocks.loadRecent, addRecent: mocks.addRecent }));
vi.mock("../../lib/auth", () => ({ APP_URL: "", connect: mocks.connect, disconnect: mocks.disconnect, validTokens: mocks.validTokens }));
vi.mock("../../lib/api", () => ({ fetchTags: mocks.fetchTags, saveCapture: mocks.saveCapture }));
vi.mock("../../lib/settings", () => ({ getAppUrl: mocks.getAppUrl, saveAppUrl: mocks.saveAppUrl }));

import { App } from "./App";

describe("capture side panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(globalThis, { chrome: {
      storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
      runtime: { sendMessage: vi.fn() },
      tabs: { create: vi.fn() },
    } });
    mocks.loadDraft.mockResolvedValue(draft);
    mocks.loadTokens.mockResolvedValue({ accessToken: "token" });
    mocks.loadRecent.mockResolvedValue([]);
    mocks.addRecent.mockResolvedValue(undefined);
    mocks.getAppUrl.mockResolvedValue("https://prompts.example.com");
    mocks.validTokens.mockResolvedValue({ accessToken: "token" });
    mocks.fetchTags.mockResolvedValue([{ id: "1", name: "portrait", count: 2 }]);
    mocks.saveCapture.mockResolvedValue({ note: { id: "note-1", title: draft.title }, imageWarnings: [], replayed: false });
  });

  it("edits and saves the extracted prompt with selected artwork", async () => {
    render(<App />);
    expect(await screen.findByDisplayValue("Neon city prompt")).toBeVisible();
    fireEvent.change(screen.getByDisplayValue("Neon city prompt"), { target: { value: "Edited prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到笔记本" }));
    await waitFor(() => expect(mocks.saveCapture).toHaveBeenCalledWith(expect.objectContaining({
      title: "Edited prompt",
      selectedImageUrls: ["https://images.example/cover.jpg"],
    })));
    expect(await screen.findByText("提示词已保存到云端笔记本。")).toBeVisible();
    expect(screen.getByRole("button", { name: "打开笔记" })).toBeVisible();
  });

  it("offers account pairing when the extension has no token", async () => {
    mocks.loadTokens.mockResolvedValue(null);
    mocks.connect.mockResolvedValue({ accessToken: "new-token" });
    render(<App />);
    const button = await screen.findByRole("button", { name: "连接 Prompt Notebook" });
    fireEvent.click(button);
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
    expect(await screen.findByRole("heading", { name: "收藏提示词" })).toBeVisible();
  });
});
