import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeApiError(error: unknown, requestId?: string) {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    return new ApiError(422, "VALIDATION_ERROR", "The request is invalid", {
      issues: error.issues,
    });
  }
  if (error instanceof SyntaxError) {
    return new ApiError(400, "INVALID_JSON", "The request body is not valid JSON");
  }

  const diagnostic = error instanceof Error
    ? { requestId, name: error.name, message: error.message, stack: error.stack }
    : { requestId, type: typeof error };
  console.error("Unhandled API error", diagnostic);
  return new ApiError(500, "INTERNAL_ERROR", "服务器处理请求时发生异常，请使用错误编号排查或稍后重试");
}
