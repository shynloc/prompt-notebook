import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { noteProjects, noteTags, projects, promptNotes, tags } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

export type BulkInput = {
  ids: string[];
  action: "favorite" | "unfavorite" | "archive" | "unarchive" | "delete" | "tag" | "project";
  tag?: string;
  projectId?: string;
};

export class BulkService {
  async apply(userId: string, input: BulkInput) {
    if (input.ids.length > 100) throw new ApiError(422, "BATCH_TOO_LARGE", "A batch can contain at most 100 notes");
    return db.transaction(async (tx) => {
      const owned = await tx.select({ id: promptNotes.id }).from(promptNotes)
        .where(and(eq(promptNotes.userId, userId), inArray(promptNotes.id, input.ids), isNull(promptNotes.deletedAt)));
      const ids = owned.map(({ id }) => id);
      if (!ids.length) return { updated: 0 };
      if (input.action === "favorite" || input.action === "unfavorite") await tx.update(promptNotes).set({ favorite: input.action === "favorite", updatedAt: new Date() }).where(and(eq(promptNotes.userId, userId), inArray(promptNotes.id, ids)));
      if (input.action === "archive" || input.action === "unarchive") await tx.update(promptNotes).set({ archivedAt: input.action === "archive" ? new Date() : null, updatedAt: new Date() }).where(and(eq(promptNotes.userId, userId), inArray(promptNotes.id, ids)));
      if (input.action === "delete") await tx.update(promptNotes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(promptNotes.userId, userId), inArray(promptNotes.id, ids)));
      if (input.action === "tag") {
        if (!input.tag) throw new ApiError(422, "TAG_REQUIRED", "A tag is required");
        await tx.insert(tags).values({ userId, name: input.tag }).onConflictDoNothing();
        const [tag] = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.userId, userId), eq(tags.name, input.tag))).limit(1);
        await tx.insert(noteTags).values(ids.map((noteId) => ({ noteId, tagId: tag.id, userId }))).onConflictDoNothing();
      }
      if (input.action === "project") {
        if (!input.projectId) throw new ApiError(422, "PROJECT_REQUIRED", "A project is required");
        const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.userId, userId))).limit(1);
        if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found");
        await tx.insert(noteProjects).values(ids.map((noteId) => ({ noteId, projectId: project.id, userId }))).onConflictDoNothing();
      }
      return { updated: ids.length };
    });
  }
}
