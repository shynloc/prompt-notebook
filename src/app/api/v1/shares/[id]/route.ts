import { z } from "zod";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { ShareService } from "@/modules/sharing/share-service";

const service = new ShareService();
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { try { const session = await requireSession(request); return dataResponse(await service.revoke(session.user.id, z.uuid().parse((await context.params).id))); } catch (error) { return errorResponse(error); } }
