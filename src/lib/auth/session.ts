import { ApiError } from "@/lib/api/errors";
import { auth } from "@/lib/auth/server";
import { ExtensionTokenService } from "@/modules/extension/token-service";

const extensionTokens = new ExtensionTokenService();

export async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== null) {
      let trustedOrigin = "";
      try {
        const configured = new URL(process.env.APP_URL ?? "http://localhost:3000");
        if (["http:", "https:"].includes(configured.protocol)) trustedOrigin = configured.origin;
      } catch { /* Invalid configuration fails closed. */ }
      if (!trustedOrigin || origin !== trustedOrigin) {
        throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request origin is not permitted");
      }
    }
  }
  return session;
}

export function requireExtensionSession(request: Request) {
  return extensionTokens.authenticate(request);
}
