import { ApiError } from "@/lib/api/errors";
import { auth } from "@/lib/auth/server";
import { ExtensionTokenService } from "@/modules/extension/token-service";

const extensionTokens = new ExtensionTokenService();

export async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required");
  }
  return session;
}

export function requireExtensionSession(request: Request) {
  return extensionTokens.authenticate(request);
}
