import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  aiGenerationJobs,
  characterProfileImages,
  characterProfiles,
  generationCharacterReferences,
  noteCharacterProfiles,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type {
  CharacterImageInput,
  CreateCharacterProfileInput,
  UpdateCharacterProfileInput,
} from "./character-schema";

export type CharacterProfileRow = typeof characterProfiles.$inferSelect;
export type CharacterProfileImageRow = typeof characterProfileImages.$inferSelect;
export type CharacterProfileView = CharacterProfileRow & {
  images: CharacterProfileImageRow[];
  coverImage: CharacterProfileImageRow | null;
  primaryImage: CharacterProfileImageRow | null;
  noteCount: number;
  generationCount: number;
};

export interface CharacterListOptions {
  limit: number;
  cursor?: string;
  q?: string;
  view?: "active" | "archived" | "trash" | "all";
  useCase?: string;
}

function encodeCursor(row: CharacterProfileRow) {
  return Buffer.from(JSON.stringify({ updatedAt: row.updatedAt.toISOString(), id: row.id })).toString("base64url");
}

function decodeCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed.id !== "string" || Number.isNaN(Date.parse(parsed.updatedAt))) return null;
    return { id: parsed.id as string, updatedAt: new Date(parsed.updatedAt as string) };
  } catch {
    return null;
  }
}

function profileChanges(input: UpdateCharacterProfileInput) {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => !["version", "images"].includes(key) && value !== undefined),
  );
}

function withDefaultImageRoles(images: CharacterImageInput[]) {
  if (!images.length) return images;
  const hasCover = images.some((image) => image.isCover);
  const hasPrimary = images.some((image) => image.isPrimary);
  return images.map((image, index) => ({
    ...image,
    isCover: hasCover ? image.isCover : index === 0,
    isPrimary: hasPrimary ? image.isPrimary : index === 0,
  }));
}

export class CharacterRepository {
  private async hydrate(userId: string, rows: CharacterProfileRow[]): Promise<CharacterProfileView[]> {
    if (!rows.length) return [];
    const profileIds = rows.map((row) => row.id);
    const [images, noteCounts, generationCounts] = await Promise.all([
      db.select().from(characterProfileImages).where(and(
        eq(characterProfileImages.userId, userId),
        inArray(characterProfileImages.profileId, profileIds),
        isNull(characterProfileImages.deletedAt),
        eq(characterProfileImages.status, "ready"),
      )).orderBy(characterProfileImages.sortOrder),
      db.select({ profileId: noteCharacterProfiles.profileId, value: count() })
        .from(noteCharacterProfiles)
        .where(and(eq(noteCharacterProfiles.userId, userId), inArray(noteCharacterProfiles.profileId, profileIds)))
        .groupBy(noteCharacterProfiles.profileId),
      db.select({ profileId: generationCharacterReferences.profileId, value: countDistinct(generationCharacterReferences.jobId) })
        .from(generationCharacterReferences)
        .where(and(eq(generationCharacterReferences.userId, userId), inArray(generationCharacterReferences.profileId, profileIds)))
        .groupBy(generationCharacterReferences.profileId),
    ]);
    const notesByProfile = new Map(noteCounts.map((item) => [item.profileId, item.value]));
    const generationsByProfile = new Map(generationCounts.map((item) => [item.profileId, item.value]));
    return rows.map((row) => {
      const profileImages = images.filter((image) => image.profileId === row.id);
      return {
        ...row,
        images: profileImages,
        coverImage: profileImages.find((image) => image.isCover) ?? profileImages[0] ?? null,
        primaryImage: profileImages.find((image) => image.isPrimary) ?? profileImages[0] ?? null,
        noteCount: Number(notesByProfile.get(row.id) ?? 0),
        generationCount: Number(generationsByProfile.get(row.id) ?? 0),
      };
    });
  }

  private async replaceImages(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    profileId: string,
    rawImages: CharacterImageInput[],
  ) {
    const images = withDefaultImageRoles(rawImages);
    const current = await tx.select({ id: characterProfileImages.id }).from(characterProfileImages).where(and(
      eq(characterProfileImages.userId, userId),
      eq(characterProfileImages.profileId, profileId),
      isNull(characterProfileImages.deletedAt),
    ));
    const currentIds = new Set(current.map((image) => image.id));
    const requestedExistingIds = images.flatMap((image) => image.id ? [image.id] : []);
    if (requestedExistingIds.some((id) => !currentIds.has(id))) {
      throw new ApiError(404, "CHARACTER_IMAGE_NOT_FOUND", "AI Model image was not found");
    }

    if (current.length) {
      await tx.update(characterProfileImages).set({
        sortOrder: sql`${characterProfileImages.sortOrder} + 1000`,
        isCover: false,
        isPrimary: false,
        updatedAt: new Date(),
      }).where(and(
        eq(characterProfileImages.userId, userId),
        eq(characterProfileImages.profileId, profileId),
        isNull(characterProfileImages.deletedAt),
      ));
    }

    for (const [sortOrder, image] of images.entries()) {
      const { id, ...metadata } = image;
      if (id) {
        await tx.update(characterProfileImages).set({ ...metadata, sortOrder, updatedAt: new Date() }).where(and(
          eq(characterProfileImages.id, id),
          eq(characterProfileImages.profileId, profileId),
          eq(characterProfileImages.userId, userId),
          isNull(characterProfileImages.deletedAt),
        ));
      } else {
        await tx.insert(characterProfileImages).values({ ...metadata, profileId, userId, sortOrder });
      }
    }

    const removedFilter = requestedExistingIds.length
      ? notInArray(characterProfileImages.id, requestedExistingIds)
      : undefined;
    await tx.update(characterProfileImages).set({
      deletedAt: new Date(),
      isCover: false,
      isPrimary: false,
      updatedAt: new Date(),
    }).where(and(
      eq(characterProfileImages.userId, userId),
      eq(characterProfileImages.profileId, profileId),
      isNull(characterProfileImages.deletedAt),
      removedFilter,
      sql`${characterProfileImages.sortOrder} >= 1000`,
    ));
  }

