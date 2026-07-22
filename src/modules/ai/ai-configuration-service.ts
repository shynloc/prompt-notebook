import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  aiGenerationJobs,
  aiModelPreferences,
  aiModelProfiles,
  aiProviderConnections,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

import type {
  CreateAiConfigurationInput,
  UpdateAiConfigurationInput,
  UpdateAiPreferenceInput,
} from "./ai-configuration-schema";
import {
  decryptCredential,
  encryptCredential,
  type CredentialContext,
} from "./credential-crypto";
import { parseOutboundBaseUrl } from "./outbound-url-policy";
import { AiProviderRegistry } from "./provider-registry";
import { AiProviderError, type AiCapability, type AiProviderType } from "./types";

const MAX_CONFIGURATIONS_PER_USER = 50;
const MIN_CONNECTION_TEST_INTERVAL_MS = 10_000;

function credentialContext(
  userId: string,
  connectionId: string,
  providerType: string,
): CredentialContext {
  return { userId, connectionId, providerType };
}

function normalizedBaseUrl(value: string) {
  return parseOutboundBaseUrl(value).toString();
}

function providerApiError(error: AiProviderError) {
  const status = error.code === "AI_PROVIDER_RATE_LIMITED"
    ? 429
    : error.code === "AI_PROVIDER_TIMEOUT"
      ? 504
      : error.code === "AI_PROVIDER_AUTH_FAILED" || error.code === "AI_PROVIDER_QUOTA_EXCEEDED"
        ? 422
        : 502;
  return new ApiError(status, error.code, error.message);
}

export class AiConfigurationService {
  constructor(private readonly providers = new AiProviderRegistry()) {}

  async list(userId: string) {
    const rows = await db
      .select({
        id: aiProviderConnections.id,
        name: aiProviderConnections.name,
        providerType: aiProviderConnections.providerType,
        baseUrl: aiProviderConnections.baseUrl,
        secretHint: aiProviderConnections.secretHint,
        enabled: aiProviderConnections.enabled,
        lastTestStatus: aiProviderConnections.lastTestStatus,
        lastTestMessage: aiProviderConnections.lastTestMessage,
        lastTestedAt: aiProviderConnections.lastTestedAt,
        createdAt: aiProviderConnections.createdAt,
        updatedAt: aiProviderConnections.updatedAt,
        modelProfileId: aiModelProfiles.id,
        modelId: aiModelProfiles.modelId,
        displayName: aiModelProfiles.displayName,
        capabilities: aiModelProfiles.capabilities,
        defaultParameters: aiModelProfiles.defaultParameters,
        modelEnabled: aiModelProfiles.enabled,
      })
      .from(aiProviderConnections)
      .innerJoin(
        aiModelProfiles,
        and(
          eq(aiModelProfiles.connectionId, aiProviderConnections.id),
          eq(aiModelProfiles.userId, userId),
        ),
      )
      .where(eq(aiProviderConnections.userId, userId))
      .orderBy(desc(aiProviderConnections.updatedAt));
    return rows;
  }

