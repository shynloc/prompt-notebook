import { randomUUID } from "node:crypto";

import { normalizeApiError } from "./errors";

export function dataResponse(data: unknown, init?: ResponseInit, meta?: unknown) {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "private, no-store");
  return Response.json(meta === undefined ? { data } : { data, meta }, {
    ...init,
    headers,
  });
}

export function errorResponse(error: unknown, requestId = randomUUID()) {
  const normalized = normalizeApiError(error, requestId);
  return Response.json(
    {
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
        requestId,
      },
    },
    {
      status: normalized.status,
      headers: { "cache-control": "private, no-store" },
    },
  );
}
