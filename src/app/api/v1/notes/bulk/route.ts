import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { BulkService } from "@/modules/notes/bulk-service";

const schema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
  action: z.enum(["favorite", "unfavorite", "archive", "unarchive", "delete", "tag", "project"]),
  tag: z.string().trim().min(1).max(40).optional(),
  projectId: z.uuid().optional(),
});
const bulk = new BulkService();

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    return dataResponse(await bulk.apply(session.user.id, schema.parse(await request.json())));
  } catch (error) { return errorResponse(error); }
}
