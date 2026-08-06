import { createHash } from "node:crypto";

import { and, count, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { idempotencyKeys } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { MediaService } from "@/modules/media/media-service";
import { NoteService } from "@/modules/notes/note-service";
import type { ExtensionCaptureInput } from "./capture-schema";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CAPTURES_PER_MINUTE = 30;

function requestHash(input: ExtensionCaptureInput) {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

export class ExtensionCaptureService {
  constructor(
    private readonly notes = new NoteService(),
    private readonly media = new MediaService(),
  ) {}

  async capture(userId: string, key: string, input: ExtensionCaptureInput) {
    const hash = requestHash(input);
    const existing = await this.findExisting(userId, key, hash);
    if (existing) return { ...existing, replayed: true };

    const [{ total }] = await db.select({ total: count() }).from(idempotencyKeys).where(and(
      eq(idempotencyKeys.userId, userId),
      gt(idempotencyKeys.createdAt, new Date(Date.now() - 60_000)),
    ));
    if (Number(total) >= CAPTURES_PER_MINUTE) throw new ApiError(429, "CAPTURE_RATE_LIMITED", "保存太频繁，请稍后再试");

    const [claim] = await db.insert(idempotencyKeys).values({
      userId,
      key,
      requestHash: hash,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
    if (!claim) {
      const raced = await this.findExisting(userId, key, hash);
      if (raced) return { ...raced, replayed: true };
      throw new ApiError(409, "CAPTURE_IN_PROGRESS", "这条提示词正在保存，请稍后重试");
    }

    try {
      const imageResults = await Promise.allSettled(input.imageUrls.map((url) => this.media.importUrl(userId, url)));
      const images = imageResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const imageWarnings = imageResults.flatMap((result, index) => result.status === "rejected" ? [{
        url: input.imageUrls[index],
        message: result.reason instanceof Error ? result.reason.message : "图片导入失败",
      }] : []);
      const note = await this.notes.create(userId, {
        title: input.title,
        prompt: input.prompt,
        tags: input.tags,
        characterProfiles: [],
        images,
        sourceUrl: input.sourceUrl,
        sourceTitle: input.sourceTitle ?? null,
        capturedAt: new Date(),
        captureMethod: "extension",
      });
      const response = { note, imageWarnings };
      await db.update(idempotencyKeys).set({ response }).where(eq(idempotencyKeys.id, claim.id));
      return { ...response, replayed: false };
    } catch (error) {
      await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.id, claim.id), isNull(idempotencyKeys.response)));
      throw error;
    }
  }

  private async findExisting(userId: string, key: string, hash: string) {
    const [existing] = await db.select().from(idempotencyKeys).where(and(
      eq(idempotencyKeys.userId, userId),
      eq(idempotencyKeys.key, key),
      gt(idempotencyKeys.expiresAt, new Date()),
    )).limit(1);
    if (!existing) return null;
    if (existing.requestHash !== hash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "这个保存请求标识已经用于其他内容");
    if (!existing.response) return null;
    return existing.response as { note: Record<string, unknown>; imageWarnings: Array<{ url: string; message: string }> };
  }
}
