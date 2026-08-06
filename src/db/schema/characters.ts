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
import { aiGenerationAssets, aiGenerationJobs } from "./ai";
import { promptNotes } from "./notes";

export type CharacterAttributes = Record<string, string | number | boolean | string[]>;

export const characterProfiles = pgTable(
  "character_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    summary: text("summary").default("").notNull(),
    roleDefinition: text("role_definition").notNull(),
    useCases: text("use_cases").array().default([]).notNull(),
    appearance: text("appearance").default("").notNull(),
    promptAnchor: text("prompt_anchor").default("").notNull(),
    negativePrompt: text("negative_prompt").default("").notNull(),
    rightsNote: text("rights_note").default("").notNull(),
    attributes: jsonb("attributes").$type<CharacterAttributes>().default({}).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("character_profiles_id_user_unique").on(table.id, table.userId),
    index("character_profiles_user_name_idx").on(table.userId, table.name),
    index("character_profiles_user_status_updated_idx").on(table.userId, table.deletedAt, table.archivedAt, table.updatedAt.desc()),
    check("character_profiles_version_check", sql`${table.version} > 0`),
  ],
);

export const characterProfileImages = pgTable(
  "character_profile_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id").notNull(),
    userId: text("user_id").notNull(),
    storageProvider: text("storage_provider").notNull(),
    objectKey: text("object_key").notNull(),
    displayUrl: text("display_url").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    viewType: text("view_type").default("other").notNull(),
    caption: text("caption").default("").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    isCover: boolean("is_cover").default(false).notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    focusX: integer("focus_x").default(50).notNull(),
    focusY: integer("focus_y").default(50).notNull(),
    status: text("status").default("ready").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>().default({}).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("character_profile_images_id_user_unique").on(table.id, table.userId),
    foreignKey({
      columns: [table.profileId, table.userId],
      foreignColumns: [characterProfiles.id, characterProfiles.userId],
      name: "character_profile_images_profile_owner_fk",
    }).onDelete("cascade"),
    uniqueIndex("character_profile_images_profile_order_unique").on(table.profileId, table.sortOrder).where(sql`${table.deletedAt} is null`),
    uniqueIndex("character_profile_images_one_cover_unique").on(table.profileId).where(sql`${table.isCover} = true and ${table.deletedAt} is null`),
    uniqueIndex("character_profile_images_one_primary_unique").on(table.profileId).where(sql`${table.isPrimary} = true and ${table.deletedAt} is null`),
    index("character_profile_images_user_profile_idx").on(table.userId, table.profileId),
    check("character_profile_images_provider_check", sql`${table.storageProvider} in ('picbed', 'external')`),
    check("character_profile_images_mime_check", sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')`),
    check("character_profile_images_view_check", sql`${table.viewType} in ('portrait', 'half_body', 'full_body', 'left', 'right', 'back', 'expression', 'outfit', 'other')`),
    check("character_profile_images_status_check", sql`${table.status} in ('ready', 'failed')`),
    check("character_profile_images_dimensions_check", sql`${table.width} > 0 and ${table.height} > 0 and ${table.sizeBytes} >= 0`),
    check("character_profile_images_focus_check", sql`${table.focusX} between 0 and 100 and ${table.focusY} between 0 and 100`),
  ],
);

export const noteCharacterProfiles = pgTable(
  "note_character_profiles",
  {
    noteId: uuid("note_id").notNull(),
    profileId: uuid("profile_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").default("primary").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.profileId] }),
    foreignKey({
      columns: [table.noteId, table.userId],
      foreignColumns: [promptNotes.id, promptNotes.userId],
      name: "note_character_profiles_note_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.profileId, table.userId],
      foreignColumns: [characterProfiles.id, characterProfiles.userId],
      name: "note_character_profiles_profile_owner_fk",
    }).onDelete("cascade"),
    uniqueIndex("note_character_profiles_note_order_unique").on(table.noteId, table.sortOrder),
    uniqueIndex("note_character_profiles_one_primary_unique").on(table.noteId).where(sql`${table.role} = 'primary'`),
    index("note_character_profiles_user_profile_idx").on(table.userId, table.profileId, table.noteId),
    check("note_character_profiles_role_check", sql`${table.role} in ('primary', 'supporting', 'reference')`),
    check("note_character_profiles_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

export const generationCharacterReferences = pgTable(
  "generation_character_references",
  {
    jobId: uuid("job_id").notNull(),
    generationAssetId: uuid("generation_asset_id").notNull(),
    userId: text("user_id").notNull(),
    profileId: uuid("profile_id").notNull(),
    profileImageId: uuid("profile_image_id").notNull(),
    profileNameSnapshot: text("profile_name_snapshot").notNull(),
    profileVersionSnapshot: integer("profile_version_snapshot").notNull(),
    viewTypeSnapshot: text("view_type_snapshot").notNull(),
    role: text("role").default("primary").notNull(),
    ordinal: integer("ordinal").notNull(),
    parameters: jsonb("parameters").$type<Record<string, string | number | boolean>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.ordinal] }),
    foreignKey({
      columns: [table.jobId, table.userId],
      foreignColumns: [aiGenerationJobs.id, aiGenerationJobs.userId],
      name: "generation_character_references_job_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.generationAssetId, table.jobId, table.userId],
      foreignColumns: [aiGenerationAssets.id, aiGenerationAssets.jobId, aiGenerationAssets.userId],
      name: "generation_character_references_asset_job_owner_fk",
    }).onDelete("cascade"),
    uniqueIndex("generation_character_references_asset_unique").on(table.generationAssetId),
    index("generation_character_references_user_profile_idx").on(table.userId, table.profileId, table.createdAt.desc()),
    check("generation_character_references_ordinal_check", sql`${table.ordinal} >= 0 and ${table.ordinal} < 4`),
    check("generation_character_references_role_check", sql`${table.role} in ('primary', 'supporting', 'reference')`),
  ],
);

export const characterProfilesRelations = relations(characterProfiles, ({ many, one }) => ({
  owner: one(user, { fields: [characterProfiles.userId], references: [user.id] }),
  images: many(characterProfileImages),
  notes: many(noteCharacterProfiles),
}));

export const characterProfileImagesRelations = relations(characterProfileImages, ({ one }) => ({
  profile: one(characterProfiles, { fields: [characterProfileImages.profileId], references: [characterProfiles.id] }),
}));

export const noteCharacterProfilesRelations = relations(noteCharacterProfiles, ({ one }) => ({
  profile: one(characterProfiles, { fields: [noteCharacterProfiles.profileId], references: [characterProfiles.id] }),
  note: one(promptNotes, { fields: [noteCharacterProfiles.noteId], references: [promptNotes.id] }),
}));
