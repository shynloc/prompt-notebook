import { asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { customTerms } from "@/db/schema";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import builtInTerms from "@/modules/terms/built-in-terms.json";
import { termInputSchema } from "@/modules/terms/term-schema";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const custom = await db.select().from(customTerms).where(eq(customTerms.userId, session.user.id)).orderBy(asc(customTerms.category), asc(customTerms.label));
    return dataResponse({
      builtIn: builtInTerms.map((term, index) => ({ ...term, id: `builtin-${index}`, builtIn: true })),
      custom: custom.map((term) => ({ ...term, builtIn: false })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = termInputSchema.parse(await request.json());
    const [created] = await db.insert(customTerms).values({ ...input, userId: session.user.id }).returning();
    return dataResponse({ ...created, builtIn: false }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
