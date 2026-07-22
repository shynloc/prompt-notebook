import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { noteVersions, promptNotes } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

const restorableFields = ["title", "prompt", "negativePrompt", "model", "sourceUrl", "sourceTitle", "capturedAt", "captureMethod", "parameters", "favorite", "archivedAt"] as const;

export class HistoryService {
  async list(userId: string, noteId: string) {
    return db.select().from(noteVersions)
      .where(and(eq(noteVersions.userId, userId), eq(noteVersions.noteId, noteId)))
      .orderBy(desc(noteVersions.createdAt)).limit(50);
  }

  async restore(userId: string, noteId: string, versionId: string, expectedVersion: number) {
    const result = await db.transaction(async (tx) => {
      const [historical] = await tx.select().from(noteVersions)
        .where(and(eq(noteVersions.id, versionId), eq(noteVersions.noteId, noteId), eq(noteVersions.userId, userId))).limit(1);
      if (!historical) return { kind: "missing" as const };
      const [current] = await tx.select().from(promptNotes)
        .where(and(eq(promptNotes.id, noteId), eq(promptNotes.userId, userId), eq(promptNotes.version, expectedVersion), isNull(promptNotes.deletedAt))).limit(1);
      if (!current) return { kind: "conflict" as const };
      await tx.insert(noteVersions).values({ noteId, userId, version: current.version, snapshot: current }).onConflictDoNothing();
      const snapshot = historical.snapshot;
      const changes: Record<string, unknown> = {};
      for (const field of restorableFields) if (field in snapshot) changes[field] = snapshot[field];
      const [restored] = await tx.update(promptNotes).set({ ...changes, version: sql`${promptNotes.version} + 1`, updatedAt: new Date() })
        .where(and(eq(promptNotes.id, noteId), eq(promptNotes.userId, userId), eq(promptNotes.version, expectedVersion))).returning();
      return { kind: "restored" as const, note: restored };
    });
    if (result.kind === "missing") throw new ApiError(404, "VERSION_NOT_FOUND", "Version not found");
    if (result.kind === "conflict") throw new ApiError(409, "VERSION_CONFLICT", "The note changed before restore");
    return result.note;
  }
}
