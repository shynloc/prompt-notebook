import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { promptTemplates } from "@/db/schema";

const variablePattern = /{{\s*([a-zA-Z][a-zA-Z0-9_]{0,39})\s*}}/g;

export function templateVariables(content: string) {
  return [...new Set([...content.matchAll(variablePattern)].map((match) => match[1]))].slice(0, 20);
}

export function renderTemplate(content: string, values: Record<string, string>) {
  return content.replace(variablePattern, (_, name: string) => values[name] ?? `{{${name}}}`);
}

export class TemplateService {
  list(userId: string) {
    return db.select().from(promptTemplates).where(eq(promptTemplates.userId, userId)).orderBy(desc(promptTemplates.updatedAt));
  }

  async create(userId: string, input: { name: string; content: string }) {
    const [created] = await db.insert(promptTemplates).values({ userId, ...input, variables: templateVariables(input.content) }).returning();
    return created;
  }
}
