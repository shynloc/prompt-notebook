import { z } from "zod";

import { errorResponse, dataResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { versionSchema } from "@/modules/notes/note-schema";
import { NoteService } from "@/modules/notes/note-service";

const notes = new NoteService();
const noteIdSchema = z.uuid();
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const id = noteIdSchema.parse((await context.params).id);
    const { version } = versionSchema.parse(await request.json());
    const note = await notes.restore(session.user.id, id, version);
    return dataResponse(note);
  } catch (error) {
    return errorResponse(error);
  }
}
