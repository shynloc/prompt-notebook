import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { AccountService } from "@/modules/account/account-service";

const accounts = new AccountService();

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return dataResponse(await accounts.mediaIntegrity(session.user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
