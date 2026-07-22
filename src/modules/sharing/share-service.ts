import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { noteShares, promptImages, promptNotes } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

const attempts = new Map<string, { count: number; resetAt: number }>();
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function checkRateLimit(key: string) {
  const now = Date.now(); const current = attempts.get(key);
  if (!current || current.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + 60_000 }); return; }
  current.count += 1;
  if (current.count > 60) throw new ApiError(429, "RATE_LIMITED", "Too many share requests");
}

export class ShareService {
  async list(userId: string, noteId?: string) {
    return db.select({ id: noteShares.id, noteId: noteShares.noteId, allowCopy: noteShares.allowCopy, includeImage: noteShares.includeImage, includeSource: noteShares.includeSource, expiresAt: noteShares.expiresAt, revokedAt: noteShares.revokedAt, viewCount: noteShares.viewCount, createdAt: noteShares.createdAt })
      .from(noteShares).where(and(eq(noteShares.userId, userId), noteId ? eq(noteShares.noteId, noteId) : undefined)).orderBy(desc(noteShares.createdAt)).limit(100);
  }

  async create(userId: string, input: { noteId: string; expiresInDays: number; allowCopy: boolean; includeImage: boolean; includeSource: boolean }) {
    const [note] = await db.select({ id: promptNotes.id }).from(promptNotes).where(and(eq(promptNotes.id, input.noteId), eq(promptNotes.userId, userId), isNull(promptNotes.deletedAt))).limit(1);
    if (!note) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found");
    const token = randomBytes(32).toString("base64url");
    const [share] = await db.insert(noteShares).values({ ...input, userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000) }).returning({ id: noteShares.id, expiresAt: noteShares.expiresAt });
    return { ...share, token };
  }

  async revoke(userId: string, id: string) {
    const [share] = await db.update(noteShares).set({ revokedAt: new Date() }).where(and(eq(noteShares.id, id), eq(noteShares.userId, userId), isNull(noteShares.revokedAt))).returning({ id: noteShares.id });
    if (!share) throw new ApiError(404, "SHARE_NOT_FOUND", "Share not found");
    return { revoked: true };
  }

  async publicRead(token: string, clientKey = "anonymous") {
    checkRateLimit(clientKey);
    const [row] = await db.select({ share: noteShares, note: promptNotes }).from(noteShares).innerJoin(promptNotes, and(eq(promptNotes.id, noteShares.noteId), eq(promptNotes.userId, noteShares.userId)))
      .where(and(eq(noteShares.tokenHash, hashToken(token)), isNull(noteShares.revokedAt), gt(noteShares.expiresAt, new Date()), isNull(promptNotes.deletedAt))).limit(1);
    if (!row) throw new ApiError(404, "SHARE_NOT_FOUND", "This share is unavailable or expired");
    const [image] = row.share.includeImage ? await db.select({ displayUrl: promptImages.displayUrl, width: promptImages.width, height: promptImages.height }).from(promptImages).where(and(eq(promptImages.noteId, row.note.id), eq(promptImages.userId, row.note.userId))).orderBy(desc(promptImages.isCover)).limit(1) : [];
    await db.update(noteShares).set({ viewCount: sql`${noteShares.viewCount} + 1` }).where(eq(noteShares.id, row.share.id));
    return { title: row.note.title, prompt: row.note.prompt, negativePrompt: row.note.negativePrompt, allowCopy: row.share.allowCopy, image: image ?? null, source: row.share.includeSource ? { url: row.note.sourceUrl, title: row.note.sourceTitle } : null, expiresAt: row.share.expiresAt };
  }
}
