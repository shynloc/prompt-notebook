import { ApiError } from "@/lib/api/errors";
import { NoteRepository, type NoteListOptions } from "./note-repository";
import type { CreateNoteInput, UpdateNoteInput } from "./note-schema";

export class NoteService {
  constructor(private readonly repository = new NoteRepository()) {}

  create(userId: string, input: CreateNoteInput) {
    return this.repository.create(userId, input);
  }

  list(userId: string, options: NoteListOptions) {
    return this.repository.list(userId, options);
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
