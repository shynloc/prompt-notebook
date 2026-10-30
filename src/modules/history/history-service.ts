import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { noteVersions } from "@/db/schema";

export class HistoryService {
  async list(userId: string, noteId: string) {
    return db.select().from(noteVersions)
      .where(and(eq(noteVersions.userId, userId), eq(noteVersions.noteId, noteId)))
      .orderBy(desc(noteVersions.createdAt)).limit(50);
  }
}
