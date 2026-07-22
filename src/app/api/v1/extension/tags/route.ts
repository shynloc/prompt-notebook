import { and, asc, count, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { noteTags, tags } from "@/db/schema";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireExtensionSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const principal = await requireExtensionSession(request);
    const rows = await db.select({ id: tags.id, name: tags.name, count: count(noteTags.noteId) })
      .from(tags)
      .leftJoin(noteTags, and(eq(noteTags.tagId, tags.id), eq(noteTags.userId, principal.userId)))
      .where(eq(tags.userId, principal.userId))
      .groupBy(tags.id)
      .orderBy(asc(tags.name));
    return dataResponse(rows);
  } catch (error) {
    return errorResponse(error);
  }
}

