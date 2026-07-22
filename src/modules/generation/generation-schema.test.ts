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
});
