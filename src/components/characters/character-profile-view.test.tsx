import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterProfileView } from "./character-profile-view";
import type { CharacterProfile } from "./types";

const deletedProfile: CharacterProfile = {
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
  deletedAt: "2026-08-06T00:00:00.000Z",
  version: 2,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
  images: [],
  coverImage: null,
  primaryImage: null,
  noteCount: 3,
  generationCount: 2,
};

afterEach(() => vi.restoreAllMocks());

describe("CharacterProfileView", () => {
  it("shows permanent deletion progress and the external image-host warning", async () => {
    let finishDelete: (value: Response) => void = () => undefined;
    const pendingDelete = new Promise<Response>((resolve) => { finishDelete = resolve; });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pendingDelete);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("Luna");
    render(<CharacterProfileView initial={deletedProfile} />);

    expect(screen.getByText("永久删除只会清除笔记本内的角色数据；外部图床原文件不会自动删除。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    expect(screen.getByRole("button", { name: "永久删除中…" })).toBeDisabled();
    expect(screen.getByText("正在永久删除“Luna”…外部图床原文件不会自动删除。")).toBeVisible();

    finishDelete(Response.json({ data: null }));
    expect(await screen.findByText("“Luna”已从 Prompt Notebook 永久删除")).toBeVisible();
    expect(screen.getByText("外部图床中的原始图片没有自动删除；如需清理，请前往图床服务管理。")).toBeVisible();
  });
});
