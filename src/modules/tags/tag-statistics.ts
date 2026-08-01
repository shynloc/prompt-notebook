import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { noteTags, promptNotes, tags } from "@/db/schema";

export interface TagStatistic {
  id: string;
  name: string;
  noteCount: number;
}

export async function listActiveTagStatistics(userId: string): Promise<TagStatistic[]> {
  const noteCount = sql<number>`count(${promptNotes.id})::int`;
  const rows = await db
    .select({ id: tags.id, name: tags.name, noteCount })
    .from(tags)
    .leftJoin(
      noteTags,
      and(eq(noteTags.tagId, tags.id), eq(noteTags.userId, userId)),
    )
    .leftJoin(
      promptNotes,
      and(
        eq(promptNotes.id, noteTags.noteId),
        eq(promptNotes.userId, userId),
        isNull(promptNotes.deletedAt),
        isNull(promptNotes.archivedAt),
      ),
    )
    .where(eq(tags.userId, userId))
    .groupBy(tags.id, tags.name)
    .orderBy(desc(noteCount), asc(tags.name));

  return rows.map((row) => ({ ...row, noteCount: Number(row.noteCount) }));
}
