import { createHash } from "node:crypto";

import { and, eq, gt, isNull, lte } from "drizzle-orm";

import { db } from "@/db/client";
import { idempotencyKeys } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { NoteRepository, type NoteListOptions } from "./note-repository";
import type { CreateNoteInput, UpdateNoteInput } from "./note-schema";

const NOTE_IDEMPOTENCY_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function requestHash(input: CreateNoteInput) {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

export class NoteService {
  constructor(private readonly repository = new NoteRepository()) {}

  create(userId: string, input: CreateNoteInput) {
    return this.repository.create(userId, input);
  }

  async createIdempotent(userId: string, key: string, input: CreateNoteInput) {
    const hash = requestHash(input);
    const now = new Date();
    await db.delete(idempotencyKeys).where(and(
      eq(idempotencyKeys.userId, userId),
      eq(idempotencyKeys.key, key),
      lte(idempotencyKeys.expiresAt, now),
    ));

    const existing = await this.findIdempotentNote(userId, key, hash);
    if (existing) return { note: existing, replayed: true };

    const [claim] = await db.insert(idempotencyKeys).values({
      userId,
      key,
      requestHash: hash,
      expiresAt: new Date(now.getTime() + NOTE_IDEMPOTENCY_TTL_MS),
    }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
    if (!claim) {
      const raced = await this.findIdempotentNote(userId, key, hash);
      if (raced) return { note: raced, replayed: true };
      throw new ApiError(409, "NOTE_SAVE_IN_PROGRESS", "这条生成结果正在保存，请稍候");
    }

    try {
      const note = await this.create(userId, input);
      await db.update(idempotencyKeys).set({ response: { noteId: note.id } })
        .where(eq(idempotencyKeys.id, claim.id));
      return { note, replayed: false };
    } catch (error) {
      await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.id, claim.id), isNull(idempotencyKeys.response)));
      throw error;
    }
  }

  list(userId: string, options: NoteListOptions) {
    return this.repository.list(userId, options);
  }

  private async findIdempotentNote(userId: string, key: string, hash: string) {
    const [existing] = await db.select().from(idempotencyKeys).where(and(
      eq(idempotencyKeys.userId, userId),
      eq(idempotencyKeys.key, key),
      gt(idempotencyKeys.expiresAt, new Date()),
    )).limit(1);
    if (!existing) return null;
    if (existing.requestHash !== hash && !key.startsWith("imagehub-note:")) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "这个保存请求标识已经用于其他内容");
    }
    if (!existing.response) return null;
    const noteId = existing.response.noteId;
    if (typeof noteId !== "string") throw new ApiError(409, "IDEMPOTENCY_RESPONSE_INVALID", "无法恢复之前的保存结果");
    return this.get(userId, noteId);
  }

  async get(userId: string, id: string) {
    const note = await this.repository.findById(userId, id);
    if (!note) throw new ApiError(404, "NOT_FOUND", "Note not found");
    return note;
  }

  async update(userId: string, id: string, input: UpdateNoteInput) {
    const updated = await this.repository.update(userId, id, input);
    if (updated) return updated;
    return this.throwMissingOrConflict(userId, id);
  }

  async remove(userId: string, id: string, version: number) {
    const deleted = await this.repository.setDeleted(userId, id, version, true);
    if (deleted) return deleted;
    return this.throwMissingOrConflict(userId, id);
  }

  async restore(userId: string, id: string, version: number) {
    const restored = await this.repository.setDeleted(userId, id, version, false);
    if (restored) return restored;
    return this.throwMissingOrConflict(userId, id, true);
  }

  private async throwMissingOrConflict(userId: string, id: string, includeDeleted = false) {
    const current = await this.repository.findById(userId, id, includeDeleted);
    if (!current) throw new ApiError(404, "NOT_FOUND", "Note not found");
    throw new ApiError(409, "VERSION_CONFLICT", "The note changed on another device", {
      current,
    });
  }
}
