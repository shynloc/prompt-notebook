import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { extensionDevices } from "@/db/schema";
import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const devices = await db.select({
      id: extensionDevices.id,
      name: extensionDevices.name,
      createdAt: extensionDevices.createdAt,
      lastUsedAt: extensionDevices.lastUsedAt,
      revokedAt: extensionDevices.revokedAt,
    }).from(extensionDevices)
      .where(eq(extensionDevices.userId, session.user.id))
      .orderBy(desc(extensionDevices.lastUsedAt));
    return dataResponse(devices);
  } catch (error) {
    return errorResponse(error);
  }
}

