import { eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { customTerms } from "@/db/schema";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import builtInTerms from "@/modules/terms/built-in-terms.json";
import { normalizeTerm } from "@/modules/terms/term-analysis-utils";
import { bulkTermInputSchema } from "@/modules/terms/term-schema";

const MAX_CUSTOM_TERMS = 5_000;

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = bulkTermInputSchema.parse(await request.json());
    const existingCustom = await db.select().from(customTerms).where(eq(customTerms.userId, session.user.id));
    const existingKeys = new Set([
      ...builtInTerms,
      ...existingCustom,
    ].flatMap((term) => [
      `value:${normalizeTerm(term.value)}`,
      `label:${normalizeTerm(term.category)}:${normalizeTerm(term.label)}`,
    ]));
    const unique = [];
    const skipped = [];
    for (const term of input.terms) {
      const keys = [
        `value:${normalizeTerm(term.value)}`,
        `label:${normalizeTerm(term.category)}:${normalizeTerm(term.label)}`,
      ];
      if (keys.some((key) => existingKeys.has(key))) {
        skipped.push({ term, reason: "duplicate" as const });
        continue;
      }
      keys.forEach((key) => existingKeys.add(key));
      unique.push(term);
    }

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(customTerms).where(eq(customTerms.userId, session.user.id));
    const available = Math.max(0, MAX_CUSTOM_TERMS - count);
    const accepted = unique.slice(0, available);
    skipped.push(...unique.slice(available).map((term) => ({ term, reason: "limit" as const })));
    const created = accepted.length
      ? await db.insert(customTerms).values(accepted.map((term) => ({ ...term, userId: session.user.id })))
          .onConflictDoNothing().returning()
      : [];
    const createdKeys = new Set(created.map((term) =>
      `${normalizeTerm(term.category)}:${normalizeTerm(term.label)}:${normalizeTerm(term.value)}`,
    ));
    skipped.push(...accepted
      .filter((term) => !createdKeys.has(`${normalizeTerm(term.category)}:${normalizeTerm(term.label)}:${normalizeTerm(term.value)}`))
      .map((term) => ({ term, reason: "duplicate" as const })));
    return dataResponse({
      created: created.map((term) => ({ ...term, builtIn: false })),
      skipped,
    }, { status: created.length ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
