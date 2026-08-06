import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NoteLightbox } from "./note-lightbox";
import type { NoteView } from "./types";

vi.mock("./history-panel", () => ({ HistoryPanel: () => null }));
vi.mock("@/components/sharing/share-manager", () => ({ ShareManager: () => null }));

const images = ["first", "second", "third"].map((name, index) => ({
  id: `00000000-0000-0000-0000-00000000000${index + 1}`,
  storageProvider: "external" as const,
  objectKey: name,
  displayUrl: `https://images.example.com/${name}.jpg`,
  thumbnailUrl: `https://images.example.com/${name}-thumb.jpg`,
  mimeType: "image/jpeg" as const,
  width: 941,
  height: 1672,
  sizeBytes: 1024,
}));

const note: NoteView = {
  id: "10000000-0000-0000-0000-000000000001",
  title: "多图提示词",
  prompt: "Prompt body",
  negativePrompt: null,
  favorite: false,
  version: 1,
  updatedAt: "2026-08-06T00:00:00.000Z",
  tags: [],
  images,
  coverImage: images[0],
};

describe("NoteLightbox image navigation", () => {
  it("replaces the rendered image when moving forward and backward", () => {
    render(
      <NoteLightbox
        note={note}
        view="active"
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    const firstImage = screen.getByRole("img", { name: "多图提示词" });
    expect(firstImage).toHaveAttribute("src", images[0].displayUrl);
    expect(screen.getByText("1 / 3")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "下一张" }));

    const secondImage = screen.getByRole("img", { name: "多图提示词" });
    expect(secondImage).toHaveAttribute("src", images[1].displayUrl);
    expect(secondImage).not.toBe(firstImage);
    expect(screen.getByText("2 / 3")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "上一张" }));
    expect(screen.getByRole("img", { name: "多图提示词" })).toHaveAttribute(
      "src",
      images[0].displayUrl,
    );

    fireEvent.click(screen.getByRole("button", { name: "上一张" }));
    expect(screen.getByRole("img", { name: "多图提示词" })).toHaveAttribute(
      "src",
      images[2].displayUrl,
    );
    expect(screen.getByText("3 / 3")).toBeVisible();
  });
});
