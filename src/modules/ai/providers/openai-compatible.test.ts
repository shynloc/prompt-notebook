// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  mapOpenAiImageQuality,
  mapOpenAiImageSize,
  OpenAiCompatibleAdapter,
} from "./openai-compatible";
import { AiProviderError } from "../types";

const resolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("OpenAI-compatible provider adapter", () => {
  it("reconstructs a prompt from an inline image without exposing the API key", async () => {
    const fetcher = vi.fn(async (_requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      const body = JSON.parse(String(requestInit?.body));
      expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
      return Response.json({ choices: [{ message: { content: "  A tactile paper city at blue hour.  " } }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    const result = await adapter.reversePrompt({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-private",
      modelId: "vision-model",
      image: Buffer.from("89504e470d0a1a0a", "hex"),
      mimeType: "image/png",
      parameters: { temperature: 0.2 },
    });
    expect(result).toEqual({ prompt: "A tactile paper city at blue hour." });
    expect(JSON.stringify(result)).not.toContain("sk-private");
  });

  it("maps requested aspect ratio and quality to supported provider values", () => {
    expect(mapOpenAiImageSize("dall-e-3", 1600, 900)).toBe("1792x1024");
    expect(mapOpenAiImageSize("gpt-image-1", 900, 1600)).toBe("1024x1536");
    expect(mapOpenAiImageSize("gpt-image-1", 1024, 1024)).toBe("1024x1024");
    expect(mapOpenAiImageSize("gpt-image-2", 3840, 2160)).toBe("3840x2160");
    expect(mapOpenAiImageSize("gpt-image-2-2026-04-21", 2160, 3840)).toBe("2160x3840");
    expect(mapOpenAiImageQuality("dall-e-3", "high")).toBe("hd");
    expect(mapOpenAiImageQuality("gpt-image-2", "auto")).toBe("auto");
    expect(mapOpenAiImageQuality("gpt-image-1", "medium")).toBe("medium");
    expect(() => mapOpenAiImageSize("gpt-image-2", 3840, 3840)).toThrow(/8,294,400/);
  });

  it("sends the native GPT Image 2 4K contract without the legacy response_format", async () => {
    const image = Buffer.from("ffd8ffe000104a464946", "hex");
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: image.toString("base64") }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await adapter.generateImages({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-private",
      modelId: "gpt-image-2",
      prompt: "A cinematic valley",
      width: 3840,
      height: 2160,
      quality: "high",
      imageCount: 1,
      parameters: {},
      referenceImages: [],
    });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "gpt-image-2",
      size: "3840x2160",
      quality: "high",
      output_format: "jpeg",
      output_compression: 90,
    });
    expect(body).not.toHaveProperty("response_format");
  });

  it("generates inline images without persisting API credentials in the result", async () => {
    const image = Buffer.from("89504e470d0a1a0a", "hex");
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: image.toString("base64") }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    const result = await adapter.generateImages({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-private",
      modelId: "gpt-image-1",
      prompt: "A lighthouse",
      negativePrompt: "watermark",
      width: 1536,
      height: 1024,
      quality: "high",
      imageCount: 1,
      parameters: {},
      referenceImages: [],
    });
    expect(Buffer.from(result.images[0].data)).toEqual(image);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://api.example.com/v1/images/generations");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gpt-image-1",
      size: "1536x1024",
      quality: "high",
      n: 1,
    });
    expect(JSON.stringify(result)).not.toContain("sk-private");
  });

  it("uses the image edit endpoint and multipart bodies for reference images", async () => {
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await adapter.generateImages({
      baseUrl: "https://api.example.com/v1",
      apiKey: "key",
      modelId: "gpt-image-1",
      prompt: "Restyle this",
      width: 1024,
      height: 1024,
      quality: "medium",
      imageCount: 1,
      parameters: {},
      referenceImages: [{ data: Buffer.from("reference"), filename: "source.png", mimeType: "image/png" }],
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://api.example.com/v1/images/edits");
    expect(new Headers(init?.headers).get("content-type")).toContain("multipart/form-data; boundary=");
    expect(Buffer.isBuffer(init?.body)).toBe(true);
    expect(String(init?.body)).not.toContain("key");
  });

  it("optimizes a prompt with the selected model and bounded parameters", async () => {
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push([input, init]);
      return Response.json({
        choices: [{ message: { content: "  A cinematic portrait with precise rim lighting.  " } }],
      });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    const result = await adapter.optimizePrompt({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-private",
      modelId: "writer-model",
      prompt: "make a portrait",
      systemInstruction: "Improve the supplied prompt and return only the result.",
      parameters: { temperature: 0.4, max_tokens: 900, messages: "must-be-ignored" },
    });

    expect(result).toEqual({ optimizedPrompt: "A cinematic portrait with precise rim lighting." });
    const [url, init] = requests[0];
    expect(String(url)).toBe("https://api.example.com/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "writer-model", temperature: 0.4, max_tokens: 900, stream: false });
    expect(body.messages).toEqual([
      { role: "system", content: "Improve the supplied prompt and return only the result." },
      { role: "user", content: "make a portrait" },
    ]);
    expect(JSON.stringify(result)).not.toContain("sk-private");
  });

  it("rejects an empty optimization response with a stable error", async () => {
    const adapter = new OpenAiCompatibleAdapter({
      fetcher: vi.fn(async () => Response.json({ choices: [{ message: { content: "   " } }] })) as typeof fetch,
      resolver,
    });
    await expect(adapter.optimizePrompt({
      baseUrl: "https://api.example.com/v1",
      apiKey: "key",
      modelId: "writer-model",
      prompt: "original",
      systemInstruction: "Improve it.",
      parameters: {},
    })).rejects.toMatchObject({ code: "AI_PROVIDER_RESPONSE_INVALID" });
  });

  it("maps an optimization timeout to a retryable stable error", async () => {
    const adapter = new OpenAiCompatibleAdapter({
      fetcher: vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }) as typeof fetch,
      resolver,
    });
    await expect(adapter.optimizePrompt({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-not-for-errors",
      modelId: "writer-model",
      prompt: "original",
      systemInstruction: "Improve it.",
      parameters: {},
    })).rejects.toMatchObject({ code: "AI_PROVIDER_TIMEOUT", retryable: true });
    await expect(adapter.optimizePrompt({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-not-for-errors",
      modelId: "writer-model",
      prompt: "original",
      systemInstruction: "Improve it.",
      parameters: {},
    })).rejects.not.toThrow("secret-not-for-errors");
  });

  it("tests a connection without exposing the key", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ id: "model-a" }, { id: "model-b" }] }));
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    const result = await adapter.testConnection({ baseUrl: "https://api.example.com/v1", apiKey: "sk-private" });
    expect(result.availableModelIds).toEqual(["model-a", "model-b"]);
    expect(fetcher).toHaveBeenCalledWith(new URL("https://api.example.com/v1/models"), expect.objectContaining({ redirect: "manual" }));
    expect(JSON.stringify(result)).not.toContain("sk-private");
  });

  it.each([
    [401, "AI_PROVIDER_AUTH_FAILED", false],
    [402, "AI_PROVIDER_QUOTA_EXCEEDED", false],
    [429, "AI_PROVIDER_RATE_LIMITED", true],
    [503, "AI_PROVIDER_UNAVAILABLE", true],
  ] as const)("maps status %s to %s", async (status, code, retryable) => {
    const adapter = new OpenAiCompatibleAdapter({
      fetcher: vi.fn(async () => new Response("secret upstream body", { status })) as typeof fetch,
      resolver,
    });
    const promise = adapter.testConnection({ baseUrl: "https://api.example.com/v1", apiKey: "sk-private" });
    await expect(promise).rejects.toMatchObject({ code, retryable });
    await expect(promise).rejects.not.toThrow("secret upstream body");
  });

  it("blocks redirects instead of following them", async () => {
    const adapter = new OpenAiCompatibleAdapter({
      fetcher: vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } })) as typeof fetch,
      resolver,
    });
    await expect(adapter.testConnection({ baseUrl: "https://api.example.com/v1", apiKey: "key" }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_REDIRECT_BLOCKED" });
  });

  it("rejects malformed model responses with a stable error", async () => {
    const adapter = new OpenAiCompatibleAdapter({
      fetcher: vi.fn(async () => Response.json({ models: [] })) as typeof fetch,
      resolver,
    });
    await expect(adapter.testConnection({ baseUrl: "https://api.example.com/v1", apiKey: "key" }))
      .rejects.toBeInstanceOf(AiProviderError);
  });
});
