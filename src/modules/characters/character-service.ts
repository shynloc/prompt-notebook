import { ApiError } from "@/lib/api/errors";
import {
  CharacterRepository,
  type CharacterListOptions,
} from "./character-repository";
import type {
  CreateCharacterProfileInput,
  UpdateCharacterProfileInput,
} from "./character-schema";

export class CharacterService {
  constructor(private readonly repository = new CharacterRepository()) {}

  create(userId: string, input: CreateCharacterProfileInput) {
    return this.repository.create(userId, input);
  }

  list(userId: string, options: CharacterListOptions) {
    return this.repository.list(userId, options);
  }

  async get(userId: string, id: string, includeDeleted = false) {
    const profile = await this.repository.findById(userId, id, includeDeleted);
    if (!profile) throw new ApiError(404, "CHARACTER_PROFILE_NOT_FOUND", "AI Model profile was not found");
    return profile;
  }

  async update(userId: string, id: string, input: UpdateCharacterProfileInput) {
    const updated = await this.repository.update(userId, id, input);
    if (updated) return updated;
    return this.throwMissingOrConflict(userId, id);
  }

  async remove(userId: string, id: string, version: number) {
    const removed = await this.repository.setDeleted(userId, id, version, true);
    if (removed) return removed;
    return this.throwMissingOrConflict(userId, id);
  }

  async restore(userId: string, id: string, version: number) {
    const restored = await this.repository.setDeleted(userId, id, version, false);
    if (restored) return restored;
    return this.throwMissingOrConflict(userId, id, true);
  }

  async permanentlyRemove(userId: string, id: string, version: number) {
    const current = await this.repository.findById(userId, id, true);
    if (!current) throw new ApiError(404, "CHARACTER_PROFILE_NOT_FOUND", "AI Model profile was not found");
    if (current.version !== version) {
      throw new ApiError(409, "CHARACTER_PROFILE_VERSION_CONFLICT", "This AI Model changed on another device", { current });
    }
    if (!current.deletedAt) {
      throw new ApiError(409, "CHARACTER_PROFILE_NOT_IN_TRASH", "请先将 AI Model 移入回收站，再执行永久删除");
    }
    const deleted = await this.repository.permanentlyDelete(userId, id, version);
    if (deleted) return { id: deleted.id, deleted: true, permanent: true };
    return this.throwMissingOrConflict(userId, id, true);
  }

  private async throwMissingOrConflict(userId: string, id: string, includeDeleted = false): Promise<never> {
    const current = await this.repository.findById(userId, id, includeDeleted);
    if (!current) throw new ApiError(404, "CHARACTER_PROFILE_NOT_FOUND", "AI Model profile was not found");
    throw new ApiError(409, "CHARACTER_PROFILE_VERSION_CONFLICT", "This AI Model changed on another device", { current });
  }
}
