import { relations } from "drizzle-orm";
import {
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
import { promptNotes } from "./notes";

export const noteVersions = pgTable(
  "note_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull(),
    userId: text("user_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.noteId, table.userId],
      foreignColumns: [promptNotes.id, promptNotes.userId],
      name: "note_versions_note_owner_fk",
    }).onDelete("cascade"),
    uniqueIndex("note_versions_note_version_unique").on(table.noteId, table.version),
    index("note_versions_user_note_created_idx").on(table.userId, table.noteId, table.createdAt.desc()),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    smartFilter: jsonb("smart_filter").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("projects_id_user_unique").on(table.id, table.userId),
    uniqueIndex("projects_user_name_unique").on(table.userId, table.name),
  ],
);

export const noteProjects = pgTable(
  "note_projects",
  {
    noteId: uuid("note_id").notNull(),
    projectId: uuid("project_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.projectId] }),
    foreignKey({ columns: [table.noteId, table.userId], foreignColumns: [promptNotes.id, promptNotes.userId], name: "note_projects_note_owner_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.projectId, table.userId], foreignColumns: [projects.id, projects.userId], name: "note_projects_project_owner_fk" }).onDelete("cascade"),
    index("note_projects_user_project_idx").on(table.userId, table.projectId),
  ],
);

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull(),
    variables: jsonb("variables").$type<string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("prompt_templates_user_name_unique").on(table.userId, table.name),
    index("prompt_templates_user_updated_idx").on(table.userId, table.updatedAt.desc()),
  ],
);

export const noteVersionsRelations = relations(noteVersions, ({ one }) => ({ note: one(promptNotes, { fields: [noteVersions.noteId], references: [promptNotes.id] }) }));
export const projectsRelations = relations(projects, ({ many }) => ({ notes: many(noteProjects) }));