  async create(userId: string, input: CreateAiConfigurationInput) {
    const [{ value: countValue }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(aiProviderConnections)
      .where(eq(aiProviderConnections.userId, userId));
    if (countValue >= MAX_CONFIGURATIONS_PER_USER) {
      throw new ApiError(422, "AI_CONFIGURATION_LIMIT", "At most 50 AI configurations are allowed");
    }
    const existing = await db
      .select({ id: aiProviderConnections.id })
      .from(aiProviderConnections)
      .where(and(
        eq(aiProviderConnections.userId, userId),
        sql`lower(${aiProviderConnections.name}) = lower(${input.name})`,
      ))
      .limit(1);
    if (existing.length) throw new ApiError(409, "AI_CONFIGURATION_NAME_EXISTS", "An AI configuration with this name already exists");

    const connectionId = randomUUID();
    const encrypted = encryptCredential(
      input.apiKey,
      credentialContext(userId, connectionId, input.providerType),
    );
    await db.transaction(async (tx) => {
      await tx.insert(aiProviderConnections).values({
        id: connectionId,
        userId,
        name: input.name,
        providerType: input.providerType,
        baseUrl: normalizedBaseUrl(input.baseUrl),
        ...encrypted,
        enabled: input.enabled,
      });
      await tx.insert(aiModelProfiles).values({
        connectionId,
        userId,
        modelId: input.modelId,
        displayName: input.displayName,
        capabilities: input.capabilities,
        defaultParameters: input.defaultParameters,
        enabled: input.enabled,
      });
    });
    return this.getView(userId, connectionId);
  }

  async update(userId: string, id: string, input: UpdateAiConfigurationInput) {
    const current = await this.getPrivate(userId, id);
    const [currentModel] = await db.select({ id: aiModelProfiles.id })
      .from(aiModelProfiles)
      .where(and(eq(aiModelProfiles.connectionId, id), eq(aiModelProfiles.userId, userId)))
      .limit(1);
    if (!currentModel) throw new ApiError(404, "AI_MODEL_PROFILE_NOT_FOUND", "AI model profile was not found");
    if (input.name && input.name.toLocaleLowerCase() !== current.name.toLocaleLowerCase()) {
      const duplicate = await db
        .select({ id: aiProviderConnections.id })
        .from(aiProviderConnections)
        .where(and(
          eq(aiProviderConnections.userId, userId),
          sql`lower(${aiProviderConnections.name}) = lower(${input.name})`,
        ))
        .limit(1);
      if (duplicate.length) throw new ApiError(409, "AI_CONFIGURATION_NAME_EXISTS", "An AI configuration with this name already exists");
    }
    const now = new Date();
    const secret = input.apiKey
      ? encryptCredential(input.apiKey, credentialContext(userId, id, current.providerType))
      : undefined;
    await db.transaction(async (tx) => {
      await tx.update(aiProviderConnections).set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.baseUrl ? { baseUrl: normalizedBaseUrl(input.baseUrl) } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...secret,
        ...(input.baseUrl || input.apiKey ? {
          lastTestStatus: null,
          lastTestMessage: null,
          lastTestedAt: null,
        } : {}),
        updatedAt: now,
      }).where(and(eq(aiProviderConnections.id, id), eq(aiProviderConnections.userId, userId)));
      await tx.update(aiModelProfiles).set({
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.capabilities ? { capabilities: input.capabilities } : {}),
        ...(input.defaultParameters ? { defaultParameters: input.defaultParameters } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: now,
      }).where(and(eq(aiModelProfiles.connectionId, id), eq(aiModelProfiles.userId, userId)));
      if (input.enabled === false) {
        await tx.delete(aiModelPreferences).where(and(
          eq(aiModelPreferences.userId, userId),
          eq(aiModelPreferences.modelProfileId, currentModel.id),
        ));
      } else if (input.capabilities) {
        await tx.delete(aiModelPreferences).where(and(
          eq(aiModelPreferences.userId, userId),
          eq(aiModelPreferences.modelProfileId, currentModel.id),
          notInArray(aiModelPreferences.purpose, input.capabilities),
        ));
      }
    });
    return this.getView(userId, id);
  }

  async delete(userId: string, id: string) {
    const deleted = await db.transaction(async (tx) => {
      const profiles = await tx.select({ id: aiModelProfiles.id }).from(aiModelProfiles).where(and(
        eq(aiModelProfiles.connectionId, id),
        eq(aiModelProfiles.userId, userId),
      ));
      const profileIds = profiles.map((profile) => profile.id);
      if (profileIds.length) {
        const now = new Date();
        await tx.update(aiGenerationJobs).set({
          status: "cancelled",
          modelProfileId: null,
          cancelRequestedAt: now,
          finishedAt: now,
          errorCode: "GENERATION_MODEL_REMOVED",
          errorMessage: "The configured model was removed",
          updatedAt: now,
        }).where(and(
          eq(aiGenerationJobs.userId, userId),
          inArray(aiGenerationJobs.modelProfileId, profileIds),
          inArray(aiGenerationJobs.status, ["preparing", "queued"]),
        ));
        await tx.update(aiGenerationJobs).set({
          status: "cancel_requested",
          modelProfileId: null,
          cancelRequestedAt: now,
          updatedAt: now,
        }).where(and(
          eq(aiGenerationJobs.userId, userId),
          inArray(aiGenerationJobs.modelProfileId, profileIds),
          inArray(aiGenerationJobs.status, ["running", "cancel_requested"]),
        ));
        await tx.update(aiGenerationJobs).set({ modelProfileId: null, updatedAt: now }).where(and(
          eq(aiGenerationJobs.userId, userId),
          inArray(aiGenerationJobs.modelProfileId, profileIds),
        ));
      }
      return tx.delete(aiProviderConnections)
        .where(and(eq(aiProviderConnections.id, id), eq(aiProviderConnections.userId, userId)))
        .returning({ id: aiProviderConnections.id });
    });
    if (!deleted.length) throw new ApiError(404, "AI_CONFIGURATION_NOT_FOUND", "AI configuration was not found");
    return { id, deleted: true };
  }

  async test(userId: string, id: string) {
    const connection = await this.getPrivate(userId, id);
    if (!connection.enabled) throw new ApiError(422, "AI_CONFIGURATION_DISABLED", "Enable this AI configuration before testing it");
    if (connection.lastTestedAt && Date.now() - connection.lastTestedAt.getTime() < MIN_CONNECTION_TEST_INTERVAL_MS) {
      throw new ApiError(429, "AI_CONNECTION_TEST_RATE_LIMITED", "Wait a few seconds before testing this connection again");
    }
    const apiKey = decryptCredential(connection, credentialContext(userId, id, connection.providerType));
    try {
      const result = await this.providers.get(connection.providerType as AiProviderType).testConnection({
        baseUrl: connection.baseUrl,
        apiKey,
      });
      await this.recordTest(userId, id, "success", "Connection succeeded");
      return result;
    } catch (error) {
      const normalized = error instanceof AiProviderError
        ? error
        : new AiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider could not be reached", true);
      await this.recordTest(userId, id, "failed", normalized.message);
      throw providerApiError(normalized);
    }
  }

  async listPreferences(userId: string) {
    return db.select({ purpose: aiModelPreferences.purpose, modelProfileId: aiModelPreferences.modelProfileId })
      .from(aiModelPreferences)
      .where(eq(aiModelPreferences.userId, userId));
  }

  async updatePreference(userId: string, input: UpdateAiPreferenceInput) {
    if (input.modelProfileId === null) {
      await db.delete(aiModelPreferences).where(and(
        eq(aiModelPreferences.userId, userId),
        eq(aiModelPreferences.purpose, input.purpose),
      ));
      return { purpose: input.purpose, modelProfileId: null };
    }
    const [profile] = await db.select({
      id: aiModelProfiles.id,
      capabilities: aiModelProfiles.capabilities,
      modelEnabled: aiModelProfiles.enabled,
      connectionEnabled: aiProviderConnections.enabled,
    }).from(aiModelProfiles)
      .innerJoin(aiProviderConnections, and(
        eq(aiProviderConnections.id, aiModelProfiles.connectionId),
        eq(aiProviderConnections.userId, userId),
      ))
      .where(and(eq(aiModelProfiles.id, input.modelProfileId), eq(aiModelProfiles.userId, userId)))
      .limit(1);
    if (!profile) throw new ApiError(404, "AI_MODEL_PROFILE_NOT_FOUND", "AI model profile was not found");
    if (!profile.modelEnabled || !profile.connectionEnabled) {
      throw new ApiError(422, "AI_MODEL_PROFILE_DISABLED", "The selected AI model is disabled");
    }
    if (!profile.capabilities.includes(input.purpose as AiCapability)) {
      throw new ApiError(422, "AI_MODEL_CAPABILITY_MISMATCH", "The selected AI model does not support this purpose");
    }
    await db.insert(aiModelPreferences).values({
      userId,
      purpose: input.purpose,
      modelProfileId: input.modelProfileId,
    }).onConflictDoUpdate({
      target: [aiModelPreferences.userId, aiModelPreferences.purpose],
      set: { modelProfileId: input.modelProfileId, updatedAt: new Date() },
    });
    return { purpose: input.purpose, modelProfileId: input.modelProfileId };
  }

  private async getView(userId: string, id: string) {
    const values = await this.list(userId);
    const value = values.find((candidate) => candidate.id === id);
    if (!value) throw new ApiError(404, "AI_CONFIGURATION_NOT_FOUND", "AI configuration was not found");
    return value;
  }

  private async getPrivate(userId: string, id: string) {
    const [connection] = await db.select().from(aiProviderConnections)
      .where(and(eq(aiProviderConnections.id, id), eq(aiProviderConnections.userId, userId)))
      .limit(1);
    if (!connection) throw new ApiError(404, "AI_CONFIGURATION_NOT_FOUND", "AI configuration was not found");
    return connection;
  }

  private async recordTest(userId: string, id: string, status: "success" | "failed", message: string) {
    await db.update(aiProviderConnections).set({
      lastTestStatus: status,
      lastTestMessage: message.slice(0, 300),
      lastTestedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(aiProviderConnections.id, id), eq(aiProviderConnections.userId, userId)));
  }
}
