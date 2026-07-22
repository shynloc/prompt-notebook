// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/server";
import { createPkceChallenge } from "@/modules/extension/token-service";
import { POST as authorize } from "@/app/api/v1/extension/authorize/route";
import { GET as listDevices } from "@/app/api/v1/extension/devices/route";
import { POST as refresh } from "@/app/api/v1/extension/refresh/route";
import { POST as revoke } from "@/app/api/v1/extension/revoke/route";
import { POST as exchange } from "@/app/api/v1/extension/token/route";

const base = "http://127.0.0.1:3000";

function request(path: string, options: { body?: unknown; cookie?: string; bearer?: string } = {}) {
  const headers = new Headers();
  if (options.body) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  return new Request(`${base}${path}`, {
    method: options.body ? "POST" : "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function webSession() {
  const email = `extension-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await auth.handler(request("/api/auth/sign-up/email", { body: { name: "Extension user", email, password } }));
  const response = await auth.handler(request("/api/auth/sign-in/email", { body: { email, password } }));
  const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("Missing web session");
  return `better-auth.session_token=${token}`;
}

async function connect(cookie: string) {
  const verifier = randomBytes(32).toString("base64url");
  const redirectUri = `https://${"a".repeat(32)}.chromiumapp.org/prompt-notebook`;
  const approved = await authorize(request("/api/v1/extension/authorize", {
    cookie,
    body: { codeChallenge: createPkceChallenge(verifier), redirectUri, deviceName: "Chrome test" },
  }));
  expect(approved.status).toBe(201);
  const code = (await approved.json()).data.code;
  const tokenResponse = await exchange(request("/api/v1/extension/token", {
    body: { code, codeVerifier: verifier, redirectUri },
  }));
  expect(tokenResponse.status).toBe(200);
  return { code, verifier, redirectUri, tokens: (await tokenResponse.json()).data };
}

describe("extension device authorization", () => {
  it("exchanges a PKCE code once and lists the connected device", async () => {
    const cookie = await webSession();
    const connected = await connect(cookie);
    const replay = await exchange(request("/api/v1/extension/token", {
      body: { code: connected.code, codeVerifier: connected.verifier, redirectUri: connected.redirectUri },
    }));
    const devices = await listDevices(request("/api/v1/extension/devices", { cookie }));
    const deviceBody = await devices.json();

    expect(replay.status).toBe(401);
    expect(connected.tokens.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(connected.tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deviceBody.data).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Chrome test", revokedAt: null })]));
  });

  it("rotates refresh tokens and revokes a device when an old token is replayed", async () => {
    const cookie = await webSession();
    const { tokens } = await connect(cookie);
    const rotated = await refresh(request("/api/v1/extension/refresh", { body: { refreshToken: tokens.refreshToken } }));
    expect(rotated.status).toBe(200);
    expect((await rotated.json()).data.refreshToken).not.toBe(tokens.refreshToken);

    const replay = await refresh(request("/api/v1/extension/refresh", { body: { refreshToken: tokens.refreshToken } }));
    expect(replay.status).toBe(401);
    expect((await replay.json()).error.code).toBe("REFRESH_TOKEN_REUSED");

    const denied = await revoke(request("/api/v1/extension/revoke", { bearer: tokens.accessToken }));
    expect(denied.status).toBe(401);
  });
});

