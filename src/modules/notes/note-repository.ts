import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  gt,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db/client";
import { noteProjects, noteTags, noteVersions, promptImages, promptNotes, tags } from "@/db/schema";
import { promptContentHash } from "@/modules/search/content-hash";
import type { CreateNoteInput, NoteImageInput, UpdateNoteInput } from "./note-schema";

export type PromptNote = typeof promptNotes.$inferSelect;
export type PromptImage = typeof promptImages.$inferSelect;
export type PromptTag = Pick<typeof tags.$inferSelect, "id" | "name">;
export type PromptNoteView = PromptNote & {
  tags: PromptTag[];
  images: PromptImage[];
  coverImage: PromptImage | null;
};

interface Cursor {
  sort: "updated" | "title";
  value: string;
  id: string;
}

export interface NoteListOptions {
  limit: number;
  cursor?: string;
  q?: string;
  tagId?: string;
  projectId?: string;
  sourceHost?: string;
  dateFrom?: Date;
  dateTo?: Date;
  field?: "all" | "title" | "prompt";
  favorite?: boolean;
  view?: "active" | "archived" | "trash";
  hasImage?: boolean;
  sort?: "updated" | "title";
}

function encodeCursor(note: PromptNote, sort: "updated" | "title") {
  return Buffer.from(
    JSON.stringify({ sort, value: sort === "title" ? note.title : note.updatedAt.toISOString(), id: note.id }),
  ).toString("base64url");
}

function decodeCursor(value: string, sort: "updated" | "title"): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (parsed.sort !== sort || typeof parsed.value !== "string" || typeof parsed.id !== "string") return null;
    if (sort === "updated" && Number.isNaN(new Date(parsed.value).getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
}

function noteChanges(input: UpdateNoteInput) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => !["version", "tags", "images"].includes(key) && value !== undefined,
    ),
  );
}

