// UI-safe values and rendering. Provider instructions and validation stay on the server.
export const REVERSE_IMAGE_CATEGORIES = [
  "portrait",
  "landscape",
  "product",
  "animal",
  "architecture",
  "illustration",
  "poster",
  "infographic",
  "comic",
  "other",
] as const;
export const REVERSE_CATEGORY_LABELS: Record<
  (typeof REVERSE_IMAGE_CATEGORIES)[number],
  string
> = {
  portrait: "人物",
  landscape: "风景",
  product: "产品／实物",
  animal: "动物",
  architecture: "建筑",
  illustration: "插画",
  poster: "海报",
  infographic: "信息图",
  comic: "漫画",
  other: "其他",
};
export const REVERSE_SECTION_IDS = [
  "theme",
  "subject",
  "appearance",
  "clothing",
  "pose",
  "scene",
  "composition",
  "lighting",
  "color",
  "camera",
  "style",
  "text",
  "quality",
  "constraints",
] as const;
export type ReverseSectionId = (typeof REVERSE_SECTION_IDS)[number];
export const REVERSE_SECTION_LABELS: Record<
  ReverseSectionId,
  { zh: string; en: string }
> = {
  theme: { zh: "主题与用途", en: "Theme and purpose" },
  subject: { zh: "主体或人物", en: "Subject" },
  appearance: { zh: "外观与外貌", en: "Appearance" },
  clothing: { zh: "服饰与配件", en: "Clothing and accessories" },
  pose: { zh: "动作与姿势", en: "Action and pose" },
  scene: { zh: "场景与环境", en: "Scene and environment" },
  composition: { zh: "构图与布局", en: "Composition and layout" },
  lighting: { zh: "光线与照明", en: "Lighting" },
  color: { zh: "影像色调", en: "Color palette" },
  camera: { zh: "镜头与取景", en: "Camera and framing" },
  style: { zh: "风格与材质", en: "Style and materials" },
  text: { zh: "文字与信息", en: "Text and information" },
  quality: { zh: "质量要求", en: "Quality criteria" },
  constraints: { zh: "限制与输出", en: "Constraints and output" },
};
export const MAX_REVERSE_REQUIREMENTS = 2_000;
export const MAX_REVERSE_PROMPT = 50_000;
export interface ReversePromptDocument {
  version: 1;
  language: "zh" | "en";
  categories: Array<(typeof REVERSE_IMAGE_CATEGORIES)[number]>;
  sections: Array<{
    id: ReverseSectionId;
    observed: string;
    content: string;
    basis: "observed" | "inferred" | "requested";
  }>;
  changes: Array<{ section: ReverseSectionId; from: string; to: string }>;
  uncertainties: string[];
  negativePrompt: string;
  additionalRequirements: string;
}
export interface ReversePromptResult {
  prompt: string;
  negativePrompt: string;
  structure: ReversePromptDocument;
  model: { id: string; name: string };
}
export function renderReversePrompt(document: ReversePromptDocument) {
  return REVERSE_SECTION_IDS.flatMap((id) => {
    const section = document.sections.find((item) => item.id === id);
    return section?.content.trim()
      ? [
          `【${REVERSE_SECTION_LABELS[id][document.language]}】\n${section.content.trim()}`,
        ]
      : [];
  }).join("\n\n");
}
