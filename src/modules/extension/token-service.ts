import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import {
  extensionAccessTokens,
  extensionAuthorizationCodes,
  extensionDevices,
  extensionRefreshTokens,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { AuthorizeExtensionInput, ExchangeExtensionCodeInput } from "./extension-schema";

const ACCESS_TOKEN_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MS = 30 * 24 * 60 * 60 * 1000;
const AUTHORIZATION_CODE_MS = 5 * 60 * 1000;

function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function hashExtensionSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function createPkceChallenge(verifier: string) {
  return hashExtensionSecret(verifier);
}

function equalSecret(first: string, second: string) {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateExtensionRedirectUri(value: string) {
  const url = new URL(value);
  const chromeCallback = /^[a-p]{32}\.chromiumapp\.org$/.test(url.hostname);
  const appUrl = process.env.APP_URL ? new URL(process.env.APP_URL) : null;
  const localCallback = process.env.NODE_ENV !== "production" && appUrl &&
    url.origin === appUrl.origin && url.pathname === "/extension/callback";
  if (url.protocol !== "https:" && !localCallback) throw new ApiError(422, "INVALID_REDIRECT_URI", "插件回调地址必须使用 HTTPS");
  if ((!chromeCallback && !localCallback) || url.username || url.password || url.port || url.hash) {
    throw new ApiError(422, "INVALID_REDIRECT_URI", "插件回调地址无效");
  }
  return url.toString();
}

function tokenResponse(accessToken: string, refreshToken: string) {
  return {
    tokenType: "Bearer" as const,
    accessToken,
    expiresIn: ACCESS_TOKEN_MS / 1000,
    refreshToken,
    refreshExpiresIn: REFRESH_TOKEN_MS / 1000,
  };
}

async function issueTokenPair(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], deviceId: string) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  await Promise.all([
    tx.insert(extensionAccessTokens).values({
      deviceId,
      tokenHash: hashExtensionSecret(accessToken),
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_MS),
    }),
    tx.insert(extensionRefreshTokens).values({
      deviceId,
      tokenHash: hashExtensionSecret(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
    }),
  ]);
  return tokenResponse(accessToken, refreshToken);
}

