import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const aiProviderConnections = pgTable(
  "ai_provider_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    providerType: text("provider_type").default("openai_compatible").notNull(),
    baseUrl: text("base_url").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretAuthTag: text("secret_auth_tag").notNull(),
    secretKeyId: text("secret_key_id").notNull(),
    secretHint: text("secret_hint").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastTestStatus: text("last_test_status"),
    lastTestMessage: text("last_test_message"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("ai_provider_connections_id_user_unique").on(table.id, table.userId),
    uniqueIndex("ai_provider_connections_user_name_unique").on(
      table.userId,
      sql`lower(${table.name})`,
    ),
    index("ai_provider_connections_user_enabled_updated_idx").on(
      table.userId,
      table.enabled,
      table.updatedAt.desc(),
    ),
    check(
      "ai_provider_connections_type_check",
      sql`${table.providerType} in ('openai_compatible')`,
    ),
    check(
      "ai_provider_connections_test_status_check",
      sql`${table.lastTestStatus} is null or ${table.lastTestStatus} in ('success', 'failed')`,
    ),
  ],
);

export const aiModelProfiles = pgTable(
  "ai_model_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").notNull(),
    userId: text("user_id").notNull(),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    capabilities: text("capabilities").array().notNull(),
    defaultParameters: jsonb("default_parameters")
      .$type<Record<string, string | number | boolean>>()
      .default({})
      .notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("ai_model_profiles_id_user_unique").on(table.id, table.userId),
    foreignKey({
      columns: [table.connectionId, table.userId],
      foreignColumns: [aiProviderConnections.id, aiProviderConnections.userId],
      name: "ai_model_profiles_connection_owner_fk",
    }).onDelete("cascade"),
    uniqueIndex("ai_model_profiles_connection_model_unique").on(
      table.connectionId,
      table.modelId,
    ),
    index("ai_model_profiles_user_enabled_updated_idx").on(
      table.userId,
      table.enabled,
      table.updatedAt.desc(),
    ),
  ],
);

export const aiModelPreferences = pgTable(
  "ai_model_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    modelProfileId: uuid("model_profile_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.purpose] }),
    foreignKey({
      columns: [table.modelProfileId, table.userId],
      foreignColumns: [aiModelProfiles.id, aiModelProfiles.userId],
      name: "ai_model_preferences_profile_owner_fk",
    }).onDelete("cascade"),
    index("ai_model_preferences_profile_idx").on(table.modelProfileId),
    check(
      "ai_model_preferences_purpose_check",
      sql`${table.purpose} in ('prompt_optimization', 'term_analysis', 'image_generation', 'reverse_prompt')`,
    ),
  ],
);

export const aiGenerationJobs = pgTable(
  "ai_generation_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    modelProfileId: uuid("model_profile_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    kind: text("kind").default("text_to_image").notNull(),
    status: text("status").default("preparing").notNull(),
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    modelId: text("model_id").notNull(),
    modelName: text("model_name").notNull(),
    providerType: text("provider_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    quality: text("quality").notNull(),
    imageCount: integer("image_count").notNull(),
    parameters: jsonb("parameters")
      .$type<Record<string, string | number | boolean>>()
      .default({})
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    progress: integer("progress").default(0).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("ai_generation_jobs_id_user_unique").on(table.id, table.userId),
    uniqueIndex("ai_generation_jobs_user_idempotency_unique").on(table.userId, table.idempotencyKey),
    foreignKey({
      columns: [table.modelProfileId, table.userId],
      foreignColumns: [aiModelProfiles.id, aiModelProfiles.userId],
      name: "ai_generation_jobs_model_owner_fk",
    }).onDelete("restrict"),
    index("ai_generation_jobs_model_profile_idx").on(table.modelProfileId),
    index("ai_generation_jobs_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
    index("ai_generation_jobs_user_active_created_idx")
      .on(table.userId, table.createdAt.desc())
      .where(sql`${table.status} in ('preparing', 'queued', 'running', 'cancel_requested')`),
    index("ai_generation_jobs_stale_running_idx")
      .on(table.heartbeatAt)
      .where(sql`${table.status} = 'running'`),
    check("ai_generation_jobs_kind_check", sql`${table.kind} in ('text_to_image', 'image_to_image')`),
    check(
      "ai_generation_jobs_status_check",
      sql`${table.status} in ('preparing', 'queued', 'running', 'cancel_requested', 'cancelled', 'succeeded', 'failed')`,
    ),
    check("ai_generation_jobs_dimensions_check", sql`${table.width} between 256 and 3840 and ${table.height} between 256 and 3840`),
    check("ai_generation_jobs_quality_check", sql`${table.quality} in ('auto', 'low', 'medium', 'high')`),
    check("ai_generation_jobs_count_check", sql`${table.imageCount} between 1 and 4`),
    check("ai_generation_jobs_attempts_check", sql`${table.attempts} >= 0 and ${table.maxAttempts} between 1 and 5`),
    check("ai_generation_jobs_progress_check", sql`${table.progress} between 0 and 100`),
  ],
);

export const aiGenerationAssets = pgTable(
  "ai_generation_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    storageProvider: text("storage_provider").notNull(),
    objectKey: text("object_key").notNull(),
    displayUrl: text("display_url").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.jobId, table.userId],
      foreignColumns: [aiGenerationJobs.id, aiGenerationJobs.userId],
      name: "ai_generation_assets_job_owner_fk",
    }).onDelete("cascade"),
    uniqueIndex("ai_generation_assets_job_role_ordinal_unique").on(table.jobId, table.role, table.ordinal),
    index("ai_generation_assets_user_job_idx").on(table.userId, table.jobId),
    index("ai_generation_assets_provider_key_idx").on(table.storageProvider, table.objectKey),
    check("ai_generation_assets_role_check", sql`${table.role} in ('reference', 'result')`),
    check("ai_generation_assets_ordinal_check", sql`${table.ordinal} >= 0`),
    check("ai_generation_assets_dimensions_check", sql`${table.width} > 0 and ${table.height} > 0 and ${table.sizeBytes} > 0`),
  ],
);

export const aiProviderConnectionsRelations = relations(
  aiProviderConnections,
  ({ many, one }) => ({
    owner: one(user, {
      fields: [aiProviderConnections.userId],
      references: [user.id],
    }),
    models: many(aiModelProfiles),
  }),
);

export const aiModelProfilesRelations = relations(aiModelProfiles, ({ many, one }) => ({
  connection: one(aiProviderConnections, {
    fields: [aiModelProfiles.connectionId],
    references: [aiProviderConnections.id],
  }),
  preferences: many(aiModelPreferences),
  generationJobs: many(aiGenerationJobs),
}));
export const aiModelPreferencesRelations = relations(aiModelPreferences, ({ one }) => ({
  model: one(aiModelProfiles, {
    fields: [aiModelPreferences.modelProfileId],
    references: [aiModelProfiles.id],
  }),
}));

export const aiGenerationJobsRelations = relations(aiGenerationJobs, ({ many, one }) => ({
  model: one(aiModelProfiles, {
    fields: [aiGenerationJobs.modelProfileId],
    references: [aiModelProfiles.id],
  }),
  assets: many(aiGenerationAssets),
}));

export const aiGenerationAssetsRelations = relations(aiGenerationAssets, ({ one }) => ({
  job: one(aiGenerationJobs, {
    fields: [aiGenerationAssets.jobId],
    references: [aiGenerationJobs.id],
  }),
}));
