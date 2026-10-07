import { describe, expect, it } from "vitest";
import { reverseModelFixture } from "@/test/reverse-fixture";
import {
  parseReversePromptDocument,
  reverseOptionsSchema,
  REVERSE_PROMPT_SYSTEM_INSTRUCTION,
} from "./reverse-prompt-structure";

const options = {
  additionalRequirements: "把衬衫改成蓝色",
  language: "zh" as const,
};
describe("structured image reconstruction", () => {
  it("orders sections and keeps original observations separate from user overrides", () => {
    const result = parseReversePromptDocument(
      JSON.stringify({
        ...reverseModelFixture,
        sections: [...reverseModelFixture.sections].reverse(),
      }),
      options,
    );
    expect(result.prompt).toContain("蓝色衬衫");
    expect(result.prompt).not.toContain("白色衬衫");
    expect(result.structure.sections.map((section) => section.id)).toEqual([
      "subject",
      "clothing",
      "camera",
    ]);
    expect(result.structure.sections[1].observed).toBe("白色衬衫");
    expect(result.structure.additionalRequirements).toBe(
      options.additionalRequirements,
    );
    expect(result.negativePrompt).toBe(reverseModelFixture.negativePrompt);
  });
  it("allows mixed non-portrait content and a complete JSON fence", () => {
    const result = parseReversePromptDocument(
      `\`\`\`json\n${JSON.stringify({ ...reverseModelFixture, categories: ["landscape", "poster"], sections: [{ id: "subject", observed: "山谷海报", content: "山谷海报", basis: "observed" }], changes: [] })}\n\`\`\``,
      { ...options, language: "en" },
    );
    expect(result.prompt).toBe("【Subject】\n山谷海报");
    expect(result.structure.categories).toEqual(["landscape", "poster"]);
  });
  it.each([
    "{truncated",
    "plain prose",
    `Here is JSON: ${JSON.stringify(reverseModelFixture)}`,
    JSON.stringify({ ...reverseModelFixture, extra: "unknown" }),
    JSON.stringify({
      ...reverseModelFixture,
      sections: [
        ...reverseModelFixture.sections,
        reverseModelFixture.sections[0],
      ],
    }),
    JSON.stringify({
      ...reverseModelFixture,
      sections: [
        { id: "unknown", observed: "", content: "bad", basis: "observed" },
      ],
    }),
    JSON.stringify({
      ...reverseModelFixture,
      sections: [
        { id: "quality", observed: "", content: "HD", basis: "inferred" },
      ],
    }),
    JSON.stringify({
      ...reverseModelFixture,
      sections: [
        { ...reverseModelFixture.sections[0], content: "x".repeat(6_001) },
      ],
    }),
    JSON.stringify(reverseModelFixture).replace(
      '"version":1',
      '"__proto__":{"polluted":true},"version":1',
    ),
    '{"constructor":{}}',
  ])("rejects invalid output without exposing its contents", (raw) => {
    expect(() => parseReversePromptDocument(raw, options)).toThrowError(
      expect.objectContaining({
        code: "AI_REVERSE_PROMPT_INVALID",
        status: 502,
      }),
    );
  });
  it("rejects invented user modifications when no requirements were supplied", () => {
    expect(() =>
      parseReversePromptDocument(JSON.stringify(reverseModelFixture), {
        additionalRequirements: "",
        language: "zh",
      }),
    ).toThrow();
  });
  it("rejects deeply nested or oversized provider data with stable errors", () => {
    expect(() =>
      parseReversePromptDocument(
        '{"x":' + "[".repeat(2_100) + "0" + "]".repeat(2_100) + "}",
        options,
      ),
    ).toThrow();
    expect(() =>
      parseReversePromptDocument("x".repeat(100_001), options),
    ).toThrow();
  });
  it("rejects change summaries that claim an override absent from the final description", () => {
    expect(() =>
      parseReversePromptDocument(
        JSON.stringify({
          ...reverseModelFixture,
          changes: [{ section: "clothing", from: "白色衬衫", to: "红色衬衫" }],
        }),
        options,
      ),
    ).toThrow();
  });
  it("bounds user requirements and keeps the system independent of user content", () => {
    expect(
      reverseOptionsSchema.safeParse({
        additionalRequirements: "x".repeat(2_001),
      }).success,
    ).toBe(false);
    expect(reverseOptionsSchema.safeParse({ extra: "x" }).success).toBe(false);
    expect(REVERSE_PROMPT_SYSTEM_INSTRUCTION).toContain(
      "Additional requirements control",
    );
    expect(REVERSE_PROMPT_SYSTEM_INSTRUCTION).toContain(
      "image details only for the requested attributes",
    );
  });
});