export class ExtensionTokenService {
  async authorize(userId: string, input: AuthorizeExtensionInput) {
    const code = randomToken();
    const redirectUri = validateExtensionRedirectUri(input.redirectUri);
    await db.insert(extensionAuthorizationCodes).values({
      codeHash: hashExtensionSecret(code),
      userId,
      deviceName: input.deviceName,
      codeChallenge: input.codeChallenge,
      redirectUri,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_MS),
    });
    return { code, redirectUri, expiresIn: AUTHORIZATION_CODE_MS / 1000 };
  }

  async exchange(input: ExchangeExtensionCodeInput) {
    const redirectUri = validateExtensionRedirectUri(input.redirectUri);
    const codeHash = hashExtensionSecret(input.code);
    return db.transaction(async (tx) => {
      const [authorization] = await tx.select().from(extensionAuthorizationCodes)
        .where(and(
          eq(extensionAuthorizationCodes.codeHash, codeHash),
          gt(extensionAuthorizationCodes.expiresAt, new Date()),
          isNull(extensionAuthorizationCodes.usedAt),
        )).limit(1);
      if (!authorization || authorization.redirectUri !== redirectUri ||
          !equalSecret(createPkceChallenge(input.codeVerifier), authorization.codeChallenge)) {
        throw new ApiError(401, "INVALID_AUTHORIZATION_CODE", "授权码无效或已过期");
      }
      const [consumed] = await tx.update(extensionAuthorizationCodes).set({ usedAt: new Date() })
        .where(and(eq(extensionAuthorizationCodes.id, authorization.id), isNull(extensionAuthorizationCodes.usedAt)))
        .returning({ id: extensionAuthorizationCodes.id });
      if (!consumed) throw new ApiError(401, "INVALID_AUTHORIZATION_CODE", "授权码已经使用");
      const [device] = await tx.insert(extensionDevices).values({
        userId: authorization.userId,
        name: authorization.deviceName,
      }).returning();
      return { ...(await issueTokenPair(tx, device.id)), device: { id: device.id, name: device.name } };
    });
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashExtensionSecret(refreshToken);
    const [existing] = await db.select({
      deviceId: extensionRefreshTokens.deviceId,
      rotatedAt: extensionRefreshTokens.rotatedAt,
      revokedAt: extensionDevices.revokedAt,
    }).from(extensionRefreshTokens)
      .innerJoin(extensionDevices, eq(extensionRefreshTokens.deviceId, extensionDevices.id))
      .where(eq(extensionRefreshTokens.tokenHash, tokenHash)).limit(1);
    if (existing?.rotatedAt && !existing.revokedAt) {
      await db.update(extensionDevices).set({ revokedAt: new Date() }).where(eq(extensionDevices.id, existing.deviceId));
      throw new ApiError(401, "REFRESH_TOKEN_REUSED", "检测到重复令牌，设备授权已撤销");
    }
    return db.transaction(async (tx) => {
      const [current] = await tx.select({
        id: extensionRefreshTokens.id,
        deviceId: extensionRefreshTokens.deviceId,
        expiresAt: extensionRefreshTokens.expiresAt,
        rotatedAt: extensionRefreshTokens.rotatedAt,
        revokedAt: extensionDevices.revokedAt,
      }).from(extensionRefreshTokens)
        .innerJoin(extensionDevices, eq(extensionRefreshTokens.deviceId, extensionDevices.id))
        .where(eq(extensionRefreshTokens.tokenHash, tokenHash)).limit(1);
      if (!current || current.expiresAt <= new Date() || current.revokedAt) {
        throw new ApiError(401, "INVALID_REFRESH_TOKEN", "插件登录已经过期，请重新连接");
      }
      if (current.rotatedAt) throw new ApiError(401, "REFRESH_TOKEN_REUSED", "检测到重复令牌，设备授权已撤销");
      const [rotated] = await tx.update(extensionRefreshTokens).set({ rotatedAt: new Date() })
        .where(and(eq(extensionRefreshTokens.id, current.id), isNull(extensionRefreshTokens.rotatedAt)))
        .returning({ id: extensionRefreshTokens.id });
      if (!rotated) throw new ApiError(401, "INVALID_REFRESH_TOKEN", "插件登录已经失效");
      await tx.update(extensionDevices).set({ lastUsedAt: new Date() }).where(eq(extensionDevices.id, current.deviceId));
      return issueTokenPair(tx, current.deviceId);
    });
  }

  async authenticate(request: Request) {
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9_-]{40,200})$/.exec(header);
    if (!match) throw new ApiError(401, "INVALID_EXTENSION_TOKEN", "插件需要重新连接账户");
    const tokenHash = hashExtensionSecret(match[1]);
    const [principal] = await db.select({
      userId: extensionDevices.userId,
      deviceId: extensionDevices.id,
      deviceName: extensionDevices.name,
    }).from(extensionAccessTokens)
      .innerJoin(extensionDevices, eq(extensionAccessTokens.deviceId, extensionDevices.id))
      .where(and(
        eq(extensionAccessTokens.tokenHash, tokenHash),
        gt(extensionAccessTokens.expiresAt, new Date()),
        isNull(extensionDevices.revokedAt),
      )).limit(1);
    if (!principal) throw new ApiError(401, "INVALID_EXTENSION_TOKEN", "插件登录已经过期");
    await db.update(extensionDevices).set({ lastUsedAt: new Date() }).where(eq(extensionDevices.id, principal.deviceId));
    return principal;
  }

  async revokeDevice(userId: string, deviceId: string) {
    const [revoked] = await db.update(extensionDevices).set({ revokedAt: new Date() })
      .where(and(eq(extensionDevices.id, deviceId), eq(extensionDevices.userId, userId), isNull(extensionDevices.revokedAt)))
      .returning({ id: extensionDevices.id });
    if (!revoked) throw new ApiError(404, "DEVICE_NOT_FOUND", "没有找到这个插件设备");
    return revoked;
  }

  async revokeCurrent(deviceId: string) {
    await db.update(extensionDevices).set({ revokedAt: new Date() }).where(eq(extensionDevices.id, deviceId));
  }
}
