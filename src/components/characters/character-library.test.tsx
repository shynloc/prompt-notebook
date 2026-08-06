import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterLibrary } from "./character-library";
import type { CharacterProfile } from "./types";

const profile: CharacterProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Luna",
  summary: "都市时装角色",
  roleDefinition: "A fashion model",
  useCases: ["时尚"],
  appearance: "",
  promptAnchor: "",
  negativePrompt: "",
  rightsNote: "",
  attributes: {},
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
  images: [],
  coverImage: null,
  primaryImage: null,
  noteCount: 3,
  generationCount: 2,
};

afterEach(() => vi.restoreAllMocks());

describe("CharacterLibrary", () => {
  it("archives a card with pending and success feedback", async () => {
    let finishArchive: (value: Response) => void = () => undefined;
    const pendingArchive = new Promise<Response>((resolve) => { finishArchive = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "PATCH") return pendingArchive;
      return Response.json({ data: [profile], meta: { nextCursor: null } });
    });
    render(<CharacterLibrary />);

    await screen.findByRole("heading", { name: "Luna" });
    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    expect(screen.getByText("正在归档“Luna”…")).toBeVisible();
    expect(screen.getByRole("button", { name: "归档中…" })).toBeDisabled();
    finishArchive(Response.json({ data: { ...profile, archivedAt: "2026-08-06T00:00:00.000Z", version: 2 } }));

    await screen.findByText("AI Model 已归档，不再出现在生图选择器中。");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Luna" })).not.toBeInTheDocument());
  });

  it("permanently deletes a trashed card only after two-step confirmation", async () => {
    let finishDelete: (value: Response) => void = () => undefined;
    const pendingDelete = new Promise<Response>((resolve) => { finishDelete = resolve; });
    const deletedProfile = { ...profile, deletedAt: "2026-08-06T00:00:00.000Z" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "DELETE" && url.includes("mode=permanent")) return pendingDelete;
      if (url.includes("view=trash")) return Response.json({ data: [deletedProfile], meta: { nextCursor: null } });
      return Response.json({ data: [profile], meta: { nextCursor: null } });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("Luna");
    render(<CharacterLibrary />);

    await screen.findByRole("heading", { name: "Luna" });
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    const deleteButton = await screen.findByRole("button", { name: "永久删除" });
    fireEvent.click(deleteButton);

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("外部图床中的原始图片不会自动删除"));
    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining("请输入角色名称“Luna”"), "");
    expect(screen.getByText("正在永久删除“Luna”…外部图床原文件不会自动删除。")).toBeVisible();
    expect(screen.getByRole("button", { name: "永久删除中…" })).toBeDisabled();
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/v1/ai-models/${profile.id}?mode=permanent`,
      expect.objectContaining({ method: "DELETE" }),
    );

    finishDelete(Response.json({ data: null }));
    await screen.findByText("“Luna”已从 Prompt Notebook 永久删除。外部图床原文件未被删除，如需清理请前往图床管理。");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Luna" })).not.toBeInTheDocument());
  });
});
