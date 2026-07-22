import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { ProjectService } from "@/modules/projects/project-service";

const schema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).optional(), smartFilter: z.record(z.string(), z.unknown()).nullable().optional() });
const service = new ProjectService();

export async function GET(request: Request) {
  try { const session = await requireSession(request); return dataResponse(await service.list(session.user.id)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { const session = await requireSession(request); return dataResponse(await service.create(session.user.id, schema.parse(await request.json())), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
