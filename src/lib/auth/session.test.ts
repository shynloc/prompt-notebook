// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), extensionAuthenticate: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/modules/extension/token-service", () => ({ ExtensionTokenService: class { authenticate = mocks.extensionAuthenticate; } }));

import { requireExtensionSession, requireSession } from "./session";

const session = { user: { id: "owner" }, session: { id: "session" } };
function request(method: string, origin?: string) {
  const headers = new Headers({ cookie: "better-auth.session_token=test-only" });
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("https://notes.example.com/api/v1/uploads", { method, headers });
}
beforeEach(() => { mocks.getSession.mockResolvedValue(session); vi.stubEnv("APP_URL", "https://notes.example.com"); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("cookie API write origin", () => {
  it("allows matching origins and originless CLI clients", async () => {
    await expect(requireSession(request("POST", "https://notes.example.com"))).resolves.toBe(session);
    await expect(requireSession(request("PATCH"))).resolves.toBe(session);
  });

  it.each(["https://other.example.com", "https://notes.example.com:444", "null", "", "https://notes.example.com/path", "https://user@notes.example.com"])("rejects foreign or non-origin headers: %s", async (origin) => {
    await expect(requireSession(request("POST", origin))).rejects.toMatchObject({ status: 403, code: "ORIGIN_NOT_ALLOWED" });
  });

  it("treats localhost ports as distinct origins", async () => {
    vi.stubEnv("APP_URL", "http://127.0.0.1:5488");
    await expect(requireSession(request("DELETE", "http://127.0.0.1:5490"))).rejects.toMatchObject({ status: 403 });
    await expect(requireSession(request("DELETE", "http://127.0.0.1:5488"))).resolves.toBe(session);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("does not reject read-only %s requests due to Origin", async (method) => {
    await expect(requireSession(request(method, "https://other.example.com"))).resolves.toBe(session);
  });

  it("still requires an authenticated cookie before checking write origin", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(requireSession(request("POST", "https://other.example.com"))).rejects.toMatchObject({ status: 401 });
  });

  it("cannot accept an opaque null origin through malformed application configuration", async () => {
    vi.stubEnv("APP_URL", "file:///private/application");
    await expect(requireSession(request("POST", "null"))).rejects.toMatchObject({ status: 403, code: "ORIGIN_NOT_ALLOWED" });
  });

  it("leaves extension bearer authentication on its separate authentication path", async () => {
    mocks.extensionAuthenticate.mockReturnValue(session);
    const bearerRequest = new Request("https://notes.example.com/api/v1/extension/captures", { method: "POST", headers: { authorization: "Bearer test-only", origin: "chrome-extension://test" } });
    expect(requireExtensionSession(bearerRequest)).toBe(session);
    expect(mocks.extensionAuthenticate).toHaveBeenCalledWith(bearerRequest);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
