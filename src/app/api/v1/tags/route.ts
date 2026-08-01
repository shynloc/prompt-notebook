import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { tags } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { createTagSchema } from "@/modules/tags/tag-schema";
import { listActiveTagStatistics } from "@/modules/tags/tag-statistics";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const rows = await listActiveTagStatistics(session.user.id);
    return dataResponse(rows.map(({ noteCount, ...tag }) => ({ ...tag, count: noteCount })));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const { name } = createTagSchema.parse(await request.json());
    const [existing] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.userId, session.user.id), sql`lower(${tags.name}) = lower(${name})`))
      .limit(1);
    if (existing) return dataResponse(existing);
    const [created] = await db.insert(tags).values({ userId: session.user.id, name }).returning();
    return dataResponse(created, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return errorResponse(new ApiError(409, "TAG_EXISTS", "标签已经存在"));
    }
    return errorResponse(error);
  }
}
