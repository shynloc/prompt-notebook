import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { promptImages } from "@/db/schema";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { localImageView } from "@/modules/media/local-media-store";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const rows = await db
      .selectDistinctOn([promptImages.displayUrl])
      .from(promptImages)
      .where(eq(promptImages.userId, session.user.id))
      .orderBy(promptImages.displayUrl, desc(promptImages.createdAt))
      .limit(60);
    return dataResponse(rows.map((image) => localImageView(session.user.id, image)));
  } catch (error) {
    return errorResponse(error);
  }
}
