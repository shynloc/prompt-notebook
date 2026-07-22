import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { SearchService } from "@/modules/search/search-service";

const search = new SearchService();
export async function GET(request: Request) {
  try { const session = await requireSession(request); const value = new URL(request.url).searchParams.get("noteId"); const noteId = value ? z.uuid().parse(value) : undefined; return dataResponse(await search.duplicates(session.user.id, noteId)); }
  catch (error) { return errorResponse(error); }
}
