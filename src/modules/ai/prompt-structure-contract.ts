export const MAX_OPTIMIZED_PROMPT_LENGTH = 50_000;

export const PROMPT_OPTIMIZATION_CONTEXTS = ["auto", "general", "image_generation"] as const;
export type PromptOptimizationContext = (typeof PROMPT_OPTIMIZATION_CONTEXTS)[number];
export type ResolvedPromptOptimizationContext = Exclude<PromptOptimizationContext, "auto">;

export const PROMPT_MODULES = [
  "general",
  "contract",
  "content",
  "context",
  "organization",
  "appearance",
  "capture_render",
  "information",
  "continuity",
  "constraints_output",
] as const;
export type PromptModuleId = (typeof PROMPT_MODULES)[number];

export const PROMPT_MODULE_REGISTRY: Readonly<Record<PromptModuleId, {
  label: { zh: string; en: string };
  description: string;
}>> = {
  general: { label: { zh: "优化结果", en: "Optimized prompt" }, description: "Provider-neutral improvement for a non-image prompt." },
  contract: { label: { zh: "生成目标", en: "Goal" }, description: "Purpose, audience, deliverable, and success criteria." },
  content: { label: { zh: "主体与内容", en: "Subject and content" }, description: "Subjects, attributes, actions, relationships, and requested content." },
  context: { label: { zh: "场景与环境", en: "Scene and context" }, description: "Setting, time, environment, atmosphere, and relevant background." },
  organization: { label: { zh: "构图与组织", en: "Composition and organization" }, description: "Composition, layout, hierarchy, panels, and spatial relationships." },
  appearance: { label: { zh: "视觉与质感", en: "Visual treatment" }, description: "Style, color, lighting, materials, mood, and medium-specific appearance." },
  capture_render: { label: { zh: "镜头与呈现", en: "Capture and rendering" }, description: "Camera, lens, viewpoint, perspective, illustration, or rendering method." },
  information: { label: { zh: "文字与信息", en: "Text and information" }, description: "Exact copy, data, icons, charts, labels, and symbols." },
  continuity: { label: { zh: "一致性", en: "Continuity" }, description: "Identity, product, brand, and multi-frame continuity requirements." },
  constraints_output: { label: { zh: "限制与输出", en: "Constraints and output" }, description: "Prohibitions, hard constraints, format, and output requirements." },
};

export const PROMPT_INTENT_PURPOSES = [
  "promotional",
  "informational",
  "editorial",
  "narrative",
  "documentary",
  "decorative",
  "conceptual",
  "instructional",
  "other",
] as const;

export const PROMPT_INTENT_MEDIA = [
  "photography",
  "graphic_design",
  "illustration",
  "three_dimensional",
  "diagram",
  "mixed_media",
  "unspecified",
] as const;

export const PROMPT_INTENT_SUBJECTS = [
  "people",
  "product",
  "environment",
  "architecture",
  "object",
  "food",
  "animal",
  "typography",
  "data",
  "sequence",
  "abstract",
  "other",
] as const;

export const PROMPT_CAPABILITIES = [
  "identity_reference",
  "product_integrity",
  "typography_copy",
  "data_fidelity",
  "sequence_continuity",
  "photographic_capture",
  "brand_layout",
  "spatial_composition",
  "material_fidelity",
] as const;
export type PromptCapabilityId = (typeof PROMPT_CAPABILITIES)[number];

export const PROMPT_CAPABILITY_REGISTRY: Readonly<Record<PromptCapabilityId, string>> = {
  identity_reference: "Preserve a selected person's identity and stable visual traits across references and outputs.",
  product_integrity: "Preserve product shape, packaging, labels, logos, proportions, and distinguishing details.",
  typography_copy: "Keep supplied copy exact while improving hierarchy, placement, readability, and safe space; never invent copy.",
  data_fidelity: "Keep numbers and claims exact and map data truthfully to labels, charts, icons, and visual comparisons.",
  sequence_continuity: "Maintain character, object, setting, action, and temporal continuity across panels or frames.",
  photographic_capture: "Use relevant viewpoint, camera, lens, depth of field, exposure, and lighting direction without filler jargon.",
  brand_layout: "Respect brand hierarchy, focal priority, whitespace, logo integrity, and communication goals.",
  spatial_composition: "Clarify placement, scale, overlap, depth, balance, and relationships between visual elements.",
  material_fidelity: "Describe and preserve physically coherent surface, texture, reflectance, transparency, and material behavior.",
};

export const LOCKED_FACT_KINDS = [
  "quoted_text",
  "explicit_label",
  "numeric_literal",
  "identifier",
] as const;
export type LockedFactKind = (typeof LOCKED_FACT_KINDS)[number];

export const PROMPT_OPTIMIZATION_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"] as const;
export interface PromptOptimizationHints {
  hasAiModel?: boolean;
  referenceImageCount?: number;
  aspectRatio?: (typeof PROMPT_OPTIMIZATION_ASPECT_RATIOS)[number];
}

export type PromptStructureWarningSeverity = "info" | "warning" | "error";

export interface PromptStructureWarning {
  code: string;
  severity: PromptStructureWarningSeverity;
  blocking: boolean;
  message: string;
  module?: PromptModuleId;
}

export interface PromptOptimizationStructure {
  version: 1;
  format: "structured" | "plain_fallback";
  context: ResolvedPromptOptimizationContext;
  artifactLabel: string | null;
  intents: {
    purposes: Array<(typeof PROMPT_INTENT_PURPOSES)[number]>;
    media: Array<(typeof PROMPT_INTENT_MEDIA)[number]>;
    subjects: Array<(typeof PROMPT_INTENT_SUBJECTS)[number]>;
  };
  requestedModules: PromptModuleId[];
  selectedModules: PromptModuleId[];
  capabilities: PromptCapabilityId[];
  sections: Array<{ module: PromptModuleId; heading: string; content: string }>;
  lockedFacts: Array<{ kind: LockedFactKind; value: string; preserved: boolean }>;
  warnings: PromptStructureWarning[];
}
