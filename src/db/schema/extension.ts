import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const extensionDevices = pgTable(
  "extension_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("extension_devices_user_idx").on(table.userId, table.createdAt)],
);

export const extensionAuthorizationCodes = pgTable(
  "extension_authorization_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeHash: text("code_hash").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    deviceName: text("device_name").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("extension_authorization_codes_hash_unique").on(table.codeHash),
    index("extension_authorization_codes_expiry_idx").on(table.expiresAt),
  ],
);

export const extensionAccessTokens = pgTable(
  "extension_access_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id").notNull().references(() => extensionDevices.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("extension_access_tokens_hash_unique").on(table.tokenHash),
    index("extension_access_tokens_expiry_idx").on(table.expiresAt),
  ],
);

export const extensionRefreshTokens = pgTable(
  "extension_refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id").notNull().references(() => extensionDevices.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("extension_refresh_tokens_hash_unique").on(table.tokenHash),
    index("extension_refresh_tokens_expiry_idx").on(table.expiresAt),
  ],
);

export const extensionDeviceRelations = relations(extensionDevices, ({ one, many }) => ({
  owner: one(user, { fields: [extensionDevices.userId], references: [user.id] }),
  accessTokens: many(extensionAccessTokens),
  refreshTokens: many(extensionRefreshTokens),
}));

export const extensionAccessTokenRelations = relations(extensionAccessTokens, ({ one }) => ({
  device: one(extensionDevices, { fields: [extensionAccessTokens.deviceId], references: [extensionDevices.id] }),
}));

export const extensionRefreshTokenRelations = relations(extensionRefreshTokens, ({ one }) => ({
  device: one(extensionDevices, { fields: [extensionRefreshTokens.deviceId], references: [extensionDevices.id] }),
}));

