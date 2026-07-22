import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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

export const promptNotes = pgTable(
  "prompt_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    model: text("model"),
    sourceUrl: text("source_url"),
    sourceTitle: text("source_title"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    captureMethod: text("capture_method"),
    contentHash: text("content_hash"),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().default({}).notNull(),
    favorite: boolean("favorite").default(false).notNull(),
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
    unique("prompt_notes_id_user_unique").on(table.id, table.userId),
    index("prompt_notes_user_updated_idx").on(table.userId, table.updatedAt.desc()),
    index("prompt_notes_user_favorite_updated_idx").on(
      table.userId,
      table.favorite,
      table.updatedAt.desc(),
    ),
    index("prompt_notes_user_deleted_archived_idx").on(
      table.userId,
      table.deletedAt,
      table.archivedAt,
    ),
    index("prompt_notes_user_active_updated_idx")
      .on(table.userId, table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} is null and ${table.archivedAt} is null`),
    index("prompt_notes_user_content_hash_idx")
      .on(table.userId, table.contentHash)
      .where(sql`${table.deletedAt} is null and ${table.contentHash} is not null`),
    index("prompt_notes_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
    index("prompt_notes_prompt_trgm_idx").using("gin", sql`${table.prompt} gin_trgm_ops`),
  ],
);

export const promptImages = pgTable(
  "prompt_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull(),
    userId: text("user_id").notNull(),
    storageProvider: text("storage_provider").notNull(),
    objectKey: text("object_key").notNull(),
    displayUrl: text("display_url").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    isCover: boolean("is_cover").default(false).notNull(),
    status: text("status").default("ready").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.noteId, table.userId],
      foreignColumns: [promptNotes.id, promptNotes.userId],
      name: "prompt_images_note_owner_fk",
    }).onDelete("cascade"),
    uniqueIndex("prompt_images_note_order_unique").on(table.noteId, table.sortOrder),
    uniqueIndex("prompt_images_one_cover_unique")
      .on(table.noteId)
      .where(sql`${table.isCover} = true`),
    index("prompt_images_provider_key_idx").on(
      table.storageProvider,
      table.objectKey,
    ),
    index("prompt_images_user_idx").on(table.userId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("tags_id_user_unique").on(table.id, table.userId),
    uniqueIndex("tags_user_name_unique").on(table.userId, table.name),
  ],
);

export const noteTags = pgTable(
  "note_tags",
  {
    noteId: uuid("note_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.tagId] }),
    foreignKey({
      columns: [table.noteId, table.userId],
      foreignColumns: [promptNotes.id, promptNotes.userId],
      name: "note_tags_note_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tagId, table.userId],
      foreignColumns: [tags.id, tags.userId],
      name: "note_tags_tag_owner_fk",
    }).onDelete("cascade"),
    index("note_tags_user_idx").on(table.userId),
  ],
);

export const promptNotesRelations = relations(promptNotes, ({ many, one }) => ({
  owner: one(user, { fields: [promptNotes.userId], references: [user.id] }),
  images: many(promptImages),
  noteTags: many(noteTags),
}));

export const promptImagesRelations = relations(promptImages, ({ one }) => ({
  note: one(promptNotes, {
    fields: [promptImages.noteId],
    references: [promptNotes.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({ noteTags: many(noteTags) }));

export const noteTagsRelations = relations(noteTags, ({ one }) => ({
  note: one(promptNotes, { fields: [noteTags.noteId], references: [promptNotes.id] }),
  tag: one(tags, { fields: [noteTags.tagId], references: [tags.id] }),
}));
