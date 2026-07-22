import { and, asc, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  operationalEvents,
  promptImages,
  promptNotes,
  tags,
  user,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { auth } from "@/lib/auth/server";

const MAX_TRASH_PURGE = 500;

export class AccountService {
  async status(userId: string) {
    const [noteCounts, imageCounts, tagCounts, latestBackup] = await Promise.all([
      db
        .select({
          active: sql<number>`count(*) filter (where ${promptNotes.deletedAt} is null and ${promptNotes.archivedAt} is null)::int`,
          archived: sql<number>`count(*) filter (where ${promptNotes.deletedAt} is null and ${promptNotes.archivedAt} is not null)::int`,
          trash: sql<number>`count(*) filter (where ${promptNotes.deletedAt} is not null)::int`,
        })
        .from(promptNotes)
        .where(eq(promptNotes.userId, userId)),
      db
        .select({
          images: count(),
          bytes: sql<number>`coalesce(sum(${promptImages.sizeBytes}), 0)::bigint`,
        })
        .from(promptImages)
        .where(eq(promptImages.userId, userId)),
      db.select({ tags: count() }).from(tags).where(eq(tags.userId, userId)),
      db
        .select({ status: operationalEvents.status, details: operationalEvents.details, createdAt: operationalEvents.createdAt })
        .from(operationalEvents)
        .where(eq(operationalEvents.eventType, "backup"))
        .orderBy(desc(operationalEvents.createdAt))
        .limit(1),
    ]);

    return {
      notes: noteCounts[0] ?? { active: 0, archived: 0, trash: 0 },
      images: Number(imageCounts[0]?.images ?? 0),
      referencedImageBytes: Number(imageCounts[0]?.bytes ?? 0),
      tags: Number(tagCounts[0]?.tags ?? 0),
      latestBackup: latestBackup[0] ?? null,
    };
  }

  async emptyTrash(userId: string, requestedLimit = MAX_TRASH_PURGE) {
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_TRASH_PURGE);
    const candidates = await db
      .select({ id: promptNotes.id })
      .from(promptNotes)
      .where(and(eq(promptNotes.userId, userId), isNotNull(promptNotes.deletedAt)))
      .orderBy(asc(promptNotes.deletedAt), asc(promptNotes.id))
      .limit(limit);

    if (candidates.length) {
      await db
        .delete(promptNotes)
        .where(and(eq(promptNotes.userId, userId), inArray(promptNotes.id, candidates.map(({ id }) => id))));
    }

    const [remaining] = await db
      .select({ count: count() })
      .from(promptNotes)
      .where(and(eq(promptNotes.userId, userId), isNotNull(promptNotes.deletedAt)));
    return { deleted: candidates.length, remaining: Number(remaining?.count ?? 0), limit };
  }

  async mediaIntegrity(userId: string) {
    const [summary] = await db
      .select({
        references: count(),
        brokenMetadata: sql<number>`count(*) filter (where ${promptImages.displayUrl} = '' or ${promptImages.thumbnailUrl} = '' or ${promptImages.width} <= 0 or ${promptImages.height} <= 0 or ${promptImages.status} <> 'ready')::int`,
        externalReferences: sql<number>`count(*) filter (where ${promptImages.storageProvider} in ('external', 'url', 'remote'))::int`,
      })
      .from(promptImages)
      .where(eq(promptImages.userId, userId));
    const duplicateObjects = await db
      .select({
        storageProvider: promptImages.storageProvider,
        objectKey: promptImages.objectKey,
        references: count(),
      })
      .from(promptImages)
      .where(eq(promptImages.userId, userId))
      .groupBy(promptImages.storageProvider, promptImages.objectKey)
      .having(sql`count(*) > 1`)
      .limit(100);

    return {
      references: Number(summary?.references ?? 0),
      brokenMetadata: Number(summary?.brokenMetadata ?? 0),
      externalReferences: Number(summary?.externalReferences ?? 0),
      orphanCandidates: duplicateObjects,
      remoteDeletionSupported: false,
      note: "图床未提供可靠删除接口；这里只报告引用问题，不会自动删除远端对象。",
    };
  }

  async deleteAccount(request: Request, userId: string, password: string, confirmation: string) {
    if (confirmation !== "DELETE MY ACCOUNT") {
      throw new ApiError(422, "CONFIRMATION_MISMATCH", "请输入 DELETE MY ACCOUNT 以确认删除");
    }
    try {
      await auth.api.verifyPassword({ headers: request.headers, body: { password } });
    } catch {
      throw new ApiError(400, "INVALID_PASSWORD", "当前密码不正确");
    }
    const deleted = await db.transaction(async (tx) =>
      tx.delete(user).where(eq(user.id, userId)).returning({ id: user.id }),
    );
    if (!deleted.length) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "账户不存在");
    return { deleted: true };
  }
}
