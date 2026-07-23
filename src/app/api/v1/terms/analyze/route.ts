import { z } from "zod";

import { dataResponse, errorResponse } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/session";
import { TermAnalyzer } from "@/modules/terms/term-analyzer";

const inputSchema = z.object({ prompt: z.string().trim().min(10).max(50_000) });
const defaultAnalyzer = new TermAnalyzer();

export function createAnalyzeTermsHandler(analyzer = defaultAnalyzer) {
  return async function analyzeTerms(request: Request) {
    try {
      const session = await requireSession(request);
      const input = inputSchema.parse(await request.json());
      return dataResponse(await analyzer.analyze(session.user.id, input.prompt, request.signal));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createAnalyzeTermsHandler();
