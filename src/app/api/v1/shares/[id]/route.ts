import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { ShareService } from "@/modules/sharing/share-service";

const service = new ShareService();
const actionSchema = z.object({ action: z.literal("renew") });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    actionSchema.parse(await request.json());
    const id = z.uuid().parse((await context.params).id);
    return dataResponse(await service.renew(session.user.id, id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    const id = z.uuid().parse((await context.params).id);
    return dataResponse(await service.revoke(session.user.id, id));
  } catch (error) {
    return errorResponse(error);
  }
}
