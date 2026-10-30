import { describe, expect, it } from "vitest";

import { validateImageProviderContract } from "./image-provider-contract";

const input = { baseUrl: "https://api.openai.com/v1", modelId: "gpt-image-2", parameters: {} };

describe("image provider contract preflight", () => {
  it.each(["https://api.openai.com/v1", "https://API.OPENAI.COM.:443/v1/"])("normalizes the exact official hostname (%s)", (baseUrl) => {
    expect(() => validateImageProviderContract({ ...input, baseUrl })).not.toThrow();
    expect(() => validateImageProviderContract({ ...input, baseUrl, modelId: "gpt-6.1-terra" })).toThrow(/OpenAI.*图片模型/);
  });

  it.each(["gpt-6.1-terra", "future-image-model", "gpt-image-2.5"])("rejects automatic guessing for official Model ID %s", (modelId) => {
    expect(() => validateImageProviderContract({ ...input, modelId, parameters: { imageModelFamily: "auto" } }))
      .toThrow(/文字模型不能直接用于图片生成/);
  });

  it.each(["gpt-image-2", "gpt-image-2.5", "custom"])("allows an explicit, caller-verified future contract (%s)", (imageModelFamily) => {
    expect(() => validateImageProviderContract({ ...input, modelId: "future-image-model", parameters: { imageModelFamily } })).not.toThrow();
  });

  it.each(["gpt-image-2", "chatgpt-image-latest", "unknown"])("rejects an official DALL-E declaration even when the Model ID differs (%s)", (modelId) => {
    expect(() => validateImageProviderContract({ ...input, modelId, parameters: { imageModelFamily: "dall-e-3" } }))
      .toThrow(/OpenAI.*DALL/);
  });

  it.each(["https://api.example.com/v1", "https://api.openai.com.example.com/v1"])("does not classify a third-party hostname as official (%s)", (baseUrl) => {
    expect(() => validateImageProviderContract({ ...input, baseUrl, modelId: "unknown" })).not.toThrow();
    expect(() => validateImageProviderContract({ ...input, baseUrl, modelId: "gateway-legacy", parameters: { imageModelFamily: "dall-e-3" } })).not.toThrow();
  });

  it("recognizes the documented historical ChatGPT image alias", () => {
    expect(() => validateImageProviderContract({ ...input, modelId: "chatgpt-image-latest" })).not.toThrow();
  });

  it("reports invalid configuration without including its raw value", () => {
    expect(() => validateImageProviderContract({ ...input, baseUrl: "private-invalid-setting" }))
      .toThrow("生图接口 Base URL 无效，请检查模型设置");
  });
});
