export interface ImageModelOption {
  modelProfileId: string;
  modelId: string;
  name: string;
  defaultParameters: Record<string, string | number | boolean>;
}

/** The public configuration API currently returns one flat item per model. */
export function imageModelOptions(data: unknown): ImageModelOption[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((value): ImageModelOption[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (item.enabled !== true) return [];
    const models = Array.isArray(item.models) ? item.models : [item];
    return models.flatMap((model): ImageModelOption[] => {
      if (!model || typeof model !== "object") return [];
      const row = model as Record<string, unknown>;
      const id = row.modelProfileId ?? row.id;
      if (typeof id !== "string" || typeof row.modelId !== "string"
        || (row.modelEnabled ?? row.enabled) === false
        || !Array.isArray(row.capabilities) || !row.capabilities.includes("image_generation")) return [];
      const parameters = row.defaultParameters && typeof row.defaultParameters === "object" && !Array.isArray(row.defaultParameters)
        ? Object.fromEntries(Object.entries(row.defaultParameters).filter(([, parameter]) => ["string", "number", "boolean"].includes(typeof parameter))) as ImageModelOption["defaultParameters"]
        : {};
      return [{
        modelProfileId: id,
        modelId: row.modelId,
        name: `${String(item.name ?? "模型")} · ${String(row.displayName ?? row.modelId)}`,
        defaultParameters: parameters,
      }];
    });
  });
}

export function generationUsage(metadata: Record<string, unknown> | undefined) {
  const usage = metadata?.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const row = usage as Record<string, unknown>;
  const total = count(row.total_tokens);
  const input = count(row.input_tokens);
  const output = count(row.output_tokens);
  if (total !== null) return `用量 ${total.toLocaleString()} tokens${input !== null && output !== null ? `（输入 ${input.toLocaleString()} / 输出 ${output.toLocaleString()}）` : ""}`;
  if (input !== null || output !== null) return `用量：输入 ${input?.toLocaleString() ?? "未提供"} / 输出 ${output?.toLocaleString() ?? "未提供"} tokens`;
  return null;
}
