import {
  AiProviderError,
  IMAGE_BACKGROUNDS,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_OUTPUT_FORMATS,
  type AiImageGenerationInput,
  type ImageBackground,
  type ImageGenerationQuality,
  type ImageOutputFormat,
} from "./types";

export const IMAGE_MODEL_FAMILIES = [
  "auto", "gpt-image-2.5", "gpt-image-2", "gpt-image-1", "dall-e-3", "custom",
] as const;
export type ImageModelFamily = (typeof IMAGE_MODEL_FAMILIES)[number];
export type ImageModelProfile = Exclude<ImageModelFamily, "auto"> | "unknown";
export type ImageModelCapabilitySource = "official" | "declared" | "provider_alias" | "unknown";
export const MAX_IMAGE_GENERATION_PROMPT_LENGTH = 32_000;

export interface ImageModelCapabilities {
  profileId: ImageModelProfile;
  source: ImageModelCapabilitySource;
  label: string;
  known: boolean;
  supportsCustomSize: boolean;
  sizes: string[];
  qualities: ImageGenerationQuality[];
  formats: ImageOutputFormat[];
  backgrounds: ImageBackground[];
  transparency: boolean;
  supportsMask: boolean;
  supportsCompression: boolean;
  supportsReferences: boolean;
  maxReferenceImages: number;
  maxImageCount: number;
}

type Parameters = Record<string, string | number | boolean>;
const standardSizes = ["1024x1024", "1536x1024", "1024x1536"];
const standardQualities: ImageGenerationQuality[] = ["auto", "low", "medium", "high"];

/** Recognize exact contracts and explicitly listed supplier aliases; never guess vendor prefixes. */
export function getImageModelCapabilities(modelId: string, parameters: Parameters = {}): ImageModelCapabilities {
  const declared = parameters.imageModelFamily;
  if (declared !== undefined && !IMAGE_MODEL_FAMILIES.includes(declared as ImageModelFamily)) {
    throw invalid("生图模型能力配置无效，请在模型设置中重新选择接口兼容类型");
  }
  const id = modelId.trim().toLowerCase();
  let profileId: ImageModelProfile;
  let source: ImageModelCapabilitySource = "official";
  if (declared && declared !== "auto") {
    profileId = declared as Exclude<ImageModelFamily, "auto">;
    source = "declared";
  }
  else if (id === "gpt-image-2.5") {
    // Handle this exact supplier alias with the 2.5 request contract. It is not an
    // official model ID and must still be sent to the supplier unchanged.
    profileId = "gpt-image-2.5";
    source = "provider_alias";
  }
  else if (/^gpt-image-2\.5-(?:sunburst|flare)(?:-\d{4}-\d{2}-\d{2})?$/.test(id)) profileId = "gpt-image-2.5";
  else if (/^gpt-image-2(?:-\d{4}-\d{2}-\d{2})?$/.test(id)) profileId = "gpt-image-2";
  else if (/^gpt-image-1(?:\.5|-mini)?(?:-\d{4}-\d{2}-\d{2})?$/.test(id)) profileId = "gpt-image-1";
  else if (id === "dall-e-3") profileId = "dall-e-3";
  else {
    profileId = "unknown";
    source = "unknown";
  }
  const native = ["gpt-image-2.5", "gpt-image-2", "custom"].includes(profileId);
  const extended = profileId === "gpt-image-2.5" || profileId === "custom";
  const gpt = profileId.startsWith("gpt-image-");
  const advanced = gpt || profileId === "custom";
  const transparency = ["gpt-image-2.5", "gpt-image-1", "custom"].includes(profileId);
  const supportsReferences = profileId !== "dall-e-3";
  return {
    profileId,
    source,
    label: source === "provider_alias" ? "GPT Image 2.5（供应商兼容别名）" : ({
      "gpt-image-2.5": "GPT Image 2.5",
      "gpt-image-2": "GPT Image 2",
      "gpt-image-1": "GPT Image 1 / 1.5",
      "dall-e-3": "DALL·E 3",
      custom: "自定义兼容能力（用户声明）",
      unknown: "通用兼容模式（尚未验证）",
    })[profileId],
    known: source !== "provider_alias" && profileId !== "custom" && profileId !== "unknown",
    supportsCustomSize: native,
    sizes: native ? [] : profileId === "dall-e-3" ? ["1024x1024", "1792x1024", "1024x1792"] : [...standardSizes],
    qualities: extended ? [...IMAGE_GENERATION_QUALITIES] : [...standardQualities],
    formats: advanced ? [...IMAGE_OUTPUT_FORMATS] : ["jpeg"],
    backgrounds: transparency ? [...IMAGE_BACKGROUNDS] : advanced ? ["auto", "opaque"] : ["auto"],
    transparency,
    supportsMask: transparency,
    supportsCompression: advanced,
    supportsReferences,
    maxReferenceImages: supportsReferences ? 4 : 0,
    maxImageCount: profileId === "dall-e-3" ? 1 : 4,
  };
}

