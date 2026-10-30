import { promptContentHash } from "@/modules/search/content-hash";

export function contentHashForRestoredNote(
  snapshot: Record<string, unknown>,
  current: { prompt: string; negativePrompt: string | null },
) {
  const prompt = typeof snapshot.prompt === "string" ? snapshot.prompt : current.prompt;
  const negativePrompt = "negativePrompt" in snapshot
    ? (typeof snapshot.negativePrompt === "string" ? snapshot.negativePrompt : null)
    : current.negativePrompt;
  return promptContentHash(prompt, negativePrompt);
}
