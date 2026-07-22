import { createHash } from "node:crypto";

export function normalizePromptContent(prompt: string, negativePrompt?: string | null) {
  return `${prompt.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()}\n${(negativePrompt ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()}`;
}

export function promptContentHash(prompt: string, negativePrompt?: string | null) {
  return createHash("md5").update(normalizePromptContent(prompt, negativePrompt)).digest("hex");
}
