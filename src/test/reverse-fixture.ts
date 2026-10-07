import {
  renderReversePrompt,
  type ReversePromptResult,
} from "@/modules/ai/reverse-prompt-contract";

export const reverseModelFixture = {
  version: 1 as const,
  categories: ["portrait" as const],
  sections: [
    {
      id: "subject" as const,
      observed: "一位站立的人物",
      content: "一位站立的人物，保持原图构图",
      basis: "observed" as const,
    },
    {
      id: "clothing" as const,
      observed: "白色衬衫",
      content: "蓝色衬衫",
      basis: "requested" as const,
    },
    {
      id: "camera" as const,
      observed: "半身正面取景",
      content: "半身正面取景",
      basis: "observed" as const,
    },
  ],
  changes: [{ section: "clothing" as const, from: "白色衬衫", to: "蓝色衬衫" }],
  uncertainties: ["精确镜头焦距无法从图片确定"],
  negativePrompt: "模糊，错误肢体，多余文字",
};
export function reverseResultFixture(): ReversePromptResult {
  const structure = {
    ...reverseModelFixture,
    language: "zh" as const,
    additionalRequirements: "把衬衫改成蓝色",
  };
  return {
    prompt: renderReversePrompt(structure),
    negativePrompt: structure.negativePrompt,
    structure,
    model: { id: "vision", name: "Vision Model" },
  };
}
