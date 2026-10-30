import { getImageModelCapabilities } from "./image-capabilities";
import { AiProviderError, type AiImageGenerationInput } from "./types";

type ImageProviderContractInput = Pick<AiImageGenerationInput, "baseUrl" | "modelId" | "parameters">;

/** Pure protocol preflight; outbound URL and DNS safety checks are still required before dispatch. */
export function validateImageProviderContract(input: ImageProviderContractInput) {
  let hostname: string;
  try {
    hostname = new URL(input.baseUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new AiProviderError("AI_PROVIDER_RESPONSE_INVALID", "生图接口 Base URL 无效，请检查模型设置", false);
  }
  if (hostname !== "api.openai.com") return;

  const capabilities = getImageModelCapabilities(input.modelId, input.parameters);
  if (capabilities.supportsResponseFormat) {
    throw new AiProviderError(
      "AI_PROVIDER_RESPONSE_INVALID",
      "OpenAI 官方图片接口不支持 DALL·E 旧版协议，请在设置中选择对应的 GPT Image 模型系列",
      false,
    );
  }
  if (["unknown", "provider_alias"].includes(capabilities.source)) {
    throw new AiProviderError(
      "AI_PROVIDER_RESPONSE_INVALID",
      "当前模型未识别为 OpenAI 官方图片模型，请选择官方 GPT Image Model ID；文字模型不能直接用于图片生成。若为已验证的新型号，请在设置中明确声明兼容的生图模型系列",
      false,
    );
  }
}
