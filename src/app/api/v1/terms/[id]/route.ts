import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { customTerms } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { termIdSchema, termInputSchema } from "@/modules/terms/term-schema";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const id = termIdSchema.parse((await context.params).id);
    const input = termInputSchema.partial().parse(await request.json());
    const [updated] = await db.update(customTerms).set(input).where(and(eq(customTerms.id, id), eq(customTerms.userId, session.user.id))).returning();
    if (!updated) throw new ApiError(404, "NOT_FOUND", "词条不存在");
    return dataResponse({ ...updated, builtIn: false });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const id = termIdSchema.parse((await context.params).id);
    const [deleted] = await db.delete(customTerms).where(and(eq(customTerms.id, id), eq(customTerms.userId, session.user.id))).returning();
    if (!deleted) throw new ApiError(404, "NOT_FOUND", "词条不存在");
    return dataResponse({ id });
  } catch (error) {
    return errorResponse(error);
  }
}
