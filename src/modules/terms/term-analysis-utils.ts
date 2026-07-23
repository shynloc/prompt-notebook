import { createHash } from "node:crypto";

import { z } from "zod";

import { TERM_ANALYSIS_CATEGORIES } from "./term-categories";

const candidateSchema = z.object({
  category: z.enum(TERM_ANALYSIS_CATEGORIES),
  label: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(500),
  sourceExcerpt: z.string().trim().min(1).max(500).optional(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});
export const termAnalysisResponseSchema = z.object({ candidates: z.array(candidateSchema).max(80) });
export type RawTermCandidate = z.infer<typeof candidateSchema>;
export type ExistingTerm = { id: string; category: string; label: string; value: string; builtIn: boolean };

export function normalizeTerm(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

function trigrams(value: string) {
  if (value.length < 3) return new Set([value]);
  return new Set(Array.from({ length: value.length - 2 }, (_, index) => value.slice(index, index + 3)));
}

export function termSimilarity(left: string, right: string) {
  const a = trigrams(normalizeTerm(left));
  const b = trigrams(normalizeTerm(right));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function jsonSlice(value: string) {
  const withoutFence = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  return start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;
}

export function parseTermAnalysisResponse(value: string) {
  return termAnalysisResponseSchema.parse(JSON.parse(jsonSlice(value)));
}

function candidateId(candidate: RawTermCandidate) {
  return createHash("sha256")
    .update(`${candidate.category}\u0000${candidate.label}\u0000${candidate.value}`)
    .digest("hex")
    .slice(0, 16);
}

export function annotateTermCandidates(prompt: string, candidates: RawTermCandidate[], existing: ExistingTerm[]) {
  const normalizedPrompt = normalizeTerm(prompt);
  const seen = new Set<string>();
  const annotated = [];
  for (const candidate of candidates) {
    const valueKey = normalizeTerm(candidate.value);
    if (!valueKey || !normalizedPrompt.includes(valueKey)) continue;
    const requestKey = `${normalizeTerm(candidate.category)}:${valueKey}`;
    if (seen.has(requestKey)) continue;
    seen.add(requestKey);

    const exact = existing.find((term) => normalizeTerm(term.value) === valueKey
      || (term.category === candidate.category && normalizeTerm(term.label) === normalizeTerm(candidate.label)));
    let duplicate: null | { kind: "exact" | "similar"; id: string; label: string; value: string; builtIn: boolean } = exact
      ? { kind: "exact", id: exact.id, label: exact.label, value: exact.value, builtIn: exact.builtIn }
      : null;
    if (!duplicate) {
      let best: { term: ExistingTerm; score: number } | null = null;
      for (const term of existing.filter((item) => item.category === candidate.category)) {
        const score = Math.max(termSimilarity(candidate.label, term.label), termSimilarity(candidate.value, term.value));
        if (score >= 0.84 && (!best || score > best.score)) best = { term, score };
      }
      if (best) duplicate = { kind: "similar", id: best.term.id, label: best.term.label, value: best.term.value, builtIn: best.term.builtIn };
    }
    annotated.push({
      ...candidate,
      id: candidateId(candidate),
      sourceExcerpt: candidate.value,
      duplicate,
    });
  }
  return annotated;
}
