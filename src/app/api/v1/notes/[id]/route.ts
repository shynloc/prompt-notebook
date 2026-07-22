import { z } from "zod";

import { errorResponse, dataResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import {
  updateNoteSchema,
  versionSchema,
} from "@/modules/notes/note-schema";
import { NoteService } from "@/modules/notes/note-service";

const notes = new NoteService();
const noteIdSchema = z.uuid();
type RouteContext = { params: Promise<{ id: string }> };

async function noteId(context: RouteContext) {
  return noteIdSchema.parse((await context.params).id);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const note = await notes.get(session.user.id, await noteId(context));
    return dataResponse(note);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const input = updateNoteSchema.parse(await request.json());
    const note = await notes.update(session.user.id, await noteId(context), input);
    return dataResponse(note);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const { version } = versionSchema.parse(await request.json());
    const note = await notes.remove(session.user.id, await noteId(context), version);
    return dataResponse(note);
  } catch (error) {
    return errorResponse(error);
  }
}
