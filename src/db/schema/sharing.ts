import { foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid, boolean, integer } from "drizzle-orm/pg-core";

import { promptNotes } from "./notes";

export const noteShares = pgTable(
  "note_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    allowCopy: boolean("allow_copy").default(true).notNull(),
    includeImage: boolean("include_image").default(true).notNull(),
    includeSource: boolean("include_source").default(false).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    viewCount: integer("view_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.noteId, table.userId], foreignColumns: [promptNotes.id, promptNotes.userId], name: "note_shares_note_owner_fk" }).onDelete("cascade"),
    uniqueIndex("note_shares_token_hash_unique").on(table.tokenHash),
    index("note_shares_user_note_created_idx").on(table.userId, table.noteId, table.createdAt.desc()),
    index("note_shares_expiry_idx").on(table.expiresAt),
  ],
);
