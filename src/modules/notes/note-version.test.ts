import { describe, expect, it } from "vitest";

import { promptContentHash } from "@/modules/search/content-hash";

import { contentHashForRestoredNote } from "./note-version";

describe("restored note content hash", () => {
  it("follows the restored prompt instead of the current one", () => {
    const current = { prompt: "current prompt", negativePrompt: "current negative" };
    const hash = contentHashForRestoredNote({ prompt: "older prompt", negativePrompt: null }, current);
    expect(hash).toBe(promptContentHash("older prompt", null));
    expect(hash).not.toBe(promptContentHash(current.prompt, current.negativePrompt));
  });

  it("keeps the current negative prompt when the snapshot has none", () => {
    const current = { prompt: "same", negativePrompt: "keep me" };
    expect(contentHashForRestoredNote({ prompt: "same" }, current)).toBe(promptContentHash("same", "keep me"));
  });
});