function normalizeTagNames(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class NoteRepository {
  private async hydrate(rows: PromptNote[]): Promise<PromptNoteView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [tagRows, imageRows] = await Promise.all([
      db
        .select({ noteId: noteTags.noteId, id: tags.id, name: tags.name })
        .from(noteTags)
        .innerJoin(tags, eq(noteTags.tagId, tags.id))
        .where(inArray(noteTags.noteId, ids))
        .orderBy(tags.name),
      db
        .select()
        .from(promptImages)
        .where(inArray(promptImages.noteId, ids))
        .orderBy(promptImages.sortOrder),
    ]);
    return rows.map((row) => {
      const images = imageRows.filter((image) => image.noteId === row.id);
      return {
        ...row,
        tags: tagRows
          .filter((tag) => tag.noteId === row.id)
          .map(({ id, name }) => ({ id, name })),
        images,
        coverImage: images.find((image) => image.isCover) ?? images[0] ?? null,
      };
    });
  }

  private async replaceRelations(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    noteId: string,
    tagNames?: string[],
    images?: NoteImageInput[],
  ) {
    if (tagNames !== undefined) {
      await tx.delete(noteTags).where(and(eq(noteTags.noteId, noteId), eq(noteTags.userId, userId)));
      const normalized = normalizeTagNames(tagNames);
      for (const name of normalized) {
        await tx.insert(tags).values({ userId, name }).onConflictDoNothing();
      }
      if (normalized.length) {
        const ownedTags = await tx
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(and(eq(tags.userId, userId), sql`lower(${tags.name}) in (${sql.join(normalized.map((name) => sql`lower(${name})`), sql`, `)})`));
        if (ownedTags.length) {
          await tx.insert(noteTags).values(
            ownedTags.map((tag) => ({ noteId, tagId: tag.id, userId })),
          ).onConflictDoNothing();
        }
      }
    }
    if (images !== undefined) {
      await tx.delete(promptImages).where(and(eq(promptImages.noteId, noteId), eq(promptImages.userId, userId)));
      if (images.length) {
        await tx.insert(promptImages).values(images.map((image, index) => ({
          ...image,
          noteId,
          userId,
          sortOrder: index,
          isCover: index === 0,
        })));
      }
    }
  }

  async create(userId: string, input: CreateNoteInput) {
    const { tags: tagNames, images, ...note } = input;
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(promptNotes).values({ ...note, userId, contentHash: promptContentHash(note.prompt, note.negativePrompt) }).returning();
      await this.replaceRelations(tx, userId, row.id, tagNames, images);
      return row;
    });
    return (await this.hydrate([created]))[0];
  }

  async list(userId: string, options: NoteListOptions) {
    const sort = options.sort ?? "updated";
    const cursor = options.cursor ? decodeCursor(options.cursor, sort) : null;
    const cursorFilter = cursor
      ? sort === "title"
        ? or(gt(promptNotes.title, cursor.value), and(eq(promptNotes.title, cursor.value), gt(promptNotes.id, cursor.id)))
        : or(lt(promptNotes.updatedAt, new Date(cursor.value)), and(eq(promptNotes.updatedAt, new Date(cursor.value)), lt(promptNotes.id, cursor.id)))
      : undefined;
    const query = options.q ? `%${options.q}%` : null;
    const searchFilter = query
      ? options.field === "title" ? sql`${promptNotes.title} ilike ${query}`
        : options.field === "prompt" ? sql`${promptNotes.prompt} ilike ${query}`
        : or(
          sql`${promptNotes.title} ilike ${query}`,
          sql`${promptNotes.prompt} ilike ${query}`,
          sql`exists (select 1 from ${noteTags} nt join ${tags} t on t.id = nt.tag_id where nt.note_id = ${promptNotes.id} and t.name ilike ${query})`,
        )
      : undefined;
    const tagFilter = options.tagId
      ? sql`exists (select 1 from ${noteTags} nt where nt.note_id = ${promptNotes.id} and nt.tag_id = ${options.tagId} and nt.user_id = ${userId})`
      : undefined;
    const projectFilter = options.projectId
      ? sql`exists (select 1 from ${noteProjects} np where np.note_id = ${promptNotes.id} and np.project_id = ${options.projectId} and np.user_id = ${userId})`
      : undefined;
    const sourceFilter = options.sourceHost
      ? or(sql`${promptNotes.sourceUrl} ilike ${`%://${options.sourceHost}/%`}`, sql`${promptNotes.sourceUrl} ilike ${`%://${options.sourceHost}`}`)
      : undefined;
    const view = options.view ?? "active";
    const statusFilter = view === "trash"
      ? isNotNull(promptNotes.deletedAt)
      : view === "archived"
        ? and(isNull(promptNotes.deletedAt), isNotNull(promptNotes.archivedAt))
        : and(isNull(promptNotes.deletedAt), isNull(promptNotes.archivedAt));
    const imageFilter = options.hasImage === undefined
      ? undefined
      : options.hasImage
        ? sql`exists (select 1 from ${promptImages} pi where pi.note_id = ${promptNotes.id} and pi.user_id = ${userId})`
        : sql`not exists (select 1 from ${promptImages} pi where pi.note_id = ${promptNotes.id} and pi.user_id = ${userId})`;
    const rows = await db
      .select()
      .from(promptNotes)
      .where(
        and(
          eq(promptNotes.userId, userId),
          statusFilter,
          cursorFilter,
          searchFilter,
          tagFilter,
          projectFilter,
          sourceFilter,
          options.dateFrom ? gte(promptNotes.createdAt, options.dateFrom) : undefined,
          options.dateTo ? lte(promptNotes.createdAt, options.dateTo) : undefined,
          options.favorite === undefined ? undefined : eq(promptNotes.favorite, options.favorite),
          imageFilter,
        ),
      )
      .orderBy(...(sort === "title" ? [asc(promptNotes.title), asc(promptNotes.id)] : [desc(promptNotes.updatedAt), desc(promptNotes.id)]))
      .limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: await this.hydrate(items),
      nextCursor: hasMore ? encodeCursor(items.at(-1)!, sort) : null,
    };
  }

  async findById(userId: string, id: string, includeDeleted = false) {
    const [note] = await db
      .select()
      .from(promptNotes)
      .where(
        and(
          eq(promptNotes.id, id),
          eq(promptNotes.userId, userId),
          includeDeleted ? undefined : isNull(promptNotes.deletedAt),
        ),
      )
      .limit(1);
    return note ? (await this.hydrate([note]))[0] : null;
  }

  async update(userId: string, id: string, input: UpdateNoteInput) {
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(promptNotes)
        .where(and(eq(promptNotes.id, id), eq(promptNotes.userId, userId), eq(promptNotes.version, input.version), isNull(promptNotes.deletedAt)))
        .limit(1);
      if (!current) return null;
      const [row] = await tx
        .update(promptNotes)
        .set({
          ...noteChanges(input),
          contentHash: promptContentHash(input.prompt ?? current.prompt, input.negativePrompt === undefined ? current.negativePrompt : input.negativePrompt),
          version: sql`${promptNotes.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(promptNotes.id, id),
            eq(promptNotes.userId, userId),
            eq(promptNotes.version, input.version),
            isNull(promptNotes.deletedAt),
          ),
        )
        .returning();
      if (!row) return null;
      await tx.insert(noteVersions).values({ noteId: id, userId, version: current.version, snapshot: current }).onConflictDoNothing();
      await tx.execute(sql`delete from ${noteVersions} where ${noteVersions.id} in (
        select ${noteVersions.id} from ${noteVersions}
        where ${noteVersions.noteId} = ${id} and ${noteVersions.userId} = ${userId}
        order by ${noteVersions.createdAt} desc offset 50
      )`);
      await this.replaceRelations(tx, userId, id, input.tags, input.images);
      return row;
    });
    return updated ? (await this.hydrate([updated]))[0] : null;
  }

  async setDeleted(userId: string, id: string, version: number, deleted: boolean) {
    const [updated] = await db
      .update(promptNotes)
      .set({
        deletedAt: deleted ? new Date() : null,
        version: sql`${promptNotes.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(promptNotes.id, id),
          eq(promptNotes.userId, userId),
          eq(promptNotes.version, version),
          deleted ? isNull(promptNotes.deletedAt) : isNotNull(promptNotes.deletedAt),
        ),
      )
      .returning();
    return updated ? (await this.hydrate([updated]))[0] : null;
  }
}
