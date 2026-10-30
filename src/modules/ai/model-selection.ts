import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { aiModelPreferences, aiModelProfiles, aiProviderConnections } from "@/db/schema";

import type { AiPurpose } from "./types";

const modelColumns = {
  modelProfileId: aiModelProfiles.id,
  modelId: aiModelProfiles.modelId,
  displayName: aiModelProfiles.displayName,
  capabilities: aiModelProfiles.capabilities,
  defaultParameters: aiModelProfiles.defaultParameters,
  modelEnabled: aiModelProfiles.enabled,
  connectionId: aiProviderConnections.id,
  providerType: aiProviderConnections.providerType,
  baseUrl: aiProviderConnections.baseUrl,
  encryptedSecret: aiProviderConnections.encryptedSecret,
  secretIv: aiProviderConnections.secretIv,
  secretAuthTag: aiProviderConnections.secretAuthTag,
  secretKeyId: aiProviderConnections.secretKeyId,
  connectionEnabled: aiProviderConnections.enabled,
};

export type SelectedModel = {
  purpose: AiPurpose | null;
  modelProfileId: string;
  modelId: string;
  displayName: string;
  capabilities: string[];
  defaultParameters: Record<string, string | number | boolean>;
  modelEnabled: boolean;
  connectionId: string;
  providerType: string;
  baseUrl: string;
  encryptedSecret: string;
  secretIv: string;
  secretAuthTag: string;
  secretKeyId: string;
  connectionEnabled: boolean;
};

function purposeOrder(purposes: readonly AiPurpose[]) {
  return sql.join([
    sql`case`,
    ...purposes.map((purpose, index) => sql`when ${aiModelPreferences.purpose} = ${purpose} then ${index}`),
    sql`else ${purposes.length} end`,
  ], sql` `);
}

export async function selectPreferredModel(userId: string, purposes: readonly [AiPurpose, ...AiPurpose[]]): Promise<SelectedModel | null> {
  const [row] = await db.select({
    ...modelColumns,
    purpose: aiModelPreferences.purpose,
  }).from(aiModelPreferences)
    .innerJoin(aiModelProfiles, and(
      eq(aiModelProfiles.id, aiModelPreferences.modelProfileId),
      eq(aiModelProfiles.userId, userId),
    ))
    .innerJoin(aiProviderConnections, and(
      eq(aiProviderConnections.id, aiModelProfiles.connectionId),
      eq(aiProviderConnections.userId, userId),
    ))
    .where(and(
      eq(aiModelPreferences.userId, userId),
      inArray(aiModelPreferences.purpose, [...purposes]),
    ))
    .orderBy(purposeOrder(purposes))
    .limit(1);
  return row ? { ...row, purpose: row.purpose as AiPurpose } : null;
}

export async function selectModelById(userId: string, modelProfileId: string): Promise<SelectedModel | null> {
  const [row] = await db.select(modelColumns).from(aiModelProfiles)
    .innerJoin(aiProviderConnections, and(
      eq(aiProviderConnections.id, aiModelProfiles.connectionId),
      eq(aiProviderConnections.userId, userId),
    ))
    .where(and(
      eq(aiModelProfiles.id, modelProfileId),
      eq(aiModelProfiles.userId, userId),
    ))
    .limit(1);
  return row ? { ...row, purpose: null } : null;
}
