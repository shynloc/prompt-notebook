// @vitest-environment node

import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { createPromptAuth } from "@/lib/auth/server";
import type { Mailer } from "@/lib/email/mailer";

const sentMessages: Array<{ to: string; subject: string; text: string }> = [];
const mailer: Mailer = {
  async send(message) {
    sentMessages.push(message);
  },
};

const auth = createPromptAuth({ mailer, requireEmailVerification: false });
const verifiedAuth = createPromptAuth({ mailer, requireEmailVerification: true });
const baseUrl = "http://localhost:3000/api/auth";

async function authRequest(
  path: string,
  options: { body?: Record<string, unknown>; cookie?: string; method?: string } = {},
) {
  const headers = new Headers();
  if (options.body) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);

  return auth.handler(
    new Request(`${baseUrl}${path}`, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
  );
}

async function verifiedAuthRequest(
  path: string,
  options: { body?: Record<string, unknown>; cookie?: string; method?: string } = {},
) {
  const headers = new Headers();
  if (options.body) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return verifiedAuth.handler(
    new Request(`${baseUrl}${path}`, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
  );
}

function sessionCookie(response: Response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/(?:__Secure-)?better-auth\.session_token=([^;,]+)/);
  if (!match) throw new Error("Authentication response did not set a session cookie");
  return `better-auth.session_token=${match[1]}`;
}

async function register(email: string, password = "correct-horse-battery") {
  return authRequest("/sign-up/email", {
    body: { email, password, name: "Test User" },
  });
}

async function signIn(email: string, password = "correct-horse-battery") {
  return authRequest("/sign-in/email", {
    body: { email, password },
  });
}

describe("independent authentication", () => {
  beforeAll(() => {
    process.env.APP_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET =
      "integration-test-secret-that-is-at-least-32-characters";
    process.env.DATABASE_URL ??=
      "postgres://prompt_notebook:prompt_notebook@127.0.0.1:55432/prompt_notebook_test";
  });

  it("registers an account and rejects the same email twice", async () => {
    const email = `register-${randomUUID()}@example.com`;
    const first = await register(email);
    const duplicate = await register(email);

    expect(first.status).toBe(200);
    expect((await first.json()).user.email).toBe(email);
    expect(duplicate.status).toBe(422);
  });

  it("accepts the correct password and rejects an invalid one", async () => {
    const email = `login-${randomUUID()}@example.com`;
    await register(email);

    const valid = await signIn(email);
    const invalid = await signIn(email, "definitely-wrong");

    expect(valid.status).toBe(200);
    expect(sessionCookie(valid)).toContain("better-auth.session_token=");
    expect(invalid.status).toBe(401);
  });

  it("requires and completes email verification when enabled", async () => {
    const email = `verify-${randomUUID()}@example.com`;
    const messageCount = sentMessages.length;
    const registration = await verifiedAuthRequest("/sign-up/email", {
      body: { email, password: "correct-horse-battery", name: "Verify User" },
    });
    const blocked = await verifiedAuthRequest("/sign-in/email", {
      body: { email, password: "correct-horse-battery" },
    });
    const verificationMessage = sentMessages.slice(messageCount).find(
      (message) => message.to === email && message.subject.includes("Verify"),
    );

    expect(registration.status).toBe(200);
    expect(blocked.status).toBe(403);
    expect(verificationMessage).toBeDefined();

    const verificationUrl = verificationMessage?.text.match(/https?:\/\/\S+/)?.[0];
    expect(verificationUrl).toBeDefined();
    const verified = await verifiedAuth.handler(new Request(verificationUrl!));
    expect([200, 302]).toContain(verified.status);

    const login = await verifiedAuthRequest("/sign-in/email", {
      body: { email, password: "correct-horse-battery" },
    });
    expect(login.status).toBe(200);
  });

  it("persists a session, logs out, and rejects the old cookie", async () => {
    const email = `logout-${randomUUID()}@example.com`;
    await register(email);
    const login = await signIn(email);
    const cookie = sessionCookie(login);

    const before = await authRequest("/get-session", { cookie });
    const logout = await authRequest("/sign-out", { cookie, method: "POST" });
    const after = await authRequest("/get-session", { cookie });

    expect((await before.json()).user.email).toBe(email);
    expect(logout.status).toBe(200);
    expect(await after.json()).toBeNull();
  });

  it("keeps two users in separate sessions", async () => {
    const firstEmail = `session-a-${randomUUID()}@example.com`;
    const secondEmail = `session-b-${randomUUID()}@example.com`;
    await register(firstEmail);
    await register(secondEmail);

    const firstCookie = sessionCookie(await signIn(firstEmail));
    const secondCookie = sessionCookie(await signIn(secondEmail));
    const firstSession = await (
      await authRequest("/get-session", { cookie: firstCookie })
    ).json();
    const secondSession = await (
      await authRequest("/get-session", { cookie: secondCookie })
    ).json();

    expect(firstSession.user.email).toBe(firstEmail);
    expect(secondSession.user.email).toBe(secondEmail);
    expect(firstSession.user.id).not.toBe(secondSession.user.id);
  });

  it("returns a generic password-reset response and queues an email", async () => {
    const email = `reset-${randomUUID()}@example.com`;
    await register(email);
    const known = await authRequest("/request-password-reset", {
      body: { email, redirectTo: "/reset-password" },
    });
    const unknown = await authRequest("/request-password-reset", {
      body: { email: `unknown-${randomUUID()}@example.com`, redirectTo: "/reset-password" },
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(sentMessages.some((message) => message.to === email)).toBe(true);
  });

  it("resets the password and revokes the previous password", async () => {
    const email = `reset-flow-${randomUUID()}@example.com`;
    await register(email);
    const messageCount = sentMessages.length;
    await authRequest("/request-password-reset", {
      body: { email, redirectTo: "/reset-password" },
    });
    const resetMessage = sentMessages.slice(messageCount).find(
      (message) => message.to === email && message.subject.includes("Reset"),
    );
    const token = resetMessage?.text.match(/reset-password\/([^?\s]+)/)?.[1];
    expect(token).toBeDefined();

    const reset = await authRequest("/reset-password", {
      body: { token, newPassword: "new-correct-horse-battery" },
    });
    expect(reset.status).toBe(200);
    expect((await signIn(email)).status).toBe(401);
    expect((await signIn(email, "new-correct-horse-battery")).status).toBe(200);
  });
});
