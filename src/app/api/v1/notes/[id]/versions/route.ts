import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { HistoryService } from "@/modules/history/history-service";

const history = new HistoryService();
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const id = z.uuid().parse((await context.params).id);
    return dataResponse(await history.list(session.user.id, id));
  } catch (error) { return errorResponse(error); }
}
