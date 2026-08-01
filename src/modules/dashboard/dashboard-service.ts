import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  customTerms,
  noteShares,
  projects,
  promptNotes,
  tags,
} from "@/db/schema";
import type { DashboardSnapshot } from "@/modules/dashboard/dashboard-types";
import { listActiveTagStatistics } from "@/modules/tags/tag-statistics";
import builtInTerms from "@/modules/terms/built-in-terms.json";

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class DashboardService {
  async snapshot(userId: string): Promise<DashboardSnapshot> {
    const now = new Date();
    const [noteRows, shareRows, tagRows, projectRows, customTermRows, tagStatistics] = await Promise.all([
      db
        .select({
          totalNotes: sql<number>`count(*) filter (where ${promptNotes.deletedAt} is null)::int`,
          totalFavorites: sql<number>`count(*) filter (where ${promptNotes.deletedAt} is null and ${promptNotes.archivedAt} is null and ${promptNotes.favorite} = true)::int`,
          trashNotes: sql<number>`count(*) filter (where ${promptNotes.deletedAt} is not null)::int`,
          totalPromptCharacters: sql<number>`coalesce(sum(char_length(${promptNotes.prompt}) + char_length(coalesce(${promptNotes.negativePrompt}, ''))) filter (where ${promptNotes.deletedAt} is null), 0)::bigint`,
        })
        .from(promptNotes)
        .where(eq(promptNotes.userId, userId)),
      db
        .select({
          activeSharedNotes: sql<number>`count(distinct ${noteShares.noteId})::int`,
        })
        .from(noteShares)
        .innerJoin(
          promptNotes,
          and(
            eq(promptNotes.id, noteShares.noteId),
            eq(promptNotes.userId, noteShares.userId),
          ),
        )
        .where(and(
          eq(noteShares.userId, userId),
          isNull(noteShares.revokedAt),
          gt(noteShares.expiresAt, now),
          isNull(promptNotes.deletedAt),
        )),
      db.select({ totalTags: count() }).from(tags).where(eq(tags.userId, userId)),
      db.select({ totalProjects: count() }).from(projects).where(eq(projects.userId, userId)),
      db.select({ customTerms: count() }).from(customTerms).where(eq(customTerms.userId, userId)),
      listActiveTagStatistics(userId),
    ]);

    const notes = noteRows[0];
    const shares = shareRows[0];
    return {
      summary: {
        totalNotes: numeric(notes?.totalNotes),
        activeSharedNotes: numeric(shares?.activeSharedNotes),
        totalTags: numeric(tagRows[0]?.totalTags),
        totalTerms: builtInTerms.length + numeric(customTermRows[0]?.customTerms),
        totalFavorites: numeric(notes?.totalFavorites),
        totalProjects: numeric(projectRows[0]?.totalProjects),
        trashNotes: numeric(notes?.trashNotes),
        totalPromptCharacters: numeric(notes?.totalPromptCharacters),
      },
      tags: tagStatistics,
    };
  }
}
