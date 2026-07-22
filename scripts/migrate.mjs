import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = postgres(databaseUrl, { max: 1, prepare: false });
const database = drizzle(client);
const migrationsFolder = fileURLToPath(
  new URL("../src/db/migrations", import.meta.url),
);

try {
  await migrate(database, { migrationsFolder });
  console.info("Database migrations completed");
} finally {
  await client.end();
}
