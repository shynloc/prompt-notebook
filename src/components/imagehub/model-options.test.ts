import { describe, expect, it } from "vitest";

import { generationUsage, imageModelOptions } from "./model-options";

describe("ImageHub model options", () => {
  it("only offers enabled image models and excludes arbitrary parameter objects", () => {
    const base = { id: "connection", enabled: true, modelProfileId: "image", modelId: "gpt-image-2.5-flare", displayName: "Flare", name: "Studio", capabilities: ["image_generation"], modelEnabled: true };
    expect(imageModelOptions([
      { ...base, defaultParameters: { output_format: "webp", config: { secret: "never serialized" } } },
      { ...base, modelProfileId: "disabled", enabled: false },
      { ...base, modelProfileId: "writer", capabilities: ["prompt_optimization"] },
      { ...base, modelProfileId: "disabled-model", modelEnabled: false },
    ])).toEqual([{ modelProfileId: "image", modelId: base.modelId, name: "Studio · Flare", defaultParameters: { output_format: "webp" } }]);
  });

  it("uses provider-reported token usage and ignores malformed counts", () => {
    expect(generationUsage({ usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } })).toBe("用量 30 tokens（输入 10 / 输出 20）");
    expect(generationUsage({ usage: { total_tokens: -20 } })).toBeNull();
    expect(generationUsage(undefined)).toBeNull();
  });
});
