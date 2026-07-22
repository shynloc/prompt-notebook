import { errorResponse, dataResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import {
  createNoteSchema,
  listNotesSchema,
} from "@/modules/notes/note-schema";
import { NoteService } from "@/modules/notes/note-service";

const notes = new NoteService();

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
    const created = await notes.create(session.user.id, input);
    return dataResponse(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
