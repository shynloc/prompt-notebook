import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, realpath, rmdir, statfs, unlink } from "node:fs/promises";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { localMediaObjects } from "@/db/schema/media";
import { ApiError } from "@/lib/api/errors";
import { inspectImage, MAX_GENERATED_IMAGE_BYTES } from "./image-policy";
import type { StorageProvider } from "./storage-provider";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_KEY = /^[a-f0-9]{64}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/;

function positiveSetting(name: string, fallback: number, minimum = 1) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new ApiError(503, "LOCAL_STORAGE_CONFIGURATION_INVALID", "本地图片存储容量配置无效，请联系管理员");
  return value;
}

export function localMediaQuotaBytes() {
  return positiveSetting("LOCAL_MEDIA_QUOTA_BYTES", 1024 * 1024 * 1024);
}

export function localMediaUrl(id: string) {
  if (!UUID.test(id)) throw new ApiError(404, "LOCAL_MEDIA_NOT_FOUND", "图片不存在或不可访问");
  const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
  return `${origin}/api/v1/media/files/${id}`;
}

/** This is an internal route resolver, not an exception to outbound SSRF checks. */
export function localMediaIdFromUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
  if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
  const match = /^\/api\/v1\/media\/files\/([^/]+)$/.exec(url.pathname);
  return match && UUID.test(match[1]) ? match[1] : null;
}

export async function localMediaUsage(userId: string) {
  const [row] = await db.select({ value: sql<number>`coalesce(sum(${localMediaObjects.sizeBytes}), 0)::bigint` })
    .from(localMediaObjects).where(eq(localMediaObjects.userId, userId));
  return { usedBytes: Number(row?.value ?? 0), quotaBytes: localMediaQuotaBytes() };
}

function ownerNamespace(userId: string) {
  return createHash("sha256").update(userId).digest("hex");
}

/** Only for owner-scoped trusted database rows, never for arbitrary URL imports. */
export function localMediaIdFromObjectKey(userId: string, objectKey: string): string | null {
  if (!OBJECT_KEY.test(objectKey) || objectKey.split("/")[0] !== ownerNamespace(userId)) return null;
  const id = path.posix.basename(objectKey).replace(/\.(?:jpg|png|webp)$/, "");
  return UUID.test(id) ? id : null;
}

export function localImageView<T extends { storageProvider: string; objectKey: string; displayUrl: string; thumbnailUrl: string }>(userId: string, image: T): T {
  if (image.storageProvider !== "local") return image;
  const id = localMediaIdFromObjectKey(userId, image.objectKey);
  if (!id) throw new ApiError(404, "LOCAL_MEDIA_NOT_FOUND", "图片不存在或不可访问");
  const url = localMediaUrl(id);
  return { ...image, displayUrl: url, thumbnailUrl: url };
}

function samePath(left: string, right: string) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Files are never placed under public/, and untrusted object keys cannot pick a filesystem path. */
export class LocalMediaStore implements StorageProvider {
  private readonly root: string;

  constructor(private readonly userId: string, root = process.env.LOCAL_MEDIA_ROOT ?? "/app/data/media") {
    if (!path.isAbsolute(root)) throw new ApiError(503, "LOCAL_STORAGE_CONFIGURATION_INVALID", "本地图片目录必须为绝对路径，请联系管理员");
    this.root = path.resolve(/* turbopackIgnore: true */ root);
    const publicRelative = path.relative(path.resolve(process.cwd(), "public"), this.root);
    if (!publicRelative || (!publicRelative.startsWith(`..${path.sep}`) && publicRelative !== ".." && !path.isAbsolute(publicRelative))) throw new ApiError(503, "LOCAL_STORAGE_CONFIGURATION_INVALID", "本地图片目录不能位于 public 目录中");
  }

