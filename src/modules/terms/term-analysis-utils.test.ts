import { describe, expect, it } from "vitest";

import {
  annotateTermCandidates,
  parseTermAnalysisResponse,
  termSimilarity,
} from "./term-analysis-utils";

describe("term analysis utilities", () => {
  it("parses strict JSON even when a provider wraps it in a Markdown fence", () => {
    expect(parseTermAnalysisResponse(`\n\`\`\`json\n{
      "candidates": [{
        "category": "光线",
        "label": "体积光",
        "value": "volumetric lighting",
        "confidence": "high"
      }]
    }\n\`\`\``).candidates).toHaveLength(1);
  });

  it("rejects unknown categories instead of silently polluting the vocabulary", () => {
    expect(() => parseTermAnalysisResponse(JSON.stringify({
      candidates: [{ category: "未定义分类", label: "测试", value: "test" }],
    }))).toThrow();
  });

  it("keeps only exact excerpts, de-duplicates the response and annotates existing terms", () => {
    const candidates = annotateTermCandidates(
      "cinematic portrait with volumetric lighting and gentle rim light",
      [
        { category: "光线", label: "体积光", value: "volumetric lighting", confidence: "high" },
        { category: "光线", label: "体积光", value: "volumetric lighting", confidence: "medium" },
        { category: "风格", label: "水彩", value: "watercolor", confidence: "low" },
        { category: "光线", label: "柔和轮廓光", value: "gentle rim light", confidence: "medium" },
      ],
      [{ id: "builtin-light", category: "光线", label: "体积光", value: "volumetric lighting", builtIn: true }],
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      value: "volumetric lighting",
      sourceExcerpt: "volumetric lighting",
      duplicate: { kind: "exact", id: "builtin-light", builtIn: true },
    });
    expect(candidates[1]).toMatchObject({ value: "gentle rim light", duplicate: null });
  });

  it("detects close variants without treating unrelated terms as duplicates", () => {
    expect(termSimilarity("cinematic portrait lighting", "cinematic portrait light")).toBeGreaterThanOrEqual(0.84);
    expect(termSimilarity("cinematic portrait lighting", "top-down view")).toBeLessThan(0.84);
  });
});
