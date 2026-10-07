// Short-lived, per-tab transfers. Prompt text never enters URLs or server logs.
type Destination = "imagehub" | "analyze";
type Handoff = {
  prompt: string;
  negativePrompt: string;
  destination: Destination;
  createdAt: number;
};
const prefix = "prompt-notebook:handoff:";
const ttl = 10 * 60_000;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function storePromptHandoff(
  destination: Destination,
  prompt: string,
  negativePrompt = "",
) {
  if (!prompt.trim() || prompt.length > 50_000 || negativePrompt.length > 8_000)
    throw new Error("Invalid prompt handoff");
  // A tab can retain at most one pending transfer; clear abandoned sensitive text.
  const keys = Array.from({ length: sessionStorage.length }, (_, index) =>
    sessionStorage.key(index),
  );
  for (const key of keys)
    if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  const id = crypto.randomUUID();
  sessionStorage.setItem(
    `${prefix}${id}`,
    JSON.stringify({
      destination,
      prompt,
      negativePrompt,
      createdAt: Date.now(),
    }),
  );
  return id;
}
export function takePromptHandoff(
  id: string | null,
  destination: Destination,
): Handoff | null {
  if (!id || !uuid.test(id)) return null;
  const raw = sessionStorage.getItem(`${prefix}${id}`);
  if (!raw) return null;
  try {
    if (raw.length > 400_000) {
      sessionStorage.removeItem(`${prefix}${id}`);
      return null;
    }
    const value = JSON.parse(raw) as Handoff;
    if (value.destination !== destination) return null;
    sessionStorage.removeItem(`${prefix}${id}`);
    if (
      typeof value.createdAt !== "number" ||
      !Number.isFinite(value.createdAt) ||
      Date.now() - value.createdAt > ttl ||
      value.createdAt > Date.now() + 1_000
    )
      return null;
    if (
      typeof value.prompt !== "string" ||
      !value.prompt.trim() ||
      value.prompt.length > 50_000 ||
      typeof value.negativePrompt !== "string" ||
      value.negativePrompt.length > 8_000
    )
      return null;
    return {
      destination,
      prompt: value.prompt,
      negativePrompt: value.negativePrompt,
      createdAt: value.createdAt,
    };
  } catch {
    sessionStorage.removeItem(`${prefix}${id}`);
    return null;
  }
}