function invalid(message: string) {
  return new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", message, false);
}

export function validateImageModelSize(capabilities: ImageModelCapabilities, width: number, height: number) {
  const size = `${width}x${height}`;
  if (!capabilities.supportsCustomSize) {
    if (!capabilities.sizes.includes(size)) {
      throw invalid(`${capabilities.label} 不支持 ${size}；请选择 ${capabilities.sizes.join("、")}，或在设置中声明正确的模型能力`);
    }
    return size;
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || shortEdge <= 0 ||
    width % 16 !== 0 || height % 16 !== 0 || longEdge > 3_840 ||
    longEdge / shortEdge > 3 || pixels < 655_360 || pixels > 8_294_400) {
    throw invalid(`${capabilities.label} 尺寸必须为 16 的倍数，最长边不超过 3840px，比例不超过 3:1，总像素在 655,360–8,294,400 之间`);
  }
  return size;
}

type GenerationSettings = Pick<AiImageGenerationInput,
  "modelId" | "width" | "height" | "quality" | "imageCount" | "parameters" |
  "outputFormat" | "background" | "outputCompression"
> & Partial<Pick<AiImageGenerationInput, "prompt" | "negativePrompt" | "referenceImages" | "maskImage">> & {
  referenceImageCount?: number;
};

export function validateImageGenerationSettings(input: GenerationSettings) {
  const capabilities = getImageModelCapabilities(input.modelId, input.parameters);
  const size = validateImageModelSize(capabilities, input.width, input.height);
  if (!capabilities.qualities.includes(input.quality)) {
    throw invalid(`${capabilities.label} 不支持 ${input.quality} 质量；请选择 ${capabilities.qualities.join("、")}`);
  }
  if (!Number.isInteger(input.imageCount) || input.imageCount < 1 || input.imageCount > capabilities.maxImageCount) {
    throw invalid(`${capabilities.label} 每次最多生成 ${capabilities.maxImageCount} 张图片`);
  }
  const referenceCount = input.referenceImageCount ?? input.referenceImages?.length ?? 0;
  if (!Number.isInteger(referenceCount) || referenceCount < 0 || referenceCount > capabilities.maxReferenceImages) {
    throw invalid(`${capabilities.label} 最多支持 ${capabilities.maxReferenceImages} 张参考图片`);
  }
  if (input.maskImage && (!capabilities.supportsMask || referenceCount < 1 || input.maskImage.mimeType !== "image/png")) {
    throw invalid("局部编辑需要支持蒙版的模型、一张参考图及 PNG 蒙版");
  }
  const combinedPrompt = input.negativePrompt?.trim()
    ? `${input.prompt ?? ""}\n\nAvoid: ${input.negativePrompt.trim()}` : input.prompt ?? "";
  if (combinedPrompt.length > MAX_IMAGE_GENERATION_PROMPT_LENGTH) {
    throw invalid(`正向和负面提示词合计不能超过 ${MAX_IMAGE_GENERATION_PROMPT_LENGTH.toLocaleString("en-US")} 字符`);
  }
  const outputFormat = (input.outputFormat ?? input.parameters.output_format ?? "jpeg") as ImageOutputFormat;
  const background = (input.background ?? input.parameters.background ?? "auto") as ImageBackground;
  if (!capabilities.formats.includes(outputFormat)) throw invalid(`${capabilities.label} 不支持 ${String(outputFormat)} 输出格式`);
  if (!capabilities.backgrounds.includes(background)) throw invalid(`${capabilities.label} 不支持 ${String(background)} 背景`);
  if (background === "transparent" && outputFormat === "jpeg") {
    throw invalid("透明背景需要 PNG 或 WebP 输出格式");
  }
  const configuredCompression = input.outputCompression ?? (outputFormat === "png" ? undefined : input.parameters.output_compression);
  if (configuredCompression !== undefined && (!Number.isInteger(configuredCompression) || Number(configuredCompression) < 0 || Number(configuredCompression) > 100)) {
    throw invalid("图片压缩质量必须为 0–100 的整数");
  }
  if (configuredCompression !== undefined && (!capabilities.supportsCompression || outputFormat === "png")) {
    throw invalid("当前模型或 PNG 格式不支持图片压缩质量参数");
  }
  const outputCompression = capabilities.supportsCompression && outputFormat !== "png"
    ? Number(configuredCompression ?? 90) : undefined;
  const providerOptions: Record<string, string | number> = {};
  if (capabilities.supportsCompression) {
    providerOptions.output_format = outputFormat;
    providerOptions.background = background;
    if (outputCompression !== undefined) providerOptions.output_compression = outputCompression;
  } else providerOptions.response_format = "b64_json";
  const quality = capabilities.profileId === "dall-e-3" ? input.quality === "high" ? "hd" : "standard" : input.quality;
  return { capabilities, size, quality, outputFormat, background, outputCompression, providerOptions };
}
