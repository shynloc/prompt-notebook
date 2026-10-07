import { errorResponse, dataResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { z } from "zod";
import {
  createNoteSchema,
  listNotesSchema,
} from "@/modules/notes/note-schema";
import { NoteService } from "@/modules/notes/note-service";

const notes = new NoteService();
const idempotencyKeySchema = z.string().regex(/^(?:imagehub-note|reverse-note):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const query = listNotesSchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      tagId: url.searchParams.get("tagId") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
      characterProfileId: url.searchParams.get("characterProfileId") ?? undefined,
      sourceHost: url.searchParams.get("sourceHost") ?? undefined,
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
      field: url.searchParams.get("field") ?? undefined,
      favorite: url.searchParams.get("favorite") ?? undefined,
      view: url.searchParams.get("view") ?? undefined,
      hasImage: url.searchParams.get("hasImage") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    });
    const result = await notes.list(session.user.id, query);
    return dataResponse(result.items, undefined, { nextCursor: result.nextCursor });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = createNoteSchema.parse(await request.json());
    const keyHeader = request.headers.get("idempotency-key");
    if (!keyHeader) return dataResponse(await notes.create(session.user.id, input), { status: 201 });
    const result = await notes.createIdempotent(session.user.id, idempotencyKeySchema.parse(keyHeader), input);
    return dataResponse(result.note, { status: result.replayed ? 200 : 201 }, { replayed: result.replayed });
  } catch (error) {
    return errorResponse(error);
  }
}
