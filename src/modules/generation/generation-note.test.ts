import { describe, expect, it } from "vitest";

import { generationNoteInput, type GenerationNoteSource } from "./generation-note";

const job: GenerationNoteSource = {
  id: "11111111-1111-4111-8111-111111111111",
  prompt: "A paper observatory under a red moon",
  negativePrompt: null,
  modelName: "Image Model",
  modelId: "gpt-image-2.5-flare",
  modelProfileId: "33333333-3333-4333-8333-333333333333",
  providerType: "openai_compatible",
  width: 1024,
  height: 1024,
  quality: "auto",
  parameters: { outputFormat: "png", background: "transparent" },
  resultMetadata: { usage: { total_tokens: 1200 } },
  assets: [{
    role: "result",
    storageProvider: "picbed",
    objectKey: "prompt-notebook/result.png",
    displayUrl: "https://img.example.com/result.png",
    thumbnailUrl: "https://img.example.com/result.png",
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    sizeBytes: 512,
  }, {
    role: "reference",
    storageProvider: "picbed",
    objectKey: "prompt-notebook/reference.png",
    displayUrl: "https://img.example.com/reference.png",
    thumbnailUrl: "https://img.example.com/reference.png",
    mimeType: "image/png",
    width: 512,
    height: 512,
    sizeBytes: 128,
  }],
  characterProfile: { id: "22222222-2222-4222-8222-222222222222" },
};

describe("generation note input", () => {
  it("records the finished result, not the reference images", () => {
    const input = generationNoteInput(job, { title: "Observatory" });
    expect(input.title).toBe("Observatory");
    expect(input.images).toHaveLength(1);
    expect(input.characterProfiles).toEqual([{ id: job.characterProfile?.id, role: "primary", sortOrder: 0 }]);
    expect(input.parameters).toMatchObject({
      generationJobId: job.id,
      modelId: "gpt-image-2.5-flare",
      providerType: "openai_compatible",
      request: { outputFormat: "png", background: "transparent" },
      result: { usage: { total_tokens: 1200 } },
      actualImages: [{ width: 1024, height: 1024, mimeType: "image/png" }],
    });
  });

  it("drops the character association when asked, and titles from the prompt", () => {
    const input = generationNoteInput(job, { title: "  ", includeCharacter: false });
    expect(input.title).toBe(job.prompt.slice(0, 60));
    expect(input.characterProfiles).toEqual([]);
  });
});
