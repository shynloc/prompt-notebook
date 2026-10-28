// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMailer } from "./mailer";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("deployment mail delivery", () => {
  it("keeps production server mail fail-closed without SMTP", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_DEPLOYMENT_MODE", "server");
    vi.stubEnv("APP_URL", "https://prompts.example.com");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_FROM", "");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(createMailer().send({ to: "user@example.com", subject: "reset", text: "private reset link" })).rejects.toThrow("SMTP_HOST");
    expect(log).not.toHaveBeenCalled();
  });

  it("allows console mail only for explicit strict local mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_DEPLOYMENT_MODE", "local");
    vi.stubEnv("APP_URL", "http://127.0.0.1:5488");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await createMailer().send({ to: "local@example.com", subject: "reset", text: "http://127.0.0.1:5488/reset-password/test" });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain("127.0.0.1:5488/reset-password");
  });

  it("cannot turn a remote deployment into a console-mail installation", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_DEPLOYMENT_MODE", "local");
    vi.stubEnv("APP_URL", "https://localhost.example.com");
    expect(() => createMailer()).toThrow("Local deployment");
  });
});
