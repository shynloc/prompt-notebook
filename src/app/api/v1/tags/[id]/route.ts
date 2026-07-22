import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { noteTags, tags } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { tagIdSchema, updateTagSchema } from "@/modules/tags/tag-schema";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const id = tagIdSchema.parse((await context.params).id);
    const input = updateTagSchema.parse(await request.json());
    const [source] = await db.select().from(tags).where(and(eq(tags.id, id), eq(tags.userId, session.user.id))).limit(1);
    if (!source) throw new ApiError(404, "NOT_FOUND", "标签不存在");

    if ("name" in input) {
      const [updated] = await db.update(tags).set({ name: input.name }).where(and(eq(tags.id, id), eq(tags.userId, session.user.id))).returning();
      return dataResponse(updated);
    }

    if (input.mergeIntoId === id) throw new ApiError(422, "INVALID_MERGE", "不能合并到同一标签");
    const result = await db.transaction(async (tx) => {
      const [target] = await tx.select().from(tags).where(and(eq(tags.id, input.mergeIntoId), eq(tags.userId, session.user.id))).limit(1);
      if (!target) throw new ApiError(404, "NOT_FOUND", "目标标签不存在");
      const links = await tx.select({ noteId: noteTags.noteId }).from(noteTags).where(and(eq(noteTags.tagId, id), eq(noteTags.userId, session.user.id)));
      if (links.length) {
        await tx.insert(noteTags).values(links.map((link) => ({ noteId: link.noteId, tagId: target.id, userId: session.user.id }))).onConflictDoNothing();
      }
      await tx.delete(tags).where(and(eq(tags.id, id), eq(tags.userId, session.user.id)));
      return target;
    });
    return dataResponse(result);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return errorResponse(new ApiError(409, "TAG_EXISTS", "标签已经存在"));
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const id = tagIdSchema.parse((await context.params).id);
    const [deleted] = await db.delete(tags).where(and(eq(tags.id, id), eq(tags.userId, session.user.id))).returning();
    if (!deleted) throw new ApiError(404, "NOT_FOUND", "标签不存在");
    return dataResponse({ id: deleted.id });
  } catch (error) {
    return errorResponse(error);
  }
}
