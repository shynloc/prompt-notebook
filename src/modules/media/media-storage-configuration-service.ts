import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { mediaStoragePreferences, mediaStorageSettings, user } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  decryptCredential,
  encryptCredential,
  type CredentialContext,
} from "@/modules/ai/credential-crypto";
import { parseOutboundBaseUrl } from "@/modules/ai/outbound-url-policy";

import type { UpsertMediaStorageInput } from "./media-storage-schema";
import { PicbedProvider } from "./providers/picbed";
import type { StorageProvider } from "./storage-provider";
import { LocalMediaStore, localMediaUsage } from "./local-media-store";

type ProviderFactory = (endpoint: string, token: string) => StorageProvider;
type StorageSetting = typeof mediaStorageSettings.$inferSelect;
type StorageTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const TEST_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+9yH5WQAAAABJRU5ErkJggg==",
  "base64",
);
const MIN_CONNECTION_TEST_INTERVAL_MS = 10_000;
const recentConnectionTests = new Map<string, number>();

function claimConnectionTest(userId: string) {
  const now = Date.now();
  if (now - (recentConnectionTests.get(userId) ?? 0) < MIN_CONNECTION_TEST_INTERVAL_MS) throw new ApiError(429, "IMAGE_STORAGE_TEST_RATE_LIMITED", "Wait a few seconds before testing this connection again");
  if (recentConnectionTests.size >= 10_000) {
    for (const [id, testedAt] of recentConnectionTests) if (now - testedAt >= MIN_CONNECTION_TEST_INTERVAL_MS) recentConnectionTests.delete(id);
    if (recentConnectionTests.size >= 10_000) throw new ApiError(429, "IMAGE_STORAGE_TEST_RATE_LIMITED", "图片存储测试繁忙，请稍后重试");
  }
  recentConnectionTests.set(userId, now);
}

function context(userId: string): CredentialContext {
  return { userId, connectionId: userId, providerType: "media:picbed" };
}

function normalizeEndpoint(value: string) {
  try {
    return parseOutboundBaseUrl(value).toString();
  } catch (error) {
    throw new ApiError(
      422,
      "IMAGE_STORAGE_ENDPOINT_INVALID",
      error instanceof Error
        ? error.message.replace(/^AI provider Base URL/, "Image storage endpoint")
        : "Image storage endpoint is invalid",
    );
  }
}

export class MediaStorageConfigurationService {
  constructor(
    private readonly providerFactory: ProviderFactory = (endpoint, token) => new PicbedProvider(endpoint, token),
  ) {}

  async get(userId: string) {
    const { row, providerType } = await this.snapshot(userId);
    return {
      ...(row ? this.toView(row) : { endpoint: "", tokenHint: "", enabled: true, lastTestStatus: null, lastTestMessage: null, lastTestedAt: null, createdAt: null, updatedAt: null }),
      providerType,
      enabled: providerType === "local" || Boolean(row?.enabled),
      ...(providerType === "local" ? { enabled: true, lastTestStatus: null, lastTestMessage: null, lastTestedAt: null } : {}),
      picbedConfigured: Boolean(row),
      local: await localMediaUsage(userId),
    };
  }

  async upsert(userId: string, input: UpsertMediaStorageInput) {
    const endpoint = input.providerType === "picbed" ? normalizeEndpoint(input.endpoint) : undefined;
    const encrypted = input.providerType === "picbed" && input.token ? encryptCredential(input.token, context(userId)) : undefined;
    await db.transaction(async (transaction) => {
      await this.lock(transaction, userId);
      if (input.providerType === "picbed") {
        const [current] = await transaction.select().from(mediaStorageSettings).where(eq(mediaStorageSettings.userId, userId)).limit(1);
        if (!current && !encrypted) throw new ApiError(422, "IMAGE_STORAGE_TOKEN_REQUIRED", "A token is required when creating image storage settings");
        if (current) {
          await transaction.update(mediaStorageSettings).set({
            endpoint: endpoint!, ...(encrypted ?? {}), enabled: input.enabled,
            lastTestStatus: null, lastTestMessage: null, lastTestedAt: null, updatedAt: new Date(),
          }).where(eq(mediaStorageSettings.userId, userId));
        } else {
          await transaction.insert(mediaStorageSettings).values({ userId, providerType: "picbed", endpoint: endpoint!, ...encrypted!, enabled: input.enabled });
        }
      }
      await this.selectProvider(transaction, userId, input.providerType);
    });
    return this.get(userId);
  }

