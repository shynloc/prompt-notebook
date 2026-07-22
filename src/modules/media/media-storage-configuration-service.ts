import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { mediaStorageSettings } from "@/db/schema";
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

type ProviderFactory = (endpoint: string, token: string) => StorageProvider;
type StorageSetting = typeof mediaStorageSettings.$inferSelect;

const TEST_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+9yH5WQAAAABJRU5ErkJggg==",
  "base64",
);
const MIN_CONNECTION_TEST_INTERVAL_MS = 10_000;

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
    const row = await this.getPrivate(userId, false);
    return row ? this.toView(row) : null;
  }

  async upsert(userId: string, input: UpsertMediaStorageInput) {
    const current = await this.getPrivate(userId, false);
    if (!current && !input.token) {
      throw new ApiError(422, "IMAGE_STORAGE_TOKEN_REQUIRED", "A token is required when creating image storage settings");
    }
    const encrypted = input.token ? encryptCredential(input.token, context(userId)) : undefined;
    const endpoint = normalizeEndpoint(input.endpoint);
    if (current) {
      await db.update(mediaStorageSettings).set({
        providerType: input.providerType,
        endpoint,
        ...(encrypted ?? {}),
        enabled: input.enabled,
        lastTestStatus: null,
        lastTestMessage: null,
        lastTestedAt: null,
        updatedAt: new Date(),
      }).where(eq(mediaStorageSettings.userId, userId));
    } else {
      await db.insert(mediaStorageSettings).values({
        userId,
        providerType: input.providerType,
        endpoint,
        ...encrypted!,
        enabled: input.enabled,
      });
    }
    return this.get(userId);
  }

  async delete(userId: string) {
    const deleted = await db.delete(mediaStorageSettings)
      .where(eq(mediaStorageSettings.userId, userId))
      .returning({ userId: mediaStorageSettings.userId });
    if (!deleted.length) {
      throw new ApiError(404, "IMAGE_STORAGE_NOT_FOUND", "Image storage settings were not found");
    }
    return { deleted: true };
  }

  async providerFor(userId: string) {
    const row = await this.getPrivate(userId);
    if (!row) throw new ApiError(422, "IMAGE_STORAGE_NOT_CONFIGURED", "Configure image storage in Settings before uploading images");
    if (!row.enabled) {
      throw new ApiError(422, "IMAGE_STORAGE_DISABLED", "Enable image storage in Settings before uploading images");
    }
    return this.providerFactory(row.endpoint, decryptCredential(row, context(userId)));
  }

  async test(userId: string) {
    const row = await this.getPrivate(userId);
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
      await this.recordTest(userId, "success", "Connection succeeded");
      return { ok: true, displayUrl: result.displayUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image storage could not be reached";
      await this.recordTest(userId, "failed", message);
      throw new ApiError(422, "IMAGE_STORAGE_TEST_FAILED", message);
    }
  }

  private async recordTest(userId: string, status: "success" | "failed", message: string) {
    await db.update(mediaStorageSettings).set({
      lastTestStatus: status,
      lastTestMessage: message.slice(0, 500),
      lastTestedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(mediaStorageSettings.userId, userId));
  }

  private async getPrivate(userId: string, required = true) {
    const [row] = await db.select().from(mediaStorageSettings)
      .where(eq(mediaStorageSettings.userId, userId))
      .limit(1);
    if (!row && required) {
      throw new ApiError(
        422,
        "IMAGE_STORAGE_NOT_CONFIGURED",
        "Configure image storage in Settings before uploading images",
      );
    }
    return row;
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
