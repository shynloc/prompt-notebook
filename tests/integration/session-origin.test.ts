// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPromptAuth } from "@/lib/auth/server";
import { requireSession } from "@/lib/auth/session";

describe("authenticated API origin protection", () => {
  it("rejects same-site foreign-origin writes while retaining matching, originless and read access", async () => {
    const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
    const auth = createPromptAuth({ requireEmailVerification: false, mailer: { async send() {} } });
    const registration = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `origin-${randomUUID()}@example.com`, password: "test-password-origin-guard", name: "Origin test" }),
    }));
    expect(registration.status).toBe(200);
    const userId = (await registration.json()).user.id as string;
    const cookie = registration.headers.get("set-cookie")?.match(/(?:__Secure-)?better-auth\.session_token=([^;,]+)/)?.[0];
    expect(Boolean(cookie)).toBe(true);
    const apiRequest = (method: string, requestOrigin?: string) => new Request(`${origin}/api/v1/uploads`, {
      method, headers: { cookie: cookie!, ...(requestOrigin !== undefined ? { origin: requestOrigin } : {}) },
    });
    await expect(requireSession(apiRequest("POST", origin))).resolves.toMatchObject({ user: { id: userId } });
    await expect(requireSession(apiRequest("POST", "https://untrusted.example.com"))).rejects.toMatchObject({ status: 403, code: "ORIGIN_NOT_ALLOWED" });
    await expect(requireSession(apiRequest("POST", "null"))).rejects.toMatchObject({ status: 403 });
    await expect(requireSession(apiRequest("PATCH"))).resolves.toMatchObject({ user: { id: userId } });
    await expect(requireSession(apiRequest("GET", "https://untrusted.example.com"))).resolves.toMatchObject({ user: { id: userId } });
  });
});
