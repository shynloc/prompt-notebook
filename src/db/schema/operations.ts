import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const operationalEvents = pgTable(
  "operational_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("operational_events_type_created_idx").on(
      table.eventType,
      table.createdAt.desc(),
    ),
  ],
);
