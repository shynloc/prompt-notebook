import { ApiError } from "@/lib/api/errors";

import type { AiProviderError } from "./types";

export function providerApiError(error: AiProviderError) {
  const status = error.code === "AI_PROVIDER_RATE_LIMITED"
    ? 429
    : error.code === "AI_PROVIDER_TIMEOUT"
      ? 504
      : error.code === "AI_PROVIDER_AUTH_FAILED" || error.code === "AI_PROVIDER_QUOTA_EXCEEDED"
        ? 422
        : 502;
  return new ApiError(status, error.code, error.message);
}
