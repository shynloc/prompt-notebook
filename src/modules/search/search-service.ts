import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { promptNotes } from "@/db/schema";

export class SearchService {
  async duplicates(userId: string, noteId?: string) {
    const groups = await db
      .select({ contentHash: promptNotes.contentHash, count: sql<number>`count(*)::int`, latestAt: sql<Date>`max(${promptNotes.updatedAt})` })
      .from(promptNotes)
      .where(and(eq(promptNotes.userId, userId), isNull(promptNotes.deletedAt), sql`${promptNotes.contentHash} is not null`))
      .groupBy(promptNotes.contentHash)
      .having(sql`count(*) > 1`)
      .orderBy(desc(sql`max(${promptNotes.updatedAt})`))
      .limit(50);
    const hashes = groups.map(({ contentHash }) => contentHash).filter((value): value is string => Boolean(value));
    const exactNotes = hashes.length ? await db.select({ id: promptNotes.id, title: promptNotes.title, contentHash: promptNotes.contentHash, updatedAt: promptNotes.updatedAt }).from(promptNotes)
      .where(and(eq(promptNotes.userId, userId), isNull(promptNotes.deletedAt), inArray(promptNotes.contentHash, hashes))).orderBy(desc(promptNotes.updatedAt)).limit(500) : [];
    let similar: Array<{ id: string; title: string; similarity: number }> = [];
    if (noteId) {
      const [target] = await db.select({ prompt: promptNotes.prompt }).from(promptNotes).where(and(eq(promptNotes.id, noteId), eq(promptNotes.userId, userId), isNull(promptNotes.deletedAt))).limit(1);
      if (target) similar = await db.select({ id: promptNotes.id, title: promptNotes.title, similarity: sql<number>`similarity(${promptNotes.prompt}, ${target.prompt})` }).from(promptNotes)
        .where(and(eq(promptNotes.userId, userId), isNull(promptNotes.deletedAt), sql`${promptNotes.id} <> ${noteId}`, sql`${promptNotes.prompt} % ${target.prompt}`))
        .orderBy(desc(sql`similarity(${promptNotes.prompt}, ${target.prompt})`)).limit(20);
    }
    return { groups: groups.map((group) => ({ ...group, notes: exactNotes.filter((note) => note.contentHash === group.contentHash) })), similar };
  }
}
