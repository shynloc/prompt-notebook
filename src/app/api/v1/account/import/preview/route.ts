import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { parseNotebookImport } from "@/modules/transfer/parse-import";
import { NotebookTransferService } from "@/modules/transfer/notebook-transfer";

const transfer = new NotebookTransferService();
export async function POST(request: Request) {
  try { const session = await requireSession(request); return dataResponse(await transfer.preview(session.user.id, await parseNotebookImport(request))); }
  catch (error) { return errorResponse(error); }
}
