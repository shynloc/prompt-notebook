import { sql as query } from "drizzle-orm";

import { db } from "@/db/client";

export async function GET() {
  try {
    await db.execute(query`select 1`);
    return Response.json(
      { status: "ready" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
