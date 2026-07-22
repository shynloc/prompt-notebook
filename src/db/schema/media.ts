import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
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
