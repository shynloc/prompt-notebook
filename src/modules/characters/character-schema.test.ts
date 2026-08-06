import { describe, expect, it } from "vitest";

import {
  characterImageInputSchema,
  createCharacterProfileSchema,
  noteCharacterAssociationsSchema,
} from "./character-schema";

const image = {
  storageProvider: "picbed" as const,
  objectKey: "prompt-notebook/character/one.jpg",
  displayUrl: "https://images.example.com/one.jpg",
  thumbnailUrl: "https://images.example.com/one-thumb.jpg",
  mimeType: "image/jpeg" as const,
  width: 1200,
  height: 1600,
  sizeBytes: 1024,
};

describe("character profile validation", () => {
  it("normalizes use cases and accepts one cover and primary reference", () => {
    const parsed = createCharacterProfileSchema.parse({
      name: "Mira",
      roleDefinition: "Editorial fashion model",
      useCases: [" Fashion ", "fashion", "Portrait"],
      images: [{ ...image, isCover: true, isPrimary: true }],
    });
    expect(parsed.useCases).toEqual(["Fashion", "Portrait"]);
    expect(parsed.images[0]).toMatchObject({ viewType: "other", focusX: 50, focusY: 50 });
  });

  it("rejects non-http URLs, unsupported media, duplicates and multiple primary images", () => {
    expect(characterImageInputSchema.safeParse({ ...image, displayUrl: "data:image/png;base64,abc" }).success).toBe(false);
    expect(characterImageInputSchema.safeParse({ ...image, mimeType: "image/gif" }).success).toBe(false);
    const duplicated = createCharacterProfileSchema.safeParse({
      name: "Mira",
      roleDefinition: "Editorial fashion model",
      images: [{ ...image, isPrimary: true }, { ...image, isPrimary: true }],
    });
    expect(duplicated.success).toBe(false);
  });

  it("allows multiple note associations but only one primary character", () => {
    const first = "10000000-0000-4000-8000-000000000001";
    const second = "10000000-0000-4000-8000-000000000002";
    expect(noteCharacterAssociationsSchema.safeParse([
      { id: first, role: "primary", sortOrder: 0 },
      { id: second, role: "supporting", sortOrder: 1 },
    ]).success).toBe(true);
    expect(noteCharacterAssociationsSchema.safeParse([
      { id: first, role: "primary", sortOrder: 0 },
      { id: second, role: "primary", sortOrder: 1 },
    ]).success).toBe(false);
    expect(noteCharacterAssociationsSchema.safeParse([
      { id: first, role: "primary", sortOrder: 0 },
      { id: second, role: "supporting", sortOrder: 0 },
    ]).success).toBe(false);
  });
});
