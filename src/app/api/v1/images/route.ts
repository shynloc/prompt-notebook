import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { promptImages } from "@/db/schema";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const rows = await db
      .selectDistinctOn([promptImages.displayUrl])
      .from(promptImages)
      .where(eq(promptImages.userId, session.user.id))
      .orderBy(promptImages.displayUrl, desc(promptImages.createdAt))
      .limit(60);
    return dataResponse(rows);
  } catch (error) {
    return errorResponse(error);
  }
}