  async create(userId: string, input: CreateCharacterProfileInput) {
    return this.createWithId(userId, undefined, input);
  }

  async createImported(userId: string, id: string, input: CreateCharacterProfileInput) {
    return this.createWithId(userId, id, input);
  }

  private async createWithId(userId: string, id: string | undefined, input: CreateCharacterProfileInput) {
    const { images, ...profile } = input;
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(characterProfiles).values({ ...profile, ...(id ? { id } : {}), userId }).returning();
      await this.replaceImages(tx, userId, row.id, images);
      return row;
    });
    return (await this.hydrate(userId, [created]))[0];
  }

  async list(userId: string, options: CharacterListOptions) {
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    const cursorFilter = cursor ? or(
      lt(characterProfiles.updatedAt, cursor.updatedAt),
      and(eq(characterProfiles.updatedAt, cursor.updatedAt), lt(characterProfiles.id, cursor.id)),
    ) : undefined;
    const query = options.q ? `%${options.q}%` : null;
    const view = options.view ?? "active";
    const statusFilter = view === "trash" ? isNotNull(characterProfiles.deletedAt)
      : view === "archived" ? and(isNull(characterProfiles.deletedAt), isNotNull(characterProfiles.archivedAt))
        : view === "all" ? undefined
          : and(isNull(characterProfiles.deletedAt), isNull(characterProfiles.archivedAt));
    const rows = await db.select().from(characterProfiles).where(and(
      eq(characterProfiles.userId, userId),
      statusFilter,
      cursorFilter,
      query ? or(
        sql`${characterProfiles.name} ilike ${query}`,
        sql`${characterProfiles.summary} ilike ${query}`,
        sql`${characterProfiles.roleDefinition} ilike ${query}`,
      ) : undefined,
      options.useCase ? sql`${options.useCase} = any(${characterProfiles.useCases})` : undefined,
    )).orderBy(desc(characterProfiles.updatedAt), desc(characterProfiles.id)).limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
    return { items: await this.hydrate(userId, items), nextCursor: hasMore ? encodeCursor(items.at(-1)!) : null };
  }

  async findById(userId: string, id: string, includeDeleted = false) {
    const [row] = await db.select().from(characterProfiles).where(and(
      eq(characterProfiles.userId, userId),
      eq(characterProfiles.id, id),
      includeDeleted ? undefined : isNull(characterProfiles.deletedAt),
    )).limit(1);
    return row ? (await this.hydrate(userId, [row]))[0] : null;
  }

  async update(userId: string, id: string, input: UpdateCharacterProfileInput) {
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(characterProfiles).where(and(
        eq(characterProfiles.userId, userId),
        eq(characterProfiles.id, id),
        eq(characterProfiles.version, input.version),
        isNull(characterProfiles.deletedAt),
      )).limit(1);
      if (!current) return null;
      const [row] = await tx.update(characterProfiles).set({
        ...profileChanges(input),
        version: sql`${characterProfiles.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(characterProfiles.userId, userId),
        eq(characterProfiles.id, id),
        eq(characterProfiles.version, input.version),
        isNull(characterProfiles.deletedAt),
      )).returning();
      if (!row) return null;
      if (input.images) await this.replaceImages(tx, userId, id, input.images);
      return row;
    });
    return updated ? (await this.hydrate(userId, [updated]))[0] : null;
  }

  async setDeleted(userId: string, id: string, version: number, deleted: boolean) {
    const [updated] = await db.update(characterProfiles).set({
      deletedAt: deleted ? new Date() : null,
      archivedAt: deleted ? null : undefined,
      version: sql`${characterProfiles.version} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(characterProfiles.userId, userId),
      eq(characterProfiles.id, id),
      eq(characterProfiles.version, version),
      deleted ? isNull(characterProfiles.deletedAt) : isNotNull(characterProfiles.deletedAt),
    )).returning();
    return updated ? (await this.hydrate(userId, [updated]))[0] : null;
  }

  async permanentlyDelete(userId: string, id: string, version: number) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`character:${userId}:${id}`}, 0))`);
      const [current] = await tx.select({ id: characterProfiles.id }).from(characterProfiles).where(and(
        eq(characterProfiles.userId, userId),
        eq(characterProfiles.id, id),
        eq(characterProfiles.version, version),
        isNotNull(characterProfiles.deletedAt),
      )).limit(1);
      if (!current) return null;

      const [activeReference] = await tx.select({ jobId: aiGenerationJobs.id })
        .from(aiGenerationJobs)
        .where(and(
          eq(aiGenerationJobs.userId, userId),
          eq(aiGenerationJobs.characterProfileId, id),
          sql`${aiGenerationJobs.status} in ('preparing', 'queued', 'running', 'cancel_requested')`,
        ))
        .limit(1);
      if (activeReference) {
        throw new ApiError(409, "CHARACTER_PROFILE_IN_USE", "请先取消或等待使用该角色的生图任务结束，再永久删除 AI Model");
      }

      const [deleted] = await tx.delete(characterProfiles).where(and(
        eq(characterProfiles.userId, userId),
        eq(characterProfiles.id, id),
        eq(characterProfiles.version, version),
        isNotNull(characterProfiles.deletedAt),
      )).returning({ id: characterProfiles.id });
      return deleted ?? null;
    });
  }
}
