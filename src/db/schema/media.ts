import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const mediaStorageSettings = pgTable(
  "media_storage_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    providerType: text("provider_type").default("picbed").notNull(),
    endpoint: text("endpoint").notNull(),
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
    check("media_storage_settings_provider_check", sql`${table.providerType} in ('picbed')`),
    check(
      "media_storage_settings_test_status_check",
      sql`${table.lastTestStatus} is null or ${table.lastTestStatus} in ('success', 'failed')`,
    ),
  ],
);

// Keep the legacy encrypted Picbed row intact when users select local storage.
export const mediaStoragePreferences = pgTable("media_storage_preferences", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  providerType: text("provider_type").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [check("media_storage_preferences_provider_check", sql`${table.providerType} in ('local', 'picbed')`)]);

export const localMediaObjects = pgTable("local_media_objects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("local_media_objects_owner_created_idx").on(table.userId, table.createdAt),
  check("local_media_objects_mime_check", sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
  check("local_media_objects_size_check", sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 33554432`),
  check("local_media_objects_dimensions_check", sql`${table.width} > 0 and ${table.height} > 0`),
]);
