import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { AccountService } from "@/modules/account/account-service";

const inputSchema = z.object({
  password: z.string().min(1).max(256),
  confirmation: z.string().max(64),
});
const accounts = new AccountService();

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = inputSchema.parse(await request.json());
    return dataResponse(await accounts.deleteAccount(request, session.user.id, input.password, input.confirmation));
  } catch (error) {
    return errorResponse(error);
  }
}
