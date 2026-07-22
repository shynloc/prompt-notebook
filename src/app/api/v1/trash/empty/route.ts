import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { AccountService } from "@/modules/account/account-service";

const inputSchema = z.object({ limit: z.number().int().min(1).max(500).default(500) });
const accounts = new AccountService();

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = inputSchema.parse(await request.json().catch(() => ({})));
    return dataResponse(await accounts.emptyTrash(session.user.id, input.limit));
  } catch (error) {
    return errorResponse(error);
  }
}
