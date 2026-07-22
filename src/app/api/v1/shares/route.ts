import { z } from "zod";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { ShareService } from "@/modules/sharing/share-service";

const service = new ShareService();
const schema = z.object({ noteId: z.uuid(), expiresInDays: z.number().int().min(1).max(90).default(7), allowCopy: z.boolean().default(true), includeImage: z.boolean().default(true), includeSource: z.boolean().default(false) });
export async function GET(request: Request) { try { const session = await requireSession(request); const value = new URL(request.url).searchParams.get("noteId"); return dataResponse(await service.list(session.user.id, value ? z.uuid().parse(value) : undefined)); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) { try { const session = await requireSession(request); return dataResponse(await service.create(session.user.id, schema.parse(await request.json())), { status: 201 }); } catch (error) { return errorResponse(error); } }
