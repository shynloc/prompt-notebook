import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { DashboardService } from "@/modules/dashboard/dashboard-service";

const dashboard = new DashboardService();

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return dataResponse(await dashboard.snapshot(session.user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
