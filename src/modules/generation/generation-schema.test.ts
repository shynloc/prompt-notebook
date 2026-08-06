import { describe, expect, it } from "vitest";

import { createGenerationSchema } from "./generation-schema";

const base = {
  idempotencyKey: "generation-request-1",
  prompt: "A cinematic valley",
  width: 3840,
  height: 2160,
  imageCount: 1,
};

describe("generation request schema", () => {
  it("accepts GPT Image 2 4K dimensions and native quality values", () => {
    expect(createGenerationSchema.parse({ ...base, quality: "auto" })).toMatchObject({
      width: 3840,
      height: 2160,
      quality: "auto",
    });
  });

  it("upgrades the former standard quality value for cached clients", () => {
    expect(createGenerationSchema.parse({ ...base, quality: "standard" }).quality).toBe("medium");
  });

  it("rejects dimensions outside the provider ceiling", () => {
    expect(() => createGenerationSchema.parse({ ...base, width: 4096, quality: "high" })).toThrow();
  });

  it("requires a profile for unique character image selections", () => {
    const imageId = "76deeb7b-a507-4ed2-926d-8be446b61a10";
    expect(() => createGenerationSchema.parse({ ...base, quality: "high", characterImageIds: [imageId] })).toThrow();
    expect(() => createGenerationSchema.parse({
      ...base,
      quality: "high",
      characterProfileId: "0c978c19-4d80-4a96-9f65-cb96686b0f77",
      characterImageIds: [imageId, imageId],
    })).toThrow();
  });
});
