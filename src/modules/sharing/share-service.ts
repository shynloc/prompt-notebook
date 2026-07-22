import { createHash, randomInt, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { noteShares, promptImages, promptNotes } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { decryptCredential, encryptCredential } from "@/modules/ai/credential-crypto";

const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAX_TOKEN_GENERATION_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function checkRateLimit(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  current.count += 1;
  if (current.count > 60) throw new ApiError(429, "RATE_LIMITED", "Too many share requests");
}

function shareCredentialContext(userId: string, shareId: string) {
  return { userId, connectionId: shareId, providerType: "read-only-share" };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function createShortShareToken(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return `${date}${code}`;
}

interface CreateShareInput {
  noteId: string;
  expiresInDays: number;
  allowCopy: boolean;
  includeImage: boolean;
  includeSource: boolean;
}

interface EncryptedShareTokenRow {
  id: string;
  userId: string;
  encryptedToken: string | null;
  tokenIv: string | null;
  tokenAuthTag: string | null;
  tokenKeyId: string | null;
}

function readEncryptedToken(row: EncryptedShareTokenRow) {
  if (!row.encryptedToken || !row.tokenIv || !row.tokenAuthTag || !row.tokenKeyId) return null;
  try {
    return decryptCredential(
      {
        encryptedSecret: row.encryptedToken,
        secretIv: row.tokenIv,
        secretAuthTag: row.tokenAuthTag,
        secretKeyId: row.tokenKeyId,
      },
      shareCredentialContext(row.userId, row.id),
    );
  } catch {
    return null;
  }
}

export class ShareService {
  async list(userId: string, noteId?: string) {
    const now = new Date();
    const rows = await db
      .select({
        id: noteShares.id,
        noteId: noteShares.noteId,
        userId: noteShares.userId,
        title: promptNotes.title,
        allowCopy: noteShares.allowCopy,
        includeImage: noteShares.includeImage,
        includeSource: noteShares.includeSource,
        expiresAt: noteShares.expiresAt,
        viewCount: noteShares.viewCount,
        createdAt: noteShares.createdAt,
        encryptedToken: noteShares.encryptedToken,
        tokenIv: noteShares.tokenIv,
        tokenAuthTag: noteShares.tokenAuthTag,
        tokenKeyId: noteShares.tokenKeyId,
      })
      .from(noteShares)
      .innerJoin(
        promptNotes,
        and(eq(promptNotes.id, noteShares.noteId), eq(promptNotes.userId, noteShares.userId)),
      )
      .where(
        and(
          eq(noteShares.userId, userId),
          noteId ? eq(noteShares.noteId, noteId) : undefined,
          isNull(noteShares.revokedAt),
          gt(noteShares.expiresAt, now),
          isNull(promptNotes.deletedAt),
        ),
      )
      .orderBy(desc(noteShares.createdAt))
      .limit(100);

    const noteIds = [...new Set(rows.map((row) => row.noteId))];
    const images = noteIds.length
      ? await db
          .select({ noteId: promptImages.noteId, thumbnailUrl: promptImages.thumbnailUrl })
          .from(promptImages)
          .where(
            and(
              eq(promptImages.userId, userId),
              eq(promptImages.isCover, true),
              inArray(promptImages.noteId, noteIds),
            ),
          )
      : [];
    const imageByNote = new Map(images.map((image) => [image.noteId, image.thumbnailUrl]));

    return rows.map((row) => ({
      id: row.id,
      noteId: row.noteId,
      title: row.title,
      previewImageUrl: imageByNote.get(row.noteId) ?? null,
      allowCopy: row.allowCopy,
      includeImage: row.includeImage,
      includeSource: row.includeSource,
      expiresAt: row.expiresAt,
      viewCount: row.viewCount,
      createdAt: row.createdAt,
      token: readEncryptedToken(row),
    }));
  }

  async create(userId: string, input: CreateShareInput) {
    const [note] = await db
      .select({ id: promptNotes.id })
      .from(promptNotes)
      .where(
        and(
          eq(promptNotes.id, input.noteId),
          eq(promptNotes.userId, userId),
          isNull(promptNotes.deletedAt),
        ),
      )
      .limit(1);
    if (!note) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found");

    const [existing] = await this.list(userId, input.noteId);
    if (existing?.token) return { ...existing, reused: true };

    const now = new Date();
    for (let attempt = 0; attempt < MAX_TOKEN_GENERATION_ATTEMPTS; attempt += 1) {
      const id = randomUUID();
      const token = createShortShareToken(now);
      const encrypted = encryptCredential(token, shareCredentialContext(userId, id));
      try {
        const [share] = await db
          .insert(noteShares)
          .values({
            id,
            noteId: input.noteId,
            userId,
            tokenHash: hashToken(token),
            encryptedToken: encrypted.encryptedSecret,
            tokenIv: encrypted.secretIv,
            tokenAuthTag: encrypted.secretAuthTag,
            tokenKeyId: encrypted.secretKeyId,
            allowCopy: input.allowCopy,
            includeImage: input.includeImage,
            includeSource: input.includeSource,
            expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000),
          })
          .returning({
            id: noteShares.id,
            noteId: noteShares.noteId,
            createdAt: noteShares.createdAt,
            expiresAt: noteShares.expiresAt,
            viewCount: noteShares.viewCount,
          });
        if (existing) await this.revoke(userId, existing.id);
        return { ...share, token, reused: false };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new ApiError(503, "SHARE_TOKEN_UNAVAILABLE", "Unable to allocate a unique share link");
  }

  async renew(userId: string, id: string) {
    const [share] = await db
      .update(noteShares)
      .set({ expiresAt: sql`greatest(${noteShares.expiresAt}, now()) + interval '7 days'` })
      .where(
        and(
          eq(noteShares.id, id),
          eq(noteShares.userId, userId),
          isNull(noteShares.revokedAt),
          gt(noteShares.expiresAt, new Date()),
        ),
      )
      .returning({ id: noteShares.id, expiresAt: noteShares.expiresAt });
    if (!share) throw new ApiError(404, "SHARE_NOT_FOUND", "Share not found or expired");
    return share;
  }

  async revoke(userId: string, id: string) {
    const [share] = await db
      .update(noteShares)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(noteShares.id, id), eq(noteShares.userId, userId), isNull(noteShares.revokedAt)),
      )
      .returning({ id: noteShares.id });
    if (!share) throw new ApiError(404, "SHARE_NOT_FOUND", "Share not found");
    return { revoked: true };
  }

  async publicRead(token: string, clientKey = "anonymous") {
    checkRateLimit(clientKey);
    if (!token || token.length > 256) {
      throw new ApiError(404, "SHARE_NOT_FOUND", "This share is unavailable or expired");
    }
    const [row] = await db
      .select({ share: noteShares, note: promptNotes })
      .from(noteShares)
      .innerJoin(
        promptNotes,
        and(eq(promptNotes.id, noteShares.noteId), eq(promptNotes.userId, noteShares.userId)),
      )
      .where(
        and(
          eq(noteShares.tokenHash, hashToken(token)),
          isNull(noteShares.revokedAt),
          gt(noteShares.expiresAt, new Date()),
          isNull(promptNotes.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new ApiError(404, "SHARE_NOT_FOUND", "This share is unavailable or expired");
    const [image] = row.share.includeImage
      ? await db
          .select({
            displayUrl: promptImages.displayUrl,
            width: promptImages.width,
            height: promptImages.height,
          })
          .from(promptImages)
          .where(and(eq(promptImages.noteId, row.note.id), eq(promptImages.userId, row.note.userId)))
          .orderBy(desc(promptImages.isCover))
          .limit(1)
      : [];
    await db
      .update(noteShares)
      .set({ viewCount: sql`${noteShares.viewCount} + 1` })
      .where(eq(noteShares.id, row.share.id));
    return {
      title: row.note.title,
      prompt: row.note.prompt,
      negativePrompt: row.note.negativePrompt,
      allowCopy: row.share.allowCopy,
      image: image ?? null,
      source: row.share.includeSource
        ? { url: row.note.sourceUrl, title: row.note.sourceTitle }
        : null,
      expiresAt: row.share.expiresAt,
    };
  }
}
