import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { TemplateService, renderTemplate } from "@/modules/templates/template-service";

const createSchema = z.object({ name: z.string().trim().min(1).max(100), content: z.string().trim().min(1).max(100_000) });
const renderSchema = z.object({ content: z.string().max(100_000), values: z.record(z.string().max(40), z.string().max(10_000)) });
const service = new TemplateService();

export async function GET(request: Request) {
  try { const session = await requireSession(request); return dataResponse(await service.list(session.user.id)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    if (body.mode === "render") { const input = renderSchema.parse(body); return dataResponse({ rendered: renderTemplate(input.content, input.values) }); }
    return dataResponse(await service.create(session.user.id, createSchema.parse(body)), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
