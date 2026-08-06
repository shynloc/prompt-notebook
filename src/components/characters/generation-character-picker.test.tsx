import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenerationCharacterPicker } from "./generation-character-picker";
import type { CharacterImage, CharacterProfile } from "./types";

function reference(id: string, primary = false): CharacterImage {
  return {
    id,
    profileId: "11111111-1111-4111-8111-111111111111",
    storageProvider: "picbed",
    objectKey: `${id}.png`,
    displayUrl: `https://img.example.com/${id}.png`,
    thumbnailUrl: `https://img.example.com/${id}.png`,
    mimeType: "image/png",
    width: 800,
    height: 1200,
    sizeBytes: 1200,
    viewType: primary ? "portrait" : "half_body",
    caption: "",
    isCover: primary,
    isPrimary: primary,
    focusX: 50,
    focusY: 50,
    metadata: {},
    sortOrder: primary ? 0 : 1,
    status: "ready",
    deletedAt: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
  };
}

function profile(): CharacterProfile {
  const images = [reference("image-main", true), reference("image-second")];
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Luna",
    summary: "都市时装角色",
    roleDefinition: "A fashion model",
    useCases: ["时尚"],
    appearance: "silver hair",
    promptAnchor: "Luna",
    negativePrompt: "",
    rightsNote: "",
    attributes: {},
    archivedAt: null,
    deletedAt: null,
    version: 1,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    images,
    coverImage: images[0],
    primaryImage: images[0],
    noteCount: 0,
    generationCount: 0,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("GenerationCharacterPicker", () => {
  it("applies images from exactly one AI Model after confirmation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [profile()], meta: { nextCursor: null } }));
    const onChange = vi.fn();
    render(<GenerationCharacterPicker selectedImageIds={[]} maxImages={2} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /从 AI Model 选择/ }));
    await screen.findByRole("dialog", { name: "选择垫图模特" });
    fireEvent.click(screen.getByRole("button", { name: "选择 Luna 主图" }));
    fireEvent.click(screen.getByRole("button", { name: "选择 Luna 参考图 2" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认使用" }));

    expect(onChange).toHaveBeenCalledWith(profile().id, ["image-main", "image-second"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("disables role selection when uploaded references fill every slot", () => {
    render(<GenerationCharacterPicker selectedImageIds={[]} maxImages={0} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /从 AI Model 选择/ })).toBeDisabled();
  });
});
