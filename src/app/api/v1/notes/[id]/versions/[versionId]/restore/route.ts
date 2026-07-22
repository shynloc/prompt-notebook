import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { HistoryService } from "@/modules/history/history-service";

const history = new HistoryService();
const bodySchema = z.object({ version: z.number().int().positive() });
type Context = { params: Promise<{ id: string; versionId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const params = await context.params;
    const id = z.uuid().parse(params.id);
    const versionId = z.uuid().parse(params.versionId);
    const { version } = bodySchema.parse(await request.json());
    return dataResponse(await history.restore(session.user.id, id, versionId, version));
  } catch (error) { return errorResponse(error); }
}
