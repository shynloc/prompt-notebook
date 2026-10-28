// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { LocalMediaStore } from "@/modules/media/local-media-store";

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("better-auth", () => ({ betterAuth: vi.fn((options) => ({ options })) }));

import { createPromptAuth } from "./server";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("local production authentication", () => {
  it.each([
    ["server", "https://prompts.example.com", true],
    ["server", "http://localhost:5488", true],
    ["local", "http://127.0.0.1:5488", false],
  ])("%s at %s requires verification: %s", (mode, appUrl, required) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_DEPLOYMENT_MODE", mode);
    vi.stubEnv("APP_URL", appUrl);
    vi.stubEnv("BETTER_AUTH_SECRET", "unit-test-authentication-secret-at-least-32-characters");
    createPromptAuth({ mailer: { send: vi.fn() } });
    const options = vi.mocked(betterAuth).mock.calls.at(-1)?.[0];
    expect(options?.emailAndPassword?.requireEmailVerification).toBe(required);
    expect(options?.emailVerification?.sendOnSignUp).toBe(required);
    expect(options?.advanced?.useSecureCookies).toBe(appUrl.startsWith("https:"));
  });

  it("refuses local authentication exceptions for a remote origin", () => {
    vi.stubEnv("APP_DEPLOYMENT_MODE", "local");
    vi.stubEnv("APP_URL", "http://localhost.evil.example");
    expect(() => createPromptAuth()).toThrow("Local deployment");
  });

  it("cleans owned local files after the native auth account-deletion hook", async () => {
    const cleanup = vi.spyOn(LocalMediaStore.prototype, "purgeDeletedAccount").mockResolvedValue(undefined);
    createPromptAuth({ mailer: { send: vi.fn() } });
    const hook = vi.mocked(betterAuth).mock.calls.at(-1)?.[0].user?.deleteUser?.afterDelete;
    expect(hook).toBeDefined();
    await hook?.({ id: "deleted-user", email: "deleted@example.com", name: "Deleted", emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("does not leak filesystem details or undo account deletion when cleanup fails", async () => {
    vi.spyOn(LocalMediaStore.prototype, "purgeDeletedAccount").mockRejectedValue(new Error("private filesystem details"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createPromptAuth({ mailer: { send: vi.fn() } });
    const hook = vi.mocked(betterAuth).mock.calls.at(-1)?.[0].user?.deleteUser?.afterDelete;
    await hook?.({ id: "deleted-user", email: "deleted@example.com", name: "Deleted", emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
    expect(warning).toHaveBeenCalledWith("Local media cleanup pending after account deletion");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private filesystem");
  });
});