  async delete(userId: string) {
    await db.transaction(async (transaction) => {
      await this.lock(transaction, userId);
      const deleted = await transaction.delete(mediaStorageSettings).where(eq(mediaStorageSettings.userId, userId)).returning({ userId: mediaStorageSettings.userId });
      if (!deleted.length) throw new ApiError(404, "IMAGE_STORAGE_NOT_FOUND", "Image storage settings were not found");
      await this.selectProvider(transaction, userId, "local");
    });
    return { ...(await this.get(userId)), deleted: true };
  }

  async providerFor(userId: string) {
    const { row, providerType } = await this.snapshot(userId);
    if (providerType === "local") return new LocalMediaStore(userId);
    if (!row) throw new ApiError(422, "IMAGE_STORAGE_NOT_CONFIGURED", "Configure image storage in Settings before uploading images");
    if (!row.enabled) {
      throw new ApiError(422, "IMAGE_STORAGE_DISABLED", "Enable image storage in Settings before uploading images");
    }
    return this.providerFactory(row.endpoint, decryptCredential(row, context(userId)));
  }

  async test(userId: string) {
    const { row, providerType } = await this.snapshot(userId);
    claimConnectionTest(userId);
    if (providerType === "local") return new LocalMediaStore(userId).test();
    if (!row) throw new ApiError(422, "IMAGE_STORAGE_NOT_CONFIGURED", "Configure image storage in Settings before testing it");
    if (!row.enabled) {
      throw new ApiError(422, "IMAGE_STORAGE_DISABLED", "Enable image storage before testing it");
    }
    if (row.lastTestedAt && Date.now() - row.lastTestedAt.getTime() < MIN_CONNECTION_TEST_INTERVAL_MS) {
      throw new ApiError(429, "IMAGE_STORAGE_TEST_RATE_LIMITED", "Wait a few seconds before testing this connection again");
    }
    try {
      const provider = this.providerFactory(row.endpoint, decryptCredential(row, context(userId)));
      const owner = createHash("sha256").update(userId).digest("hex").slice(0, 16);
      const result = await provider.upload({
        data: TEST_IMAGE,
        filename: "connection-test.png",
        mimeType: "image/png",
        path: `prompt-notebook/connection-tests/${owner}/connection-test.png`,
      });
      await this.recordTest(userId, "success", "Connection succeeded", row);
      return { ok: true, displayUrl: result.displayUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image storage could not be reached";
      await this.recordTest(userId, "failed", message, row);
      throw new ApiError(422, "IMAGE_STORAGE_TEST_FAILED", message);
    }
  }

  private async recordTest(userId: string, status: "success" | "failed", message: string, snapshot: StorageSetting) {
    await db.update(mediaStorageSettings).set({
      lastTestStatus: status,
      lastTestMessage: message.slice(0, 500),
      lastTestedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(mediaStorageSettings.userId, userId), eq(mediaStorageSettings.endpoint, snapshot.endpoint), eq(mediaStorageSettings.encryptedSecret, snapshot.encryptedSecret), eq(mediaStorageSettings.enabled, snapshot.enabled)));
  }

  private async lock(transaction: StorageTransaction, userId: string) {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`media-storage-settings:${userId}`}, 0))`);
  }

  private async selectProvider(transaction: StorageTransaction, userId: string, providerType: "local" | "picbed") {
    await transaction.insert(mediaStoragePreferences).values({ userId, providerType })
      .onConflictDoUpdate({ target: mediaStoragePreferences.userId, set: { providerType, updatedAt: new Date() } });
  }

  private async snapshot(userId: string) {
    const [snapshot] = await db.select({ row: mediaStorageSettings, selectedProvider: mediaStoragePreferences.providerType })
      .from(user)
      .leftJoin(mediaStorageSettings, eq(mediaStorageSettings.userId, user.id))
      .leftJoin(mediaStoragePreferences, eq(mediaStoragePreferences.userId, user.id))
      .where(eq(user.id, userId)).limit(1);
    if (!snapshot) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "账户不存在");
    return { row: snapshot.row, providerType: snapshot.selectedProvider ?? (snapshot.row ? "picbed" : "local") };
  }

  private toView(row: StorageSetting) {
    return {
      providerType: row.providerType,
      endpoint: row.endpoint,
      tokenHint: row.secretHint,
      enabled: row.enabled,
      lastTestStatus: row.lastTestStatus,
      lastTestMessage: row.lastTestMessage,
      lastTestedAt: row.lastTestedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
