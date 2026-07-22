import { and, count, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { noteProjects, projects } from "@/db/schema";

export class ProjectService {
  async list(userId: string) {
    return db.select({ id: projects.id, name: projects.name, description: projects.description, smartFilter: projects.smartFilter, updatedAt: projects.updatedAt, noteCount: count(noteProjects.noteId) })
      .from(projects).leftJoin(noteProjects, and(eq(noteProjects.projectId, projects.id), eq(noteProjects.userId, userId)))
      .where(eq(projects.userId, userId)).groupBy(projects.id).orderBy(desc(projects.updatedAt));
  }

  async create(userId: string, input: { name: string; description?: string; smartFilter?: Record<string, unknown> | null }) {
    const [created] = await db.insert(projects).values({ userId, name: input.name, description: input.description ?? "", smartFilter: input.smartFilter ?? null }).returning();
    return created;
  }
}
