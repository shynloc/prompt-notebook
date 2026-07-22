import { ApiError } from "@/lib/api/errors";
import { notebookExportSchema } from "./notebook-transfer";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export async function parseNotebookImport(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMPORT_BYTES) throw new ApiError(413, "IMPORT_TOO_LARGE", "导入文件不能超过 10 MB");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new ApiError(413, "IMPORT_TOO_LARGE", "导入文件不能超过 10 MB");
  try { return notebookExportSchema.parse(JSON.parse(text)); }
  catch { throw new ApiError(422, "INVALID_IMPORT", "这不是有效的 Prompt Notebook 导出文件"); }
}
