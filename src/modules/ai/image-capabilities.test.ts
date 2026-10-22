import { describe, expect, it } from "vitest";

import {
  getImageModelCapabilities,
  validateImageGenerationSettings,
  validateImageModelSize,
} from "./image-capabilities";

const settings = {
  modelId: "gpt-image-2.5-sunburst",
  prompt: "A blue hour city",
  width: 3840,
  height: 2160,
  quality: "max" as const,
  imageCount: 1,
  parameters: {},
};

describe("image model capabilities", () => {
  it.each([
    "gpt-image-2.5-sunburst", "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst-2026-09-08", "gpt-image-2.5-flare-2026-09-08",
  ])("preserves the native 4K contract for %s", (modelId) => {
    const result = validateImageGenerationSettings({ ...settings, modelId });
    expect(result.size).toBe("3840x2160");
    expect(result.quality).toBe("max");
    expect(result.capabilities).toMatchObject({ profileId: "gpt-image-2.5", known: true, transparency: true });
  });

  it("requires an explicit family for vendor aliases instead of guessing prefixes", () => {
    const modelId = "vendor/gpt-image-2.5-flare";
    expect(getImageModelCapabilities(modelId)).toMatchObject({ profileId: "unknown", known: false, supportsCustomSize: false });
    expect(() => validateImageGenerationSettings({ ...settings, modelId })).toThrow(/不支持/);
    expect(validateImageGenerationSettings({ ...settings, modelId, parameters: { imageModelFamily: "gpt-image-2.5" } }).size).toBe("3840x2160");
  });

  it("does not treat arbitrary GPT Image 2 suffixes as verified models", () => {
    expect(getImageModelCapabilities("gpt-image-2-uncertain-variant").known).toBe(false);
    expect(getImageModelCapabilities("gpt-image-2-2026-04-21").profileId).toBe("gpt-image-2");
  });

  it("accepts bounded custom contracts and labels them unverified", () => {
    const result = validateImageGenerationSettings({ ...settings, modelId: "my-image-provider", parameters: { imageModelFamily: "custom" } });
    expect(result.capabilities.known).toBe(false);
    expect(result.size).toBe("3840x2160");
    expect(() => validateImageGenerationSettings({ ...settings, width: 3840, height: 3840 })).toThrow(/8,294,400/);
    expect(() => validateImageGenerationSettings({ ...settings, width: 3841 })).toThrow(/16/);
    expect(() => validateImageGenerationSettings({ ...settings, width: 3840, height: 1024 })).toThrow(/3:1/);
  });

  it("rejects an invalid stored family instead of using accidental capabilities", () => {
    expect(() => getImageModelCapabilities("model", { imageModelFamily: "gpt_image_2_5" })).toThrow(/配置无效/);
  });

  it("rejects unsupported quality rather than silently dropping it", () => {
    expect(() => validateImageGenerationSettings({ ...settings, modelId: "gpt-image-2" })).toThrow(/不支持 max/);
    expect(() => validateImageGenerationSettings({ ...settings, modelId: "gpt-image-1", width: 1024, height: 1024 })).toThrow(/不支持 max/);
  });

  it("rejects legacy dimensions without changing their ratio or resolution", () => {
    const capabilities = getImageModelCapabilities("gpt-image-1");
    expect(() => validateImageModelSize(capabilities, 3840, 2160)).toThrow(/3840x2160/);
    expect(validateImageModelSize(capabilities, 1536, 1024)).toBe("1536x1024");
    expect(validateImageModelSize(getImageModelCapabilities("dall-e-3"), 1792, 1024)).toBe("1792x1024");
  });

  it("uses explicit output options before model defaults and omits compression for PNG", () => {
    const parameters = { output_format: "webp", background: "opaque", output_compression: 85 };
    const result = validateImageGenerationSettings({ ...settings, parameters, outputFormat: "png", background: "transparent" });
    expect(result.providerOptions).toEqual({ output_format: "png", background: "transparent" });
    expect(validateImageGenerationSettings({ ...settings, parameters }).providerOptions).toEqual({ output_format: "webp", background: "opaque", output_compression: 85 });
  });

  it("requires transparency-compatible format and a model that supports it", () => {
    expect(() => validateImageGenerationSettings({ ...settings, background: "transparent" })).toThrow(/PNG 或 WebP/);
    expect(() => validateImageGenerationSettings({ ...settings, quality: "high", modelId: "gpt-image-2", background: "transparent", outputFormat: "png" })).toThrow(/不支持 transparent/);
    expect(validateImageGenerationSettings({ ...settings, background: "transparent", outputFormat: "webp" }).providerOptions.background).toBe("transparent");
  });

  it.each([-1, 101, 42.5, Number.NaN])("rejects invalid compression %s", (outputCompression) => {
    expect(() => validateImageGenerationSettings({ ...settings, outputCompression })).toThrow(/0–100/);
  });

  it("omits unsupported advanced fields for a legacy-compatible provider", () => {
    const result = validateImageGenerationSettings({ ...settings, modelId: "unknown", width: 1024, height: 1024, quality: "auto" });
    expect(result.providerOptions).toEqual({ response_format: "b64_json" });
  });

  it("checks the combined positive and negative prompt, reference and image-count budgets", () => {
    expect(() => validateImageGenerationSettings({ ...settings, prompt: "p".repeat(31_999), negativePrompt: "n" })).toThrow(/32,000/);
    expect(() => validateImageGenerationSettings({ ...settings, referenceImageCount: 5 })).toThrow(/4/);
    expect(() => validateImageGenerationSettings({ ...settings, imageCount: 5 })).toThrow(/4/);
    expect(() => validateImageGenerationSettings({ ...settings, modelId: "dall-e-3", width: 1024, height: 1024, quality: "high", referenceImageCount: 1 })).toThrow(/0/);
    expect(() => validateImageGenerationSettings({ ...settings, modelId: "dall-e-3", width: 1024, height: 1024, quality: "high", imageCount: 2 })).toThrow(/1/);
  });
});
