// @vitest-environment node

import { randomUUID } from "node:crypto";

import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  extensionAccessTokens,
  extensionDevices,
  extensionRefreshTokens,
  noteTags,
  promptImages,
  promptNotes,
  tags,
  user,
} from "@/db/schema";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://prompt_notebook:prompt_notebook@127.0.0.1:55432/prompt_notebook_test";

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql);

async function createUser(email: string) {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: email.split("@")[0],
    email,
    emailVerified: false,
  });
  return id;
}

async function expectPostgresCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected PostgreSQL error ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ cause: { code } });
  }
}

describe("database schema", () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/db/migrations" });
  });

  afterAll(async () => {
    await sql.end();
  });

  it("owns every note with a real user and defaults version to one", async () => {
    const ownerId = await createUser(`owner-${randomUUID()}@example.com`);
    const [note] = await db
      .insert(promptNotes)
      .values({ userId: ownerId, title: "Portrait", prompt: "soft light" })
      .returning();

    expect(note.userId).toBe(ownerId);
    expect(note.version).toBe(1);

    await expectPostgresCode(
      db.insert(promptNotes).values({
        userId: randomUUID(),
        title: "Orphan",
        prompt: "must fail",
      }),
      "23503",
    );
  });

  it("stores capture provenance and cascades revoked device credentials", async () => {
    const ownerId = await createUser(`extension-${randomUUID()}@example.com`);
    const [note] = await db.insert(promptNotes).values({
      userId: ownerId,
      title: "Captured prompt",
      prompt: "selected text",
      sourceUrl: "https://example.com/prompts/1",
      sourceTitle: "Example prompt",
      capturedAt: new Date(),
      captureMethod: "extension",
    }).returning();
    const [device] = await db.insert(extensionDevices).values({ userId: ownerId, name: "Chrome" }).returning();
    await db.insert(extensionAccessTokens).values({ deviceId: device.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) });
    await db.insert(extensionRefreshTokens).values({ deviceId: device.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) });

    expect(note.sourceUrl).toBe("https://example.com/prompts/1");
    await db.delete(extensionDevices).where(drizzleSql`${extensionDevices.id} = ${device.id}`);
    expect(await db.select().from(extensionAccessTokens).where(drizzleSql`${extensionAccessTokens.deviceId} = ${device.id}`)).toHaveLength(0);
    expect(await db.select().from(extensionRefreshTokens).where(drizzleSql`${extensionRefreshTokens.deviceId} = ${device.id}`)).toHaveLength(0);
  });

  it("allows only one cover and one image position per note", async () => {
    const ownerId = await createUser(`images-${randomUUID()}@example.com`);
    const objectPrefix = randomUUID();
    const [note] = await db
      .insert(promptNotes)
      .values({ userId: ownerId, title: "Images", prompt: "gallery" })
      .returning();

    await db.insert(promptImages).values({
      noteId: note.id,
      userId: ownerId,
      storageProvider: "test",
      objectKey: `${objectPrefix}-one.webp`,
      displayUrl: "https://example.com/one.webp",
      thumbnailUrl: "https://example.com/one-thumb.webp",
      mimeType: "image/webp",
      width: 100,
      height: 100,
      sizeBytes: 1000,
      sortOrder: 0,
      isCover: true,
    });

    await expectPostgresCode(
      db.insert(promptImages).values({
        noteId: note.id,
        userId: ownerId,
        storageProvider: "test",
        objectKey: `${objectPrefix}-two.webp`,
        displayUrl: "https://example.com/two.webp",
        thumbnailUrl: "https://example.com/two-thumb.webp",
        mimeType: "image/webp",
        width: 100,
        height: 100,
        sizeBytes: 1000,
        sortOrder: 1,
        isCover: true,
      }),
      "23505",
    );

    await expectPostgresCode(
      db.insert(promptImages).values({
        noteId: note.id,
        userId: ownerId,
        storageProvider: "test",
        objectKey: `${objectPrefix}-three.webp`,
        displayUrl: "https://example.com/three.webp",
        thumbnailUrl: "https://example.com/three-thumb.webp",
        mimeType: "image/webp",
        width: 100,
        height: 100,
        sizeBytes: 1000,
        sortOrder: 0,
      }),
      "23505",
    );
  });

  it("keeps tag names unique per user but reusable across users", async () => {
    const firstUser = await createUser(`tags-a-${randomUUID()}@example.com`);
    const secondUser = await createUser(`tags-b-${randomUUID()}@example.com`);

    await db.insert(tags).values({ userId: firstUser, name: "portrait" });
    await db.insert(tags).values({ userId: secondUser, name: "portrait" });

    await expectPostgresCode(
      db.insert(tags).values({ userId: firstUser, name: "portrait" }),
      "23505",
    );
  });

  it("cascades a hard-deleted note to images and tag joins", async () => {
    const ownerId = await createUser(`cascade-${randomUUID()}@example.com`);
    const [note] = await db
      .insert(promptNotes)
      .values({ userId: ownerId, title: "Disposable", prompt: "delete me" })
      .returning();
    const [tag] = await db
      .insert(tags)
      .values({ userId: ownerId, name: `tag-${randomUUID()}` })
      .returning();

    await db
      .insert(noteTags)
      .values({ noteId: note.id, tagId: tag.id, userId: ownerId });
    await db.insert(promptImages).values({
      noteId: note.id,
      userId: ownerId,
      storageProvider: "test",
      objectKey: `${randomUUID()}-cascade.webp`,
      displayUrl: "https://example.com/cascade.webp",
      thumbnailUrl: "https://example.com/cascade-thumb.webp",
      mimeType: "image/webp",
      width: 100,
      height: 100,
      sizeBytes: 1000,
      sortOrder: 0,
    });

    await db.delete(promptNotes).where(drizzleSql`${promptNotes.id} = ${note.id}`);

    expect(
      await db
        .select()
        .from(promptImages)
        .where(drizzleSql`${promptImages.noteId} = ${note.id}`),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(noteTags)
        .where(drizzleSql`${noteTags.noteId} = ${note.id}`),
    ).toHaveLength(0);
  });
});
