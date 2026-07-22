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

export function normalizeApiError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    return new ApiError(422, "VALIDATION_ERROR", "The request is invalid", {
      issues: error.issues,
    });
  }
  if (error instanceof SyntaxError) {
    return new ApiError(400, "INVALID_JSON", "The request body is not valid JSON");
  }

  console.error(
    "Unhandled API error",
    error instanceof Error ? error.name : typeof error,
  );
  return new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred");
}
