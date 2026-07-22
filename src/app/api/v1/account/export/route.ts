import { errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { NotebookTransferService } from "@/modules/transfer/notebook-transfer";

const transfer = new NotebookTransferService();

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const document = await transfer.export(session.user.id);
    return Response.json(document, { headers: { "cache-control": "private, no-store", "content-disposition": `attachment; filename="prompt-notebook-${new Date().toISOString().slice(0, 10)}.json"` } });
  } catch (error) { return errorResponse(error); }
}