  private async directory() {
    // Walk before creating children: recursive mkdir could follow an existing
    // ancestor symlink and create directories outside the configured root.
    let current = path.parse(this.root).root;
    for (const segment of this.root.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
      const ancestor = await lstat(current);
      if (!ancestor.isDirectory() || ancestor.isSymbolicLink()) throw new Error("Unsafe media ancestor");
    }
    const rootStat = await lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !samePath(await realpath(this.root), this.root)) throw new Error("Unsafe media root");
    await chmod(this.root, 0o700);
    const directory = path.join(this.root, ownerNamespace(this.userId));
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(await realpath(directory), directory)) throw new Error("Unsafe media namespace");
    await chmod(directory, 0o700);
    return directory;
  }

  private async filePath(objectKey: string) {
    if (!OBJECT_KEY.test(objectKey) || objectKey.split("/")[0] !== ownerNamespace(this.userId)) throw new ApiError(404, "LOCAL_MEDIA_NOT_FOUND", "图片不存在或不可访问");
    return path.join(await this.directory(), path.basename(objectKey));
  }

  private async write(filePath: string, data: Buffer) {
    const space = await statfs(this.root);
    const reserve = positiveSetting("LOCAL_MEDIA_MIN_FREE_BYTES", 256 * 1024 * 1024, 0);
    if (space.bavail * space.bsize < reserve + data.length) throw new ApiError(507, "LOCAL_STORAGE_DISK_FULL", "服务器图片存储空间不足，请联系管理员或切换图床");
    const file = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  async upload(input: Parameters<StorageProvider["upload"]>[0]) {
    const metadata = await inspectImage(input.data, MAX_GENERATED_IMAGE_BYTES);
    if (metadata.mimeType !== input.mimeType) throw new ApiError(422, "IMAGE_REJECTED", "图片内容与格式不一致");
    const id = randomUUID();
    const extension = metadata.mimeType === "image/jpeg" ? "jpg" : metadata.mimeType.split("/")[1];
    const objectKey = `${ownerNamespace(this.userId)}/${id}.${extension}`;
    let writtenPath: string | undefined;
    try {
      const destination = await this.filePath(objectKey);
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`local-media:${this.userId}`}, 0))`);
        const [usage] = await transaction.select({ value: sql<number>`coalesce(sum(${localMediaObjects.sizeBytes}), 0)::bigint` }).from(localMediaObjects).where(eq(localMediaObjects.userId, this.userId));
        if (Number(usage?.value ?? 0) + input.data.length > localMediaQuotaBytes()) throw new ApiError(413, "LOCAL_STORAGE_QUOTA_EXCEEDED", "本地图片存储配额不足，请联系管理员或切换图床");
        await this.write(destination, input.data);
        writtenPath = destination;
        await transaction.insert(localMediaObjects).values({ id, userId: this.userId, objectKey, ...metadata });
      });
    } catch (error) {
      if (writtenPath) {
        // A lost COMMIT acknowledgement does not prove rollback. Never delete
        // a file that the database may already reference; unindexed crash
        // remnants remain private until operator reconciliation.
        const persisted = await this.metadata(id).then(
          (row) => row.objectKey === objectKey ? true : undefined,
          (failure: unknown) => failure instanceof ApiError && failure.status === 404 ? false : undefined,
        );
        if (persisted) return this.storedImage(id, objectKey);
        if (persisted === false) await unlink(writtenPath).catch(() => undefined);
      }
      if (error instanceof ApiError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      throw new ApiError(code === "ENOSPC" ? 507 : 503, "LOCAL_STORAGE_UNAVAILABLE", "本地图片存储暂不可用，请联系管理员");
    }
    return this.storedImage(id, objectKey);
  }

  private storedImage(id: string, objectKey: string) {
    const url = localMediaUrl(id);
    return { storageProvider: "local" as const, objectKey, displayUrl: url, thumbnailUrl: url };
  }

  async metadata(id: string) {
    if (!UUID.test(id)) throw new ApiError(404, "LOCAL_MEDIA_NOT_FOUND", "图片不存在或不可访问");
    const [row] = await db.select().from(localMediaObjects).where(and(eq(localMediaObjects.id, id), eq(localMediaObjects.userId, this.userId))).limit(1);
    if (!row) throw new ApiError(404, "LOCAL_MEDIA_NOT_FOUND", "图片不存在或不可访问");
    return row;
  }

  async read(id: string) {
    const metadata = await this.metadata(id);
    try {
      const destination = await this.filePath(metadata.objectKey);
      const entry = await lstat(destination);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== metadata.sizeBytes || entry.size > MAX_GENERATED_IMAGE_BYTES) throw new Error("Invalid local media file");
      const handle = await open(destination, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== metadata.sizeBytes) throw new Error("Invalid local media file");
        const data = Buffer.alloc(metadata.sizeBytes + 1);
        let length = 0;
        while (length < data.length) {
          const read = await handle.read(data, length, data.length - length, null);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length !== metadata.sizeBytes) throw new Error("Invalid local media length");
        return { data: data.subarray(0, length), metadata };
      } finally { await handle.close(); }
    } catch {
      throw new ApiError(404, "LOCAL_MEDIA_NOT_FOUND", "图片不存在或不可访问");
    }
  }

  async test() {
    let probe: string | undefined;
    let created = false;
    try {
      probe = path.join(await this.directory(), `${randomUUID()}.probe`);
      await this.write(probe, Buffer.from("prompt-notebook-local-storage"));
      created = true;
      const file = await open(/* turbopackIgnore: true */ probe, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { if ((await file.readFile("utf8")) !== "prompt-notebook-local-storage") throw new Error("Invalid probe"); }
      finally { await file.close(); }
      return { ok: true, providerType: "local" as const };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "LOCAL_STORAGE_UNAVAILABLE", "本地图片目录不可写，请联系管理员");
    } finally { if (probe && created) await unlink(probe).catch(() => undefined); }
  }

  /** Only call after this account's database deletion has committed. Never recursive. */
  async purgeDeletedAccount() {
    try { await lstat(path.join(this.root, ownerNamespace(this.userId))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    const directory = await this.directory();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[0-9a-f-]{36}\.(?:jpg|png|webp|probe)$/.test(entry.name)) throw new Error("Unexpected file in local media namespace");
      await unlink(path.join(directory, entry.name));
    }
    await rmdir(directory);
  }
}

export async function readLocalMediaUrl(userId: string, url: string) {
  const id = localMediaIdFromUrl(url);
  return id ? new LocalMediaStore(userId).read(id) : null;
}

/** Validate owner-held local references before writing note/character metadata. */
export async function validateOwnedLocalImages(userId: string, images: Array<{ storageProvider: string; objectKey: string; displayUrl: string; thumbnailUrl: string; mimeType: string; width: number; height: number; sizeBytes: number }>) {
  for (const image of images) {
    if (image.storageProvider !== "local") continue;
    const id = localMediaIdFromUrl(image.displayUrl);
    if (!id) throw new ApiError(422, "LOCAL_MEDIA_INVALID", "本站图片引用无效，请重新上传");
    const row = await new LocalMediaStore(userId).metadata(id);
    if (row.objectKey !== image.objectKey || image.thumbnailUrl !== image.displayUrl || row.mimeType !== image.mimeType || row.width !== image.width || row.height !== image.height || row.sizeBytes !== image.sizeBytes) throw new ApiError(422, "LOCAL_MEDIA_INVALID", "本站图片引用与原文件不一致");
  }
}
