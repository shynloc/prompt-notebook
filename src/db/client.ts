import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

const globalForDatabase = globalThis as typeof globalThis & {
  promptNotebookSql?: ReturnType<typeof postgres>;
};

function createSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return postgres(databaseUrl, {
    max: process.env.NODE_ENV === "production" ? 10 : 5,
    prepare: false,
  });
}

export const sql = globalForDatabase.promptNotebookSql ?? createSqlClient();

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.promptNotebookSql = sql;
}

export const db = drizzle(sql, { schema });
