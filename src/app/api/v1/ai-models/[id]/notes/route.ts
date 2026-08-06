import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { characterProfileIdSchema } from "@/modules/characters/character-schema";
import { CharacterService } from "@/modules/characters/character-service";
import { listNotesSchema } from "@/modules/notes/note-schema";
import { NoteService } from "@/modules/notes/note-service";

const characters = new CharacterService();
const notes = new NoteService();
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const id = characterProfileIdSchema.parse((await context.params).id);
    await characters.get(session.user.id, id);
    const url = new URL(request.url);
    const input = listNotesSchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      characterProfileId: id,
    });
    const result = await notes.list(session.user.id, input);
    return dataResponse(result.items, undefined, { nextCursor: result.nextCursor });
  } catch (error) {
    return errorResponse(error);
  }
}
