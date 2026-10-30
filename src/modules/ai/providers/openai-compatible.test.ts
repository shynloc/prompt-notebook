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
  it.each([
    ["chatgpt-image-latest", false], ["chatgpt-image-latest", true],
    ["gpt-image-1.5", false], ["gpt-image-1.5", true],
    ["gpt-image-2-2026-04-21", false], ["gpt-image-2-2026-04-21", true],
    ["gpt-image-2.5-flare-2026-09-08", false], ["gpt-image-2.5-flare-2026-09-08", true],
  ] as const)("never sends legacy response_format to official model %s (references: %s)", async (modelId, withReference) => {
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await adapter.generateImages({
      baseUrl: "https://api.openai.com/v1", apiKey: "mock-official-key", modelId,
      prompt: "A synthetic paper observatory", width: 1024, height: 1024, quality: "medium", imageCount: 1,
      parameters: { response_format: "url", imageModelFamily: "auto", arbitrary: "never-forward" },
      referenceImages: withReference ? [{ data: Buffer.from("reference"), filename: "reference.png", mimeType: "image/png" }] : [],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://api.openai.com/v1/images/${withReference ? "edits" : "generations"}`);
    if (withReference) {
      const body = Buffer.from(init?.body as Buffer).toString();
      expect(body).toContain(`name="model"\r\n\r\n${modelId}`);
      expect(body).not.toContain("response_format");
      expect(body).not.toContain("imageModelFamily");
      expect(body).not.toContain("arbitrary");
    } else {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(modelId);
      expect(body).not.toHaveProperty("response_format");
      expect(body).not.toHaveProperty("imageModelFamily");
      expect(body).not.toHaveProperty("arbitrary");
      if (modelId === "chatgpt-image-latest") expect(body.output_format).toBe("jpeg");
    }
  });

  it.each([
    ["gpt-6.1-terra", false], ["gpt-6.1-terra", true],
    ["future-image-model", false], ["future-image-model", true],
    ["gpt-image-2.5", false], ["gpt-image-2.5", true],
  ] as const)("rejects an unrecognized official Images model before sending (%s, references: %s)", async (modelId, withReference) => {
    const fetcher = vi.fn();
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await expect(adapter.generateImages({
      baseUrl: "https://api.openai.com/v1", apiKey: "mock-official-key", modelId,
      prompt: "A synthetic paper observatory", width: 1024, height: 1024, quality: "medium", imageCount: 1,
      parameters: {},
      referenceImages: withReference ? [{ data: Buffer.from("reference"), filename: "reference.png", mimeType: "image/png" }] : [],
    })).rejects.toMatchObject({
      code: "AI_PROVIDER_RESPONSE_INVALID", retryable: false,
      message: expect.stringMatching(/OpenAI.*图片模型/),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["gpt-image-2", "custom"])("preserves an explicit future contract without silently rewriting its Model ID (%s)", async (imageModelFamily) => {
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await adapter.generateImages({
      baseUrl: "https://api.openai.com/v1", apiKey: "mock-official-key", modelId: "future-image-model",
      prompt: "A synthetic paper observatory", width: 1024, height: 1024, quality: "high", imageCount: 1,
      parameters: { imageModelFamily, response_format: "url" }, referenceImages: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ model: "future-image-model", output_format: "jpeg" });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty("response_format");
  });

  it.each([false, true])("does not guess a legacy contract for an unknown third-party model (references: %s)", async (withReference) => {
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await adapter.generateImages({
      baseUrl: "https://api.example.com/v1", apiKey: "mock-third-party-key", modelId: "gateway-unknown",
      prompt: "A synthetic paper observatory", width: 1024, height: 1024, quality: "medium", imageCount: 1,
      parameters: { response_format: "url" },
      referenceImages: withReference ? [{ data: Buffer.from("reference"), filename: "reference.png", mimeType: "image/png" }] : [],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain("response_format");
  });

  it.each(["gpt-image-2", "future-image-model", "dall-e-3"])("rejects an official legacy protocol declaration before billing (%s)", async (modelId) => {
    const fetcher = vi.fn();
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await expect(adapter.generateImages({
      baseUrl: "https://api.openai.com/v1", apiKey: "mock-official-key", modelId,
      prompt: "A synthetic paper observatory", width: 1024, height: 1024, quality: "high", imageCount: 1,
      parameters: { imageModelFamily: "dall-e-3" }, referenceImages: [],
    })).rejects.toMatchObject({
      code: "AI_PROVIDER_RESPONSE_INVALID", retryable: false,
      message: expect.stringMatching(/OpenAI.*DALL/),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retains an explicitly selected legacy contract for third-party gateways", async () => {
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await adapter.generateImages({
      baseUrl: "https://api.example.com/v1", apiKey: "mock-third-party-key", modelId: "gateway-legacy-alias",
      prompt: "A synthetic paper observatory", width: 1024, height: 1024, quality: "high", imageCount: 1,
      parameters: { imageModelFamily: "dall-e-3", response_format: "url" }, referenceImages: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      model: "gateway-legacy-alias", prompt: "A synthetic paper observatory", size: "1024x1024",
      quality: "hd", n: 1, response_format: "b64_json",
    });
  });

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

  it("preserves supported sizes and rejects silent legacy size conversion", () => {
    expect(mapOpenAiImageSize("dall-e-3", 1792, 1024)).toBe("1792x1024");
    expect(mapOpenAiImageSize("gpt-image-1", 1024, 1536)).toBe("1024x1536");
    expect(() => mapOpenAiImageSize("dall-e-3", 1600, 900)).toThrow(/不支持/);
    expect(() => mapOpenAiImageSize("gpt-image-1", 900, 1600)).toThrow(/不支持/);
    expect(mapOpenAiImageSize("gpt-image-1", 1024, 1024)).toBe("1024x1024");
    expect(mapOpenAiImageSize("gpt-image-2", 3840, 2160)).toBe("3840x2160");
    expect(mapOpenAiImageSize("gpt-image-2-2026-04-21", 2160, 3840)).toBe("2160x3840");
    expect(mapOpenAiImageQuality("dall-e-3", "high")).toBe("hd");
    expect(mapOpenAiImageQuality("gpt-image-2", "auto")).toBe("auto");
    expect(mapOpenAiImageQuality("gpt-image-1", "medium")).toBe("medium");
    expect(() => mapOpenAiImageSize("gpt-image-2", 3840, 3840)).toThrow(/8,294,400/);
  });

  it.each(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare-2026-09-08"])("sends the native 2.5 output contract for %s", async (modelId) => {
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await adapter.generateImages({
      baseUrl: "https://api.example.com/v1", apiKey: "key", modelId, prompt: "A glass city",
      width: 2160, height: 3840, quality: "xhigh", imageCount: 1,
      outputFormat: "webp", background: "transparent", outputCompression: 84,
      parameters: { response_format: "ignored", output_format: "png", imageModelFamily: "auto", arbitrary: "never-forward" }, referenceImages: [],
    });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: modelId, size: "2160x3840", quality: "xhigh", output_format: "webp", background: "transparent", output_compression: 84 });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("arbitrary");
    expect(body).not.toHaveProperty("imageModelFamily");
  });

  it.each([[3840, 2160], [2160, 3840]])("preserves a bare provider alias and its %ix%i image request", async (width, height) => {
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await adapter.generateImages({
      baseUrl: "https://api.example.com/v1", apiKey: "mock-test-key", modelId: "gpt-image-2.5", prompt: "A city skyline",
      width, height, quality: "high", imageCount: 1, parameters: {}, referenceImages: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe("https://api.example.com/v1/images/generations");
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: "gpt-image-2.5", size: `${width}x${height}`, quality: "high", output_format: "jpeg", output_compression: 90 });
    expect(body).not.toHaveProperty("response_format");
  });

  it("validates unsupported settings before sending a potentially billed request", async () => {
    const fetcher = vi.fn();
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await expect(adapter.generateImages({
      baseUrl: "https://api.example.com/v1", apiKey: "key", modelId: "gpt-image-1", prompt: "A glass city",
      width: 3840, height: 2160, quality: "high", imageCount: 1, parameters: {}, referenceImages: [],
    })).rejects.toThrow(/不支持 3840x2160/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses 2.5 multipart output options and a fixed safe mask filename", async () => {
    const fetcher = vi.fn(async (requestInput: RequestInfo | URL, requestInit?: RequestInit) => {
      void requestInput;
      void requestInit;
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    await adapter.generateImages({
      baseUrl: "https://api.example.com/v1", apiKey: "key", modelId: "gpt-image-2.5-flare", prompt: "Blue shirt",
      width: 1024, height: 1024, quality: "max", imageCount: 1,
      outputFormat: "png", background: "transparent", parameters: {},
      referenceImages: [{ data: Buffer.from("image"), filename: "unsafe\r\nHeader", mimeType: "image/png" }],
      maskImage: { data: Buffer.from("mask"), filename: "also-unsafe\r\nHeader", mimeType: "image/png" },
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toMatch(/\/images\/edits$/);
    const body = Buffer.from(init?.body as Buffer).toString();
    expect(body).toContain('name="mask"; filename="mask.png"');
    expect(body).toContain('name="output_format"\r\n\r\npng');
    expect(body).toContain('name="quality"\r\n\r\nmax');
    expect(body).not.toContain('name="output_compression"');
    expect(body).not.toContain("unsafe");
    expect(body).not.toContain("response_format");
  });

  it("keeps only bounded token counts and known output metadata", async () => {
    const adapter = new OpenAiCompatibleAdapter({
      fetcher: vi.fn(async () => Response.json({
        data: [{ b64_json: "iVBORw0KGgo=" }], size: "2048x2048", quality: "max", output_format: "png", background: "transparent",
        usage: { total_tokens: 150, input_tokens: 100, output_tokens: 50, raw_prompt: "private input", secret: "sk-private", input_tokens_details: { text_tokens: 50, image_tokens: 50, arbitrary: "private" }, output_tokens_details: { image_tokens: 50, text_tokens: -1, cached_tokens: 1e20 } },
      })) as typeof fetch,
      resolver,
    });
    const result = await adapter.generateImages({
      baseUrl: "https://api.example.com/v1", apiKey: "sk-private", modelId: "gpt-image-2.5-sunburst", prompt: "A city",
      width: 1024, height: 1024, quality: "max", imageCount: 1, outputFormat: "png", background: "transparent", parameters: {}, referenceImages: [],
    });
    expect(result.metadata).toEqual({
      size: "2048x2048", quality: "max", outputFormat: "png", background: "transparent",
      usage: { total_tokens: 150, input_tokens: 100, output_tokens: 50, input_tokens_details: { text_tokens: 50, image_tokens: 50 }, output_tokens_details: { image_tokens: 50 } },
    });
    expect(JSON.stringify(result.metadata)).not.toContain("private");
  });

  it("accepts generated images over the upload budget and rejects images over 32MiB", async () => {
    const adapter = (bytes: number) => new OpenAiCompatibleAdapter({
      fetcher: vi.fn(async () => Response.json({ data: [{ b64_json: Buffer.alloc(bytes, 1).toString("base64") }] })) as typeof fetch,
      resolver,
    });
    const input = {
      baseUrl: "https://api.example.com/v1", apiKey: "key", modelId: "gpt-image-2.5-flare", prompt: "A city",
      width: 1024, height: 1024, quality: "high" as const, imageCount: 1, parameters: {}, referenceImages: [],
    };
    expect((await adapter(10 * 1024 * 1024 + 1).generateImages(input)).images[0].data.length).toBe(10 * 1024 * 1024 + 1);
    await expect(adapter(32 * 1024 * 1024 + 1).generateImages(input)).rejects.toMatchObject({ code: "AI_PROVIDER_RESPONSE_INVALID", retryable: false });
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
      parameters: {
        temperature: 0.4,
        max_tokens: 900,
        messages: "must-be-ignored",
        response_format: "must-be-ignored",
      },
    });

    expect(result).toEqual({ optimizedPrompt: "A cinematic portrait with precise rim lighting." });
    const [url, init] = requests[0];
    expect(String(url)).toBe("https://api.example.com/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "writer-model", temperature: 0.4, max_tokens: 900, stream: false });
    expect(body).not.toHaveProperty("response_format");
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

  it("does not automatically retry an image request after the client wait timeout", async () => {
    const adapter = new OpenAiCompatibleAdapter({
      imageTimeoutMs: 1,
      fetcher: vi.fn(async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as typeof fetch,
      resolver,
    });
    await expect(adapter.generateImages({
      baseUrl: "https://api.example.com/v1",
      apiKey: "key",
      modelId: "gpt-image-2",
      prompt: "A lighthouse",
      width: 1024,
      height: 1024,
      quality: "high",
      imageCount: 1,
      parameters: {},
      referenceImages: [],
    })).rejects.toMatchObject({ code: "AI_PROVIDER_TIMEOUT", retryable: false });
  });

  it.each(["dispatch", "response"])("does not retry an ambiguous image %s disconnect", async (stage) => {
    const privateDetail = "private-upstream-address-or-key";
    const fetcher = vi.fn(async () => {
      if (stage === "dispatch") throw new TypeError(privateDetail);
      return new Response(new ReadableStream({
        start(controller) { controller.error(new TypeError(privateDetail)); },
      }));
    });
    const adapter = new OpenAiCompatibleAdapter({ fetcher: fetcher as typeof fetch, resolver });
    const result = adapter.generateImages({
      baseUrl: "https://api.example.com/v1", apiKey: "key", modelId: "gpt-image-2.5-flare", prompt: "A lighthouse",
      width: 1024, height: 1024, quality: "high", imageCount: 1, parameters: {}, referenceImages: [],
    });
    await expect(result).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", retryable: false });
    await expect(result).rejects.not.toThrow(privateDetail);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("surfaces sanitized structured provider errors and request IDs", async () => {
    const adapter = new OpenAiCompatibleAdapter({
      fetcher: vi.fn(async () => Response.json({
        error: { code: "invalid_value", message: "Unsupported size for opaque-private-provider-key" },
      }, { status: 400, headers: { "x-request-id": "provider-request-123" } })) as typeof fetch,
      resolver,
    });
    const promise = adapter.generateImages({
      baseUrl: "https://api.example.com/v1",
      apiKey: "opaque-private-provider-key",
      modelId: "gpt-image-2",
      prompt: "A lighthouse",
      width: 1024,
      height: 1024,
      quality: "high",
      imageCount: 1,
      parameters: {},
      referenceImages: [],
    });
    await expect(promise).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: false,
      message: expect.stringContaining("invalid_value"),
    });
    await expect(promise).rejects.toThrow("provider-request-123");
    await expect(promise).rejects.not.toThrow("opaque-private-provider-key");
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
