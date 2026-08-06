import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterAssociationPicker } from "./character-association-picker";

const profile = {
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
  noteCount: 0,
  generationCount: 0,
};

afterEach(() => vi.restoreAllMocks());

describe("CharacterAssociationPicker", () => {
  it("adds the first selected character as the primary relationship", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [profile], meta: { nextCursor: null } }));
    const onChange = vi.fn();
    render(<CharacterAssociationPicker value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "＋ 选择 AI Model" }));
    await screen.findByText("Luna");
    fireEvent.click(screen.getByRole("button", { name: /Luna/ }));

    expect(onChange).toHaveBeenCalledWith([{ id: profile.id, role: "primary", sortOrder: 0 }]);
  });

  it("demotes the previous primary when another relationship becomes primary", async () => {
    const second = { ...profile, id: "22222222-2222-4222-8222-222222222222", name: "Nova" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [profile, second], meta: { nextCursor: null } }));
    const onChange = vi.fn();
    const value = [
      { id: profile.id, role: "primary" as const, sortOrder: 0 },
      { id: second.id, role: "supporting" as const, sortOrder: 1 },
    ];
    render(<CharacterAssociationPicker value={value} onChange={onChange} />);
    await screen.findByText("Nova");
    fireEvent.change(screen.getByLabelText("Nova 的角色关系"), { target: { value: "primary" } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([
      { id: profile.id, role: "supporting", sortOrder: 0 },
      { id: second.id, role: "primary", sortOrder: 1 },
    ]));
  });

  it("keeps hydrated archived and deleted selections even when they are absent from the first API page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [], meta: { nextCursor: null } }));
    const archived = { ...profile, archivedAt: "2026-08-05T00:00:00.000Z" };
    const deleted = {
      ...profile,
      id: "33333333-3333-4333-8333-333333333333",
      name: "Echo",
      deletedAt: "2026-08-06T00:00:00.000Z",
    };

    render(
      <CharacterAssociationPicker
        initialProfiles={[archived, deleted]}
        value={[
          { id: archived.id, role: "primary", sortOrder: 0 },
          { id: deleted.id, role: "reference", sortOrder: 1 },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Luna")).toBeVisible();
    expect(screen.getByText("已归档 · 历史关系仍保留")).toBeVisible();
    expect(screen.getByText("Echo")).toBeVisible();
    expect(screen.getByText("在回收站 · 恢复或移除后再保存")).toBeVisible();
  });

  it("hydrates a selected ID directly when it is missing from the first result page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(`/api/v1/ai-models/${profile.id}`)) return Response.json({ data: profile });
      return Response.json({ data: [], meta: { nextCursor: null } });
    });

    render(
      <CharacterAssociationPicker
        value={[{ id: profile.id, role: "primary", sortOrder: 0 }]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("正在读取 AI Model")).toBeVisible();
    expect(await screen.findByText("Luna")).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/v1/ai-models/${profile.id}?includeDeleted=true`,
      { cache: "no-store" },
    );
  });
});
